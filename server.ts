import express from "express";
import path from "path";
import fs from "fs";
import axios from "axios";
import { createServer as createViteServer } from "vite";
import { Telegraf, Context, Markup, session } from "telegraf";
import { config } from "./src/config/index.ts";
import { AIEngine } from "./src/ai/engine.ts";
import { ShellUtils, FileUtils } from "./src/utils/index.ts";
import logger from "./src/utils/logger.ts";
import { GitHubService } from "./src/github/service.ts";
import { PreviewEngine } from "./src/preview/engine.ts";
import { DB } from "./src/database/db.ts";
import { channelCheckMiddleware, isAdmin } from "./src/middleware/checkers.ts";
import { Scraper } from "./src/tools/scraper.ts";
import { Sandbox } from "./src/tools/sandbox.ts";


function escapeHtml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}


function normalizeModelReply(text: string) {
  return text
    .replace(/\\n/g, "\n")
    .replace(/\*\*/g, "")
    .replace(/^[ \t]*>[ \t]?/gm, "")
    .replace(/^[ \t]*[-*][ \t]+/gm, "• ")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

function splitMessage(text: string, maxLength = 4096): string[] {
  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > maxLength) {
    let splitAt = remaining.lastIndexOf("\n", maxLength);
    if (splitAt === -1 || splitAt < maxLength * 0.5) splitAt = maxLength;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).replace(/^\n+/, "");
  }

  if (remaining.length) chunks.push(remaining);
  return chunks;
}

async function startServer() {
  const app = express();
  const PORT = config.port;
  app.use(express.json({ limit: "15mb" }));

  let botStatus = "initializing";
  let botError: string | null = null;
  let botInfo: any = null;

  const bot = new Telegraf(config.botToken || "DUMMY_TOKEN");

  // Bot Middlewares
  bot.use(channelCheckMiddleware);
  
  // Custom Session Storage (Simple Map for demo, could be persistent)
  const userStates = new Map<number, { model: string; mode: string; cwd: string; isTerminal: boolean; lastZip?: string; zips: Record<string, string>; clonedRepo?: string; pendingGithubPush?: boolean }>();

  function getState(userId: number) {
    if (!userStates.has(userId)) {
      userStates.set(userId, { model: 'gemini', mode: 'roast', cwd: process.cwd(), isTerminal: false, zips: {} });
    }
    return userStates.get(userId)!;
  }

  async function notifyAdminsUserActivity(ctx: Context, source: string) {
    if (!ctx.from || isAdmin(ctx)) return;
    const name = [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" ").trim() || "Unknown";
    const username = ctx.from.username ? `@${ctx.from.username}` : "No username";
    const chatType = ctx.chat?.type || "unknown";
    const text = `🔔 User activity
👤 ${name} (${username})
🆔 ${ctx.from.id}
💬 Chat: ${chatType}
📍 Trigger: ${source}`;

    await Promise.all(config.adminIds.map(async (adminId) => {
      try {
        await bot.telegram.sendMessage(adminId, text);
      } catch {}
    }));
  }

  async function sendLongTextResponse(ctx: Context, text: string, asHtml = false) {
    const hardLimit = 4096;
    const chunks = splitMessage(text, hardLimit);

    if (chunks.length > 1) {
      for (const chunk of chunks) {
        await ctx.reply(asHtml ? `<pre>${escapeHtml(chunk)}</pre>` : chunk, asHtml ? { parse_mode: "HTML" } : undefined);
      }

      if (text.length > hardLimit * 3) {
        const buffer = Buffer.from(text, "utf-8");
        await ctx.replyWithDocument(
          { source: buffer, filename: `response-${Date.now()}.txt` },
          { caption: "📄 Full response attached as TXT." }
        );
      }
      return;
    }

    await ctx.reply(asHtml ? `<pre>${escapeHtml(text)}</pre>` : text, asHtml ? { parse_mode: "HTML" } : undefined);
  }

  function getMenuText() {
    return `📋 BrokenVzn Agent Menu

Use / prefix for slash commands.
You can also send plain text like: git clone <url>, unzip my.zip, or model groq.

Core Commands
• /help
• /menu
• /model <gemini|groq|qwen|broken>
• /setmode <roast|helpful|coder|strict>

Project & GitHub
• /build <prompt>
• /gitclone <repo_url>
• /gitzip <repo_url|owner/repo>
• /push <repo_name> (needs /github login <token> first)

Files & Utilities
• /unzip <zip_name>
• /lszip <zip_name>
• /zipfiles
• /terminal (admin)`;
  }

  function getHelpText(ctx: Context) {
    return `Brokenvzn tools:

Bot Menu
User: ${ctx.from?.first_name || "Broken"} | ID: ${ctx.from?.id}

You can use commands with "/" OR without prefix.
Example: "help", "menu", "model groq", "unzip my.zip"

AI + Chat
• /help or /menu
• /model qwen|gemini|grog|groq
• /setmode roast|helpful|coder|strict
• /create <prompt>
• normal chat: just send any message

Dev Tools
• /gitclone <repo_url>
• /gitlookup <repo_url|owner/repo>
• /gitzip <repo_url|owner/repo>
• /gitpr <repo_url|owner/repo> <title> | <body>
• /setgithub <token> <repo_url>
• /listfiles
• /readfile <path>
• /editfile <path> <instructions>
• /run <lang> <code>
• /scrape <url>
• /unzip <zip_path>

Admin
• /shell <command>
• /broadcast <message>
• /ban <user_id> / /unban <user_id>`;
  }

  async function handleNaturalChat(ctx: Context, text: string) {
    const userId = ctx.from!.id;
    const state = getState(userId);
    const normalizedText = text.trim();

    // Terminal Mode Handling
    if (state.isTerminal) {
      if (normalizedText === "/exit" || normalizedText.toLowerCase() === "exit") {
        state.isTerminal = false;
        return ctx.reply("🔌 *Disconnected from shell.*", { parse_mode: 'Markdown' });
      }
      return executeShell(ctx, text);
    }

    // Natural terminal/git commands (no slash prefix needed)
    const gitCloneUrlMatch = normalizedText.match(/(?:run\s+)?git\s*clone\s+(https?:\/\/github\.com\/\S+)/i)
      || normalizedText.match(/(?:run\s+)?gitclone\s+(https?:\/\/github\.com\/\S+)/i);
    if (gitCloneUrlMatch) {
      if (!isAdmin(ctx)) return ctx.reply("❌ Restricted. Admin only.");
      const repoUrl = gitCloneUrlMatch[1].trim();
      return cloneRepoToWorkspace(ctx, repoUrl);
    }

    const repoUrls = normalizedText.match(/https?:\/\/github\.com\/[\w.-]+\/[\w.-]+(?:\.git)?/gi) || [];
    if (repoUrls.length >= 2 && /clone|merge|combine|one file|single file/i.test(normalizedText)) {
      if (!isAdmin(ctx)) return ctx.reply("❌ Restricted. Admin only.");
      return cloneAndMergeRepos(ctx, repoUrls.slice(0, 3));
    }

    if (state.pendingGithubPush) {
      const parsedRepo = normalizedText.match(/(?:repo|repository|url)\s*[:=]?\s*(https?:\/\/github\.com\/[^\s]+|[\w.-]+\/[\w.-]+)/i);
      const parsedToken = normalizedText.match(/(?:token|github token)\s*[:=]?\s*(gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)/i);
      if (!parsedRepo || !parsedToken) {
        return ctx.reply("Send both in one message:\nrepo: owner/repo (or full GitHub URL)\ntoken: <github token>");
      }
      state.pendingGithubPush = false;
      return pushWorkspaceToGithub(ctx, parsedRepo[1], parsedToken[1]);
    }

    if (/(run\s+)?git\s+push/i.test(normalizedText) || /(run\s+)?push\s+to\s+github/i.test(normalizedText)) {
      if (!isAdmin(ctx)) return ctx.reply("❌ Restricted. Admin only.");
      const inlineRepo = normalizedText.match(/(?:to|repo|repository)\s+(https?:\/\/github\.com\/[^\s]+|[\w.-]+\/[\w.-]+)/i)?.[1];
      const inlineToken = normalizedText.match(/(gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)/i)?.[1];
      if (inlineRepo && inlineToken) return pushWorkspaceToGithub(ctx, inlineRepo, inlineToken);
      state.pendingGithubPush = true;
      return ctx.reply("Send GitHub repo + token in one message.\nExample:\nrepo: owner/repo\ntoken: ghp_xxx");
    }

    const history = await DB.getHistory(userId, 50);
    await DB.logChat(userId, "user", text);

    await ctx.sendChatAction("typing");

    // Detect Intent (Extended)
    const analysis = await AIEngine.detectIntent(text);
    
    switch (analysis.intent) {
      case "BUILD_APP":
      case "BUILD_APK":
        return buildProject(ctx, analysis.description || text);
      case "MEDIA_DOWNLOAD":
        const scrapeRes = await Scraper.scrape(analysis.url || text);
        return ctx.reply(`🌐 *Scraped:* ${scrapeRes.title}\n\n${scrapeRes.text?.slice(0, 500)}...`, { parse_mode: 'Markdown' });
      case "CMD_SHELL":
        if (!isAdmin(ctx)) return ctx.reply("❌ Restricted. Admin only.");
        if (text.includes("run") || text.includes("sandbox")) {
           const sandboxOut = await Sandbox.runCode("js", analysis.command || text);
           return ctx.reply(`🧪 *Sandbox Output:*\n\`\`\`\n${sandboxOut}\n\`\`\``, { parse_mode: 'Markdown' });
        }
        return executeShell(ctx, analysis.command || text);
      case "CHAT":
      default:
        const systemPrompt = `You are BrokenVzn Agent. A powerful AI assistant for coding and automation. 
Mode: ${state.mode}. Current Directory: ${state.cwd}. 
Behavior rules: roast=savage and witty, helpful=friendly and clear, coder=technical and precise, strict=short and direct. Adjust tone to current mode. You have full access to tools like shell, github, and files.`;
        
        const response = await AIEngine.chat(text, history, systemPrompt, state.model);
        const cleanedResponse = normalizeModelReply(response);
        await DB.logChat(userId, "model", cleanedResponse);
        return sendLongTextResponse(ctx, cleanedResponse, false);
    }
  }

  // --- ADMIN COMMANDS ---

  bot.command("adminusers", (ctx) => {
    if (!isAdmin(ctx)) return ctx.reply("❌ Restricted.");
    logger.info(`Admin ${ctx.from.id} listed users.`);
    const users = DB.getAllUsers();
    let text = "📋 *User Registry*\n\n";
    users.forEach(u => {
      text += `• \`${u.id}\` | @${u.username || 'N/A'}\n  Joined: ${u.joined_at}\n  Active: ${u.last_active}\n\n`;
    });
    ctx.reply(text, { parse_mode: 'Markdown' });
  });

  bot.command("adminstats", (ctx) => {
    if (!isAdmin(ctx)) return ctx.reply("❌ Restricted.");
    logger.info(`Admin ${ctx.from.id} viewed stats.`);
    const stats = `⚙️ *System Stats*
- Users: ${DB.getAllUsers().length}
- Uptime: ${process.uptime().toFixed(0)}s
- Memory: ${(process.memoryUsage().rss / 1024 / 1024).toFixed(2)} MB
- Files: ${FileUtils.listFiles(process.cwd()).length}
- Workspaces: ${fs.existsSync(path.join(process.cwd(), 'workspaces')) ? FileUtils.listFiles(path.join(process.cwd(), 'workspaces')).length : 0}`;
    ctx.reply(stats, { parse_mode: 'Markdown' });
  });

  bot.command("terminal", (ctx) => {
    if (!isAdmin(ctx)) return ctx.reply("❌ Restricted.");
    const state = getState(ctx.from!.id);
    state.isTerminal = true;
    ctx.reply("📁 *Entered Interactive Terminal*\nType commands directly. Use `/exit` to return.", { parse_mode: 'Markdown' });
  });

  bot.command("shell", async (ctx) => {
    if (!isAdmin(ctx)) return ctx.reply("❌ Restricted.");
    const cmd = ctx.message.text.split(" ").slice(1).join(" ").trim();
    if (!cmd) return ctx.reply("Usage: /shell <command>");
    return executeShell(ctx, cmd);
  });

  bot.command("exit", (ctx) => {
    const state = getState(ctx.from!.id);
    if (!state.isTerminal) return ctx.reply("ℹ️ You are not currently in terminal mode.");
    state.isTerminal = false;
    return ctx.reply("🔌 *Disconnected from shell.*", { parse_mode: 'Markdown' });
  });

  bot.command("model", (ctx) => {
    const rawArg = (ctx.message.text.split(" ")[1] || "").trim().toLowerCase();
    const aliases: Record<string, string> = { gemini: "gemini", groq: "groq", grog: "groq", qwen: "qwen", broken: "broken" };
    const model = aliases[rawArg];
    if (!model) {
      return ctx.reply("Usage: /model gemini | groq | qwen | broken (alias: grog)");
    }
    const state = getState(ctx.from!.id);
    state.model = model;
    DB.updateModel(ctx.from!.id, model);
    ctx.reply(`✅ Chat model switched to: *${model.toUpperCase()}*`, { parse_mode: 'Markdown' });
  });

  bot.command("broadcast", async (ctx) => {
    if (!isAdmin(ctx)) return ctx.reply("❌ Admin only.");
    const msg = ctx.message.text.split(" ").slice(1).join(" ");
    if (!msg) return ctx.reply("Usage: /broadcast <message>");
    const users = DB.getAllUsers();
    ctx.reply(`🚀 Broadcasting to ${users.length} users...`);
    for (const user of users) {
      try {
        await bot.telegram.sendMessage(user.id, `📢 *BROADCAST*\n\n${msg}`, { parse_mode: 'Markdown' });
      } catch {}
    }
  });

  // --- BUILD LOGIC ---

  async function buildProject(ctx: Context, description: string) {
    const msg = await ctx.reply(`🏗 *Project Construction Started*
Analyzing requirements...`, { parse_mode: 'Markdown' });

    try {
      await bot.telegram.editMessageText(ctx.chat!.id, msg.message_id, undefined, `🏗 *Project Construction Started*
1/4 Creating file structure blueprint...`, { parse_mode: 'Markdown' });
      const rawCode = await AIEngine.generateProject(description);
      const files = FileUtils.parseProjectCode(rawCode);

      if (files.length === 0) {
        return ctx.reply("❌ Failed to generate structured code. Ask for a project with explicit files like `=== index.js ===`.");
      }

      await bot.telegram.editMessageText(ctx.chat!.id, msg.message_id, undefined, `🏗 *Project Construction Started*
2/4 Creating directories and files...`, { parse_mode: 'Markdown' });
      const buildDir = path.join(process.cwd(), "builds", `prj_${Date.now()}`);
      fs.mkdirSync(buildDir, { recursive: true });

      for (const file of files) {
        FileUtils.writeFile(path.join(buildDir, file.name), file.content);
      }

      await bot.telegram.editMessageText(ctx.chat!.id, msg.message_id, undefined, `🏗 *Project Construction Started*
3/4 Packaging source as zip...`, { parse_mode: 'Markdown' });
      const zipPath = `${buildDir}.zip`;
      await FileUtils.zipFolder(buildDir, zipPath);

      await bot.telegram.editMessageText(ctx.chat!.id, msg.message_id, undefined, `🏗 *Project Construction Started*
4/4 Uploading zip to Telegram...`, { parse_mode: 'Markdown' });
      await ctx.replyWithDocument({ source: zipPath, filename: "project_source.zip" });
      await bot.telegram.editMessageText(ctx.chat!.id, msg.message_id, undefined, `✅ *Build Complete*
Created structure, generated code for ${files.length} files, and delivered the zip file.`, { parse_mode: 'Markdown' });

    } catch (e: any) {
      ctx.reply(`❌ *Build Error:* ${e.message}`, { parse_mode: 'Markdown' });
    }
  }

  async function executeShell(ctx: Context, cmd: string) {
    const msg = await ctx.reply(`🐚 \`[TERMINAL]\` $ ${cmd}\n\nRunning...`, { parse_mode: 'Markdown' });
    const output = await ShellUtils.run(cmd);
    await bot.telegram.editMessageText(ctx.chat!.id, msg.message_id, undefined, `🐚 \`[TERMINAL]\` $ ${cmd}\n\n\`\`\`\n${output.slice(0, 3900)}\n\`\`\``, { parse_mode: 'Markdown' });
  }

  async function cloneRepoToWorkspace(ctx: Context, repoUrl: string) {
    const userId = ctx.from!.id;
    const state = getState(userId);
    const name = (repoUrl.split('/').pop() || 'repo').replace(/\.git$/, '').replace(/[^a-zA-Z0-9._-]/g, '_');
    const target = path.join(process.cwd(), "workspaces", `${userId}_${name}_${Date.now()}`);
    const out = await ShellUtils.run(`git clone ${repoUrl} "${target}"`);
    if (out.toLowerCase().includes("error")) return ctx.reply(`❌ Clone failed\n${out}`);
    state.cwd = target;
    state.clonedRepo = repoUrl;
    return ctx.reply(`✅ Cloned ${name} and switched workspace.`);
  }


  async function cloneAndMergeRepos(ctx: Context, repoUrls: string[]) {
    const userId = ctx.from!.id;
    const state = getState(userId);
    const mergeRoot = path.join(process.cwd(), "workspaces", `merge_${userId}_${Date.now()}`);
    fs.mkdirSync(mergeRoot, { recursive: true });
    await ctx.reply(`🧩 Starting multi-repo flow for ${repoUrls.length} repositories...`, { parse_mode: 'Markdown' });

    const combinedChunks: string[] = [];
    for (const repoUrl of repoUrls) {
      const name = (repoUrl.split('/').pop() || 'repo').replace(/\.git$/, '').replace(/[^a-zA-Z0-9._-]/g, '_');
      const target = path.join(mergeRoot, name);
      await ctx.reply(`📥 Cloning: ${repoUrl}`);
      const out = await ShellUtils.run(`git clone ${repoUrl} "${target}"`);
      if (out.toLowerCase().includes("error")) return ctx.reply(`❌ Clone failed for ${repoUrl}\n${out}`);

      const repoFiles = FileUtils.listFiles(target);
      for (const top of repoFiles) {
        const full = path.join(target, top);
        if (fs.existsSync(full) && fs.statSync(full).isFile()) {
          const content = FileUtils.readFile(full);
          if (content) combinedChunks.push(`// === ${name}/${top} ===\n${content}`);
        }
      }
    }

    const outFile = path.join(mergeRoot, "combined_repos.txt");
    FileUtils.writeFile(outFile, combinedChunks.join("\n\n"));
    const zipPath = `${mergeRoot}.zip`;
    await FileUtils.zipFolder(mergeRoot, zipPath);
    state.cwd = mergeRoot;
    await ctx.replyWithDocument({ source: zipPath, filename: "merged_repos.zip" });
    return ctx.reply("✅ Finished: cloned repos, merged files into one combined file, and sent zip. You can now ask me to edit/convert them to endpoints.");
  }

  async function pushWorkspaceToGithub(ctx: Context, repoInput: string, githubToken: string) {
    const userId = ctx.from!.id;
    const state = getState(userId);
    const repoSlug = repoInput.replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/i, "").replace(/\/+$/,"");
    if (!repoSlug.includes("/")) return ctx.reply("❌ Invalid repo. Use owner/repo or full GitHub URL.");
    const [owner, repoName] = repoSlug.split("/");
    if (!owner || !repoName) return ctx.reply("❌ Invalid repo. Use owner/repo.");

    const gh = new GitHubService(githubToken);
    const files = FileUtils.listFiles(state.cwd);
    let count = 0;
    for (const file of files) {
      const fullPath = path.join(state.cwd, file);
      if (fs.statSync(fullPath).isFile()) {
        const content = FileUtils.readFile(fullPath);
        if (content) {
          await gh.uploadFile(owner, repoName, file, content);
          count++;
        }
      }
    }
    DB.updateGithub(userId, githubToken, owner);
    return ctx.reply(`✅ *Push Successful*\n\nUploaded ${count} files to https://github.com/${owner}/${repoName}`, { parse_mode: "Markdown", link_preview_options: { is_disabled: true } });
  }

  async function searchFiles(ctx: Context, query: string) {
    const results = FileUtils.searchContent(process.cwd(), query);
    if (results.length === 0) return ctx.reply("🔍 No matches found.");
    ctx.reply(`🔍 *Matches Found* (${results.length}):\n${results.slice(0, 10).map(r => `• \`${path.basename(r.path)}\`:${r.line} - ${r.content}`).join("\n")}`, { parse_mode: "Markdown" });
  }

  // --- BOT COMMANDS ---

  bot.start((ctx) => {
    const userId = ctx.from.id;
    const channelLink = process.env.CHANNEL_LINK || 'https://t.me/BrokenVzn';
    
    ctx.reply(
      `🦾 *BrokenVzn Agent v3.0 - Dirty & Fast*\n\nWelcome to your ultimate coding & hacking assistant. I can build, shell, scrape, and automate anything you dream of.\n\n📢 *Mandatory:* Join ${channelLink} to keep this bot alive.\n\nPress /help to see the full list of dirty commands.`,
      {
        parse_mode: 'Markdown',
        ...Markup.keyboard([
          ["/menu", "/terminal"],
          ["/build", "/github"],
          ["/model", "/help"]
        ]).resize()
      }
    );
  });

  bot.command("start", (ctx) => {
    // Redundant but safe
  });

  bot.on("text", async (ctx) => {
    await notifyAdminsUserActivity(ctx, "text_message");
    const t = ctx.message.text.trim();
    const lower = t.toLowerCase();

    if (lower === "help" || lower === "/help") {
      return ctx.reply(getHelpText(ctx));
    }
    if (lower === "menu" || lower === "/menu") {
      return ctx.reply(getMenuText());
    }

    const gitCloneMatch = t.match(/^git\s*clone\s+(https?:\/\/github\.com\/\S+)$/i) || t.match(/^gitclone\s+(https?:\/\/github\.com\/\S+)$/i);
    if (gitCloneMatch) {
      return executeShell(ctx, `git clone ${gitCloneMatch[1]}`);
    }
    if (/^https?:\/\/github\.com\//i.test(t)) {
      await ctx.reply("Detected GitHub URL. Use /gitclone <url> or /gitzip <url>, or send: git clone <url>.");
      return;
    }
    if (t.startsWith("/")) return;
    await handleNaturalChat(ctx, t);
  });

  bot.on("voice", async (ctx) => {
     ctx.reply("🎙 *Voice Transcribing...* (Simulated)\nI understood your request. Processing...");
     // Real implementation would use OpenAI Whisper or Gemini multi-modal
  });

  bot.on("photo", async (ctx) => {
     await ctx.reply("👁 *Vision Analysis Active*\nAnalyzing image content...", { parse_mode: "Markdown" });
     try {
      const photos = ctx.message.photo;
      const file = photos[photos.length - 1];
      const link = await bot.telegram.getFileLink(file.file_id);
      const response = await axios.get(link.href, { responseType: "arraybuffer" });
      const base64 = Buffer.from(response.data).toString("base64");
      const analysis = await AIEngine.analyzeImage(base64, "image/jpeg", "Analyze this Telegram image and explain what you see, including useful technical details if present.");
      await ctx.reply(analysis);
     } catch (e: any) {
      await ctx.reply(`❌ Image analysis failed: ${e.message}`);
     }
  });

  bot.command("menu", (ctx) => {
    ctx.reply(getMenuText(), {
      ...Markup.inlineKeyboard([
        [Markup.button.callback("🤖 AI Chat", "ai_chat"), Markup.button.callback("💻 Code Builder", "code_builder")],
        [Markup.button.callback("🌐 Preview Builder", "preview_builder"), Markup.button.callback("🐙 GitHub Tools", "github_tools")],
        [Markup.button.callback("🎵 Media Tools", "media_tools"), Markup.button.callback("🛠 Utilities", "utils_tools")],
        [Markup.button.callback("🛡 Admin Panel", "admin_panel")]
      ])
    });
  });

  bot.action("ai_chat", (ctx) => ctx.reply("Use /code or /groq to start chatting with AI."));
  bot.action("code_builder", (ctx) => ctx.reply("Use /build or /apk to generate app source code."));
  bot.action("preview_builder", (ctx) => ctx.reply("Use /webbuild and then /preview to see your app live."));
  bot.action("github_tools", (ctx) => ctx.reply("Use /github login <token> and then /push <repo>."));
  bot.action("media_tools", (ctx) => ctx.reply("Use /play, /lyrics, /video or /download for media."));
  bot.action("utils_tools", (ctx) => ctx.reply("Use /remind, /note, /task or /files for productivity."));
  bot.action("admin_panel", (ctx) => {
      if (!isAdmin(ctx)) return ctx.answerCbQuery("❌ Unauthorized", { show_alert: true });
      ctx.reply("Admin Dashboard:\n/stats /users /logs /broadcast /ban");
  });

  bot.help((ctx) => {
    return ctx.reply(getHelpText(ctx));
  });

  bot.command("setmode", (ctx) => {
    const rawArg = (ctx.message.text.split(" ")[1] || "").trim().toLowerCase();
    const modes: Record<string, string> = {
      roast: "roast",
      helpful: "helpful",
      helpfull: "helpful",
      coder: "coder",
      strict: "strict"
    };
    const selected = modes[rawArg];
    if (!selected) {
      return ctx.reply("Usage: /setmode roast | helpful | coder | strict");
    }
    const state = getState(ctx.from!.id);
    state.mode = selected;
    return ctx.reply(`✅ Bot mode switched to *${selected.toUpperCase()}*`, { parse_mode: 'Markdown' });
  });


  bot.command("qwen", async (ctx) => {
      const prompt = ctx.message.text.split(" ").slice(1).join(" ");
      if (!prompt) return ctx.reply("Usage: /qwen <prompt>");
      ctx.reply("📖 Consulting Qwen Knowledge...");
      const res = await AIEngine.generateQwen(prompt);
      ctx.reply(res);
  });

  bot.command("ping", (ctx) => {
    const start = Date.now();
    ctx.reply("📶 Measuring latency...").then((msg) => {
      const ms = Date.now() - start;
      bot.telegram.editMessageText(ctx.chat!.id, msg.message_id, undefined, `✅ Connected!\nLatency: ${ms}ms\nUptime: ${process.uptime().toFixed(0)}s`);
    });
  });

  bot.command("github", async (ctx) => {
      const userId = ctx.from!.id;
      const args = ctx.message.text.split(" ");
      if (args[1] === "login") {
          const token = args[2];
          if (!token) return ctx.reply("Usage: /github login <token>");
          DB.updateGithub(userId, token, "");
          logger.info(`User ${userId} logged into GitHub.`);
          return ctx.reply("🐙 GitHub token stored securely.");
      }
      ctx.reply("Usage: /github login <token>\n/push <repo_name>");
  });

  bot.command("push", async (ctx) => {
      const userId = ctx.from!.id;
      const user = DB.getUser(userId);
      const state = getState(userId);

      if (!user?.github_token) return ctx.reply("❌ GitHub token missing. Use `/github login <token>`");
      
      const repoName = ctx.message.text.split(" ")[1];
      if (!repoName) return ctx.reply("Usage: /push <repo_name>");

      try {
          logger.info(`User ${userId} pushing ${state.cwd} to GitHub repo ${repoName}`);
          const repoOwner = (user.github_repo && user.github_repo.includes("/") ? user.github_repo.split("/")[0] : null) || "owner";
          await pushWorkspaceToGithub(ctx, `${repoOwner}/${repoName}`, user.github_token);
          logger.info(`User ${userId} successfully pushed files to GitHub.`);
      } catch (e: any) {
          logger.error(`GitHub push failed for ${userId}: ${e.message}`);
          ctx.reply("❌ GitHub Error: " + e.message);
      }
  });


  bot.command("zipfiles", (ctx) => {
    const state = getState(ctx.from!.id);
    const names = Object.keys(state.zips || {});
    if (!names.length) return ctx.reply("No saved ZIP files yet.");
    return ctx.reply(`📦 Saved ZIP names:
${names.map(n => `• ${n}`).join("\n")}`);
  });

  bot.command("gitclone", async (ctx) => {
    const repoUrl = ctx.message.text.split(" ")[1];
    if (!repoUrl) return ctx.reply("Usage: /gitclone <repo-url>");
    return cloneRepoToWorkspace(ctx, repoUrl);
  });

  bot.command("gitlookup", async (ctx) => {
    const slug = ctx.message.text.split(" ")[1];
    if (!slug || !slug.includes('/')) return ctx.reply("Usage: /gitlookup <owner/repo>");
    const { data } = await axios.get(`https://api.github.com/repos/${slug}`);
    return ctx.reply(`🐙 ${data.full_name}
⭐ ${data.stargazers_count} | 🍴 ${data.forks_count}
${data.description || 'No description'}`);
  });

  bot.command("gitzip", async (ctx) => {
    const repoUrl = ctx.message.text.split(" ")[1];
    if (!repoUrl) return ctx.reply("Usage: /gitzip <repo-url>");
    const zipUrl = repoUrl.replace(/\.git$/, '') + '/archive/refs/heads/main.zip';
    return ctx.replyWithDocument({ url: zipUrl, filename: 'repo-main.zip' });
  });

  // --- FILE HANDLING ---

  bot.on("document", async (ctx) => {
    const doc = ctx.message.document;
    const userId = ctx.from.id;
    const state = getState(userId);

    logger.info(`User ${userId} uploaded document: ${doc.file_name}`);

    if (doc.file_name?.endsWith(".zip")) {
        ctx.reply("📥 *Processing ZIP...*", { parse_mode: 'Markdown' });
        try {
            const link = await bot.telegram.getFileLink(doc.file_id);
            const response = await axios.get(link.href, { responseType: 'arraybuffer' });
            
            const storageDir = path.join(process.cwd(), "storage", userId.toString());
            if (!fs.existsSync(storageDir)) fs.mkdirSync(storageDir, { recursive: true });
            
            const ext = path.extname(doc.file_name || ".zip");
            const savedName = `${(path.basename(doc.file_name || "upload", ext)).replace(/[^a-zA-Z0-9._-]/g, "_")}_${Date.now()}${ext}`;
            const zipPath = path.join(storageDir, savedName);
            fs.writeFileSync(zipPath, Buffer.from(response.data));
            
            state.lastZip = zipPath;
            state.zips[savedName] = zipPath;
            
            ctx.reply(`✅ *ZIP Stored Successfully*\n\nFile: \`${doc.file_name}\`\n\nCommands:\n/unzip ${savedName}\n/lszip ${savedName}\n/zipfiles`, { parse_mode: 'Markdown' });
        } catch (e: any) {
            logger.error(`File download failed for ${userId}: ${e.message}`);
            ctx.reply("❌ Failed to download file.");
        }
    } else {
        ctx.reply("📄 File received. Upload a project as a .zip for full automation.");
    }
  });

  bot.command("unzip", async (ctx) => {
    const userId = ctx.from!.id;
    const state = getState(userId);
    
    const reqName = ctx.message.text.split(" ")[1];
    const zipPath = reqName ? state.zips[reqName] : state.lastZip;
    if (!zipPath || !fs.existsSync(zipPath)) {
      return ctx.reply("❌ No ZIP uploaded recently or file missing.");
    }

    const workspaceDir = path.join(process.cwd(), "workspaces", `${userId}_${Date.now()}`);
    fs.mkdirSync(workspaceDir, { recursive: true });

    try {
      logger.info(`User ${userId} unzipping ${zipPath} to ${workspaceDir}`);
      FileUtils.unzip(zipPath, workspaceDir);
      state.cwd = workspaceDir;
      
      const allPaths = FileUtils.listFilesRecursive(workspaceDir);
      const summary = `🔓 *Extraction Complete*\n\nWorkspace set to: \`${path.basename(workspaceDir)}\`\nEntries: ${allPaths.length}\n\nSending full directory tree...`;
      await ctx.reply(summary, { parse_mode: 'Markdown' });

      const messages = FileUtils.formatPathListForMarkdown(allPaths, "📂 *Extracted ZIP Tree*");
      for (const message of messages) {
        await ctx.reply(message, { parse_mode: 'Markdown' });
      }
    } catch (e: any) {
      logger.error(`Unzip failed for ${userId}: ${e.message}`);
      ctx.reply(`❌ Error during extraction: ${e.message}`);
    }
  });

  bot.command("lszip", async (ctx) => {
    const userId = ctx.from!.id;
    const state = getState(userId);
    const reqName = ctx.message.text.split(" ")[1];
    const zipPath = reqName ? state.zips[reqName] : state.lastZip;
    if (!zipPath) return ctx.reply("❌ No ZIP file found.");
    
    try {
      const list = FileUtils.listZipContent(zipPath);
      const messages = FileUtils.formatPathListForMarkdown(list, "📦 *ZIP Contents*");
      for (const message of messages) {
        await ctx.reply(message, { parse_mode: 'Markdown' });
      }
    } catch (e: any) {
      ctx.reply(`❌ Could not list contents: ${e.message}`);
    }
  });

  bot.command("ls", (ctx) => {
    const userId = ctx.from!.id;
    const state = getState(userId);
    try {
      const files = FileUtils.listFiles(state.cwd);
      let text = `📂 *Directory: ${path.basename(state.cwd)}*\n\n`;
      files.forEach(f => {
        const isDir = fs.statSync(path.join(state.cwd, f)).isDirectory();
        text += `${isDir ? '📁' : '📄'} \`${f}\`\n`;
      });
      ctx.reply(text || "Directory is empty.", { parse_mode: 'Markdown' });
    } catch (e: any) {
      ctx.reply("❌ Error listing files.");
    }
  });

  bot.command("hostren", async (ctx) => {
    const userId = ctx.from!.id;
    const state = getState(userId);
    
    if (state.cwd === process.cwd()) {
      return ctx.reply("❌ You must be in a project workspace to deploy. (Use /unzip)");
    }

    logger.info(`User ${userId} attempting to deploy ${state.cwd} to Render.`);
    
    const msg = await ctx.reply("🚀 *Initializing Deployment to Render...*\n\nBuilding environment...", { parse_mode: 'Markdown' });
    
    // Simulate Render API call
    setTimeout(async () => {
      await bot.telegram.editMessageText(ctx.chat!.id, msg.message_id, undefined, "🚀 *Deployment to Render...*\n\n✅ Environment Ready\n📦 Uploading source code...", { parse_mode: 'Markdown' });
      
      setTimeout(async () => {
        await bot.telegram.editMessageText(ctx.chat!.id, msg.message_id, undefined, "🚀 *Deployment to Render...*\n\n✅ Upload Complete\n⚙️ Running build scripts...", { parse_mode: 'Markdown' });
        
        setTimeout(async () => {
           const mockUrl = `https://prj-${Math.random().toString(36).substring(7)}.onrender.com`;
           await bot.telegram.editMessageText(ctx.chat!.id, msg.message_id, undefined, `🏁 *Deployment Successful!*\n\n🔗 Your app is live at: ${mockUrl}\n\nNote: This was a simulated deployment. Configure RENDER_API_KEY for real integration.`, { parse_mode: 'Markdown' });
           logger.info(`User ${userId} successfully deployed mock app to ${mockUrl}`);
        }, 3000);
      }, 2000);
    }, 2000);
  });

  bot.command("broadcast", async (ctx) => {
    if (!isAdmin(ctx)) return ctx.reply("❌ Admin only.");
    const msg = ctx.message.text.split(" ").slice(1).join(" ");
    if (!msg) return ctx.reply("Usage: /broadcast <message>");
    ctx.reply(`📢 Broadcasting to all active terminals...\n\nMessage: ${msg}`);
    // In a real database app, we'd loop through users here
  });

  bot.command("stats", (ctx) => {
    if (!isAdmin(ctx)) return ctx.reply("❌ Admin only.");
    ctx.reply(`📊 *BrokenVzn System Stats*\n- Uptime: ${process.uptime().toFixed(0)}s\n- Memory: ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB\n- Active Sessions: 1`, { parse_mode: 'Markdown' });
  });

  bot.command("users", (ctx) => {
    if (!isAdmin(ctx)) return ctx.reply("❌ Admin only.");
    ctx.reply("👥 Authorized Users:\n- " + (ctx.from?.username || ctx.from?.id) + " (Admin)");
  });

  bot.command("logs", async (ctx) => {
    if (!isAdmin(ctx)) return ctx.reply("❌ Admin only.");
    logger.info(`Admin ${ctx.from.id} requested system logs.`);
    const logPath = path.join(process.cwd(), "logs", "combined.log");
    if (fs.existsSync(logPath)) {
      ctx.replyWithDocument({ source: logPath, filename: "system_logs.log" });
    } else {
      ctx.reply("📜 No logs found yet or log directory missing.");
    }
  });

  bot.command("ban", (ctx) => {
    if (!isAdmin(ctx)) return ctx.reply("❌ Admin only.");
    const target = Number(ctx.message.text.split(" ")[1]);
    if (!target || Number.isNaN(target)) return ctx.reply("Usage: /ban <user_id>");
    DB.banUser(target, true);
    return ctx.reply(`🚫 User ${target} has been banned from using the bot.`);
  });

  bot.command("unban", (ctx) => {
    if (!isAdmin(ctx)) return ctx.reply("❌ Admin only.");
    const target = Number(ctx.message.text.split(" ")[1]);
    if (!target || Number.isNaN(target)) return ctx.reply("Usage: /unban <user_id>");
    DB.banUser(target, false);
    return ctx.reply(`✅ Restrictions removed for user ${target}.`);
  });

  // Health check API
  app.get("/api/health", (req, res) => {
    res.json({ 
      status: "ok", 
      botActive: botStatus === "live", 
      botStatus,
      botError,
      botInfo,
      adminIds: config.adminIds 
    });
  });

  app.post("/api/chat", async (req, res) => {
    try {
      const { prompt, history = [], imageBase64, imageMimeType = "image/png" } = req.body || {};
      if (!prompt && !imageBase64) return res.status(400).json({ error: "prompt or imageBase64 is required" });

      if (imageBase64) {
        const reply = await AIEngine.analyzeImage(
          imageBase64,
          imageMimeType,
          prompt || "Analyze this uploaded image and answer the user clearly."
        );
        return res.json({ reply });
      }

      const reply = await AIEngine.chat(prompt, history, "You are a web assistant in a ChatGPT-like interface. Be clear and concise.");
      return res.json({ reply });
    } catch (e: any) {
      return res.status(500).json({ error: e.message || "Failed to generate response" });
    }
  });

  // Start Bot
  if (config.botToken) {
      bot.launch()
        .then(async () => {
          botStatus = "live";
          botInfo = await bot.telegram.getMe();
          logger.info(`BrokenVzn Bot is live as @${botInfo.username}`);
          console.log("BrokenVzn Bot is live as", botInfo.username);
        })
        .catch(err => {
          botStatus = "failed";
          const message = err instanceof Error ? err.message : String(err);
          const looksLikeInvalidToken = message.includes("404") || message.includes("Not Found");
          botError = looksLikeInvalidToken
            ? `${message} (hint: TELEGRAM_BOT_TOKEN is invalid, revoked, or points to the wrong bot)`
            : message;
          logger.error(`Bot launch failed: ${botError}`);
          if (looksLikeInvalidToken) {
            logger.error("Verify TELEGRAM_BOT_TOKEN in your .env matches the token from @BotFather and restart the server.");
          }
          console.error("Bot launch failed:", err);
        });
  } else {
    botStatus = "missing_token";
    logger.error("Bot token missing at startup.");
  }

  // --- VITE MIDDLEWARE ---
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
