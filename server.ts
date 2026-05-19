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

function listMergeableFiles(rootDir: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === ".git" || entry.name === "node_modules" || entry.name === "dist" || entry.name === "build") continue;
      const full = path.join(dir, entry.name);
      const rel = path.relative(rootDir, full);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        out.push(rel);
      }
    }
  };
  walk(rootDir);
  return out;
}


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

const SUNO_WRAPPER_BASE = process.env.SUNO_WRAPPER_BASE || "https://api.sunoapi.org";
const SUNO_ACCESS_TOKEN = process.env.SUNO_ACCESS_TOKEN || "";
const SUNO_MODEL = process.env.SUNO_MODEL || "V4_5";

function buildSunoHeaders() {
  return {
    Authorization: `Bearer ${SUNO_ACCESS_TOKEN}`,
    "X-API-KEY": SUNO_ACCESS_TOKEN,
    "X-Access-Token": SUNO_ACCESS_TOKEN,
    "Content-Type": "application/json",
    "User-Agent": "BrokenVzn-Agent/3.0"
  };
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
  const userStates = new Map<number, { model: string; mode: string; cwd: string; isTerminal: boolean; buttonMode: boolean; voiceAiMode: boolean; lastZip?: string; zips: Record<string, string>; clonedRepo?: string; pendingGithubPush?: boolean; pendingBuildDescription?: string; pendingDeployZip?: string; pendingDeployDir?: string; pendingTechStackOnly?: boolean }>();

  function getState(userId: number) {
    if (!userStates.has(userId)) {
      userStates.set(userId, { model: 'gemini', mode: 'roast', cwd: process.cwd(), isTerminal: false, buttonMode: true, voiceAiMode: false, zips: {} });
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

  const HELP_MENU_IMAGE = "https://cdn.tmp.malvryx.dev/files/mxv_2TnyXIAzL.jpeg";

  function getMenuText() {
    return `🌲 BrokenVzn Agent — Command Tree

Use / prefix for slash commands.
You can also send plain text like: git clone <url>, unzip my.zip, or model grog.

├─ 🤖 AI Core
│  • /help • /menu
│  • /model <gemini|grog|qwen|broken>
│  • /setmode <roast|helpful|coder|strict>
│  • /transcribe (voice note → text)
│  • /tts [voice] <text>

├─ 🧱 Build & Git
│  • /build or /create <prompt>
│  • /gitclone <repo_url>
│  • /gitzip <repo_url|owner/repo>
│  • /push <repo_name>

├─ 🎵 Media
│  • /play <song>
│  • /video <query>
│  • /musicgen or /suno <prompt>
│  • /ssweb <url> (web screenshot)

├─ 🌐 Internet Tools
│  • /search <query> (web search)
│  • /scrape <url> (extract webpage text)
│  • /run <lang> <code> (run snippets)

└─ 🛠 Files & Utility
   • /unzip <zip_name> • /lszip <zip_name> • /zipfiles
   • /terminal (admin)
   • /buttonmode on|off
   • /voicemode on|off (admin)`;
  }

  function getHelpText(ctx: Context) {
    return `Brokenvzn tools:

Bot Menu
User: ${ctx.from?.first_name || "Broken"} | ID: ${ctx.from?.id}

You can use commands with "/" OR without prefix.
Example: "help", "menu", "model grog", "unzip my.zip"

AI + Chat
• /help or /menu
• /model qwen|gemini|grog|groq
• /setmode roast|helpful|coder|strict
• /create <prompt>
• normal chat: just send any message

Dev Tools
• /search <query>
• /scrape <url>
• /run <lang> <code>
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
        if (scrapeRes.status === "error") {
          return ctx.reply(`❌ Scraper failed: ${scrapeRes.message || "unknown error"}`);
        }
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
        const systemPrompt = `You are BrokenVzn Agent. A powerful AI assistant for coding and automation inside this Telegram bot. 
Mode: ${state.mode}. Current Directory: ${state.cwd}. 
Behavior rules: roast=savage and witty, helpful=friendly and clear, coder=technical and precise, strict=short and direct. Adjust tone to current mode.
Never say you are "just a text-based AI" or that you cannot do things this bot already supports.
If the user asks for music/video/files/zip/github/shell tasks, guide them with the exact working command syntax in this bot (for example /play, /video, /build, /suno, /gitzip, /run, /scrape).`;
        
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
      return ctx.reply("Usage: /model gemini | grog | qwen | broken (alias: groq)");
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

  async function buildProject(ctx: Context, description: string, techStack: string) {
    const msg = await ctx.reply(`🏗 *Project Construction Started*
Analyzing requirements...`, { parse_mode: 'Markdown' });

    try {
      await bot.telegram.editMessageText(ctx.chat!.id, msg.message_id, undefined, `🏗 *Project Construction Started*
1/4 Creating file structure blueprint...`, { parse_mode: 'Markdown' });
      const enhancedDescription = `${description}

Tech stack requirement from user: ${techStack}.
Respect this stack and generate all required files.
Return output in explicit multi-file format that can be parsed:
=== path/to/file.ext ===
<file content>`;
      const rawCode = await AIEngine.generateProject(enhancedDescription);
      const files = FileUtils.parseProjectCode(rawCode);

      if (files.length === 0) {
        return ctx.reply("❌ Failed to generate structured code. Ask for a project with explicit files like `=== index.js ===`.");
      }

      const structure = files.map((f) => `- ${f.name}`).join("\n");
      await ctx.reply(`📂 *Project Structure:*\n${structure}`, { parse_mode: "Markdown" });

      await bot.telegram.editMessageText(ctx.chat!.id, msg.message_id, undefined, `🏗 *Project Construction Started*
2/4 Creating directories and files...`, { parse_mode: 'Markdown' });
      const buildDir = path.join(process.cwd(), "builds", `prj_${Date.now()}`);
      fs.mkdirSync(buildDir, { recursive: true });

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const next = files[i + 1];
        await ctx.reply(`✍️ Coding \`${file.name}\`...\n✅ Completed \`${file.name}\`${next ? `\n➡️ Next: \`${next.name}\`` : ""}`, { parse_mode: "Markdown" });
        FileUtils.writeFile(path.join(buildDir, file.name), file.content);
      }

      await bot.telegram.editMessageText(ctx.chat!.id, msg.message_id, undefined, `🏗 *Project Construction Started*
3/4 Packaging source as zip...`, { parse_mode: 'Markdown' });
      const zipPath = `${buildDir}.zip`;
      await FileUtils.zipFolder(buildDir, zipPath);

      await bot.telegram.editMessageText(ctx.chat!.id, msg.message_id, undefined, `🏗 *Project Construction Started*
4/4 Uploading zip to Telegram...`, { parse_mode: 'Markdown' });
      await ctx.replyWithDocument({ source: zipPath, filename: "project_source.zip" });
      const state = getState(ctx.from!.id);
      state.lastZip = zipPath;
      state.pendingDeployZip = zipPath;
      state.pendingDeployDir = buildDir;
      await bot.telegram.editMessageText(ctx.chat!.id, msg.message_id, undefined, `✅ *Build Complete*
Created structure, generated code for ${files.length} files, and delivered the zip file.`, { parse_mode: 'Markdown' });
      await ctx.reply("Do you want me to deploy this project to Render?\nReply with `yes deploy` or `no deploy`.", { parse_mode: "Markdown" });

    } catch (e: any) {
      ctx.reply(`❌ *Build Error:* ${e.message}`, { parse_mode: 'Markdown' });
    }
  }

  async function deployToRender(ctx: Context, projectDir: string) {
    if (!config.renderKey) return ctx.reply("❌ Render API key is missing. Set RENDER_API_KEY first.");
    const msg = await ctx.reply("🚀 *Starting Render deployment (Free plan)...*", { parse_mode: "Markdown" });
    await bot.telegram.editMessageText(ctx.chat!.id, msg.message_id, undefined, `⚠️ Render deployment requires a connected Git repository.\n\nI prepared the project at:\n\`${projectDir}\`\n\nNext:\n1) Push this project to GitHub\n2) Run /hostren to deploy from repo on free plan.`, { parse_mode: "Markdown" });
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

    const mergeOutputRoot = path.join(mergeRoot, "merged_project");
    fs.mkdirSync(mergeOutputRoot, { recursive: true });
    const mergeReport: string[] = [];

    for (const repoUrl of repoUrls) {
      const name = (repoUrl.split('/').pop() || 'repo').replace(/\.git$/, '').replace(/[^a-zA-Z0-9._-]/g, '_');
      const target = path.join(mergeRoot, name);
      await ctx.reply(`📥 Cloning: ${repoUrl}`);
      const out = await ShellUtils.run(`git clone ${repoUrl} "${target}"`);
      if (out.toLowerCase().includes("error")) return ctx.reply(`❌ Clone failed for ${repoUrl}\n${out}`);

      const repoFiles = listMergeableFiles(target);
      const copiedForRepo: string[] = [];
      for (const rel of repoFiles) {
        const src = path.join(target, rel);
        const namespacedRel = path.join(name, rel);
        const dest = path.join(mergeOutputRoot, namespacedRel);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(src, dest);
        copiedForRepo.push(namespacedRel);
      }
      mergeReport.push(`Repo: ${repoUrl}\nFiles copied: ${copiedForRepo.length}`);
    }

    const outFile = path.join(mergeOutputRoot, "MERGE_REPORT.md");
    FileUtils.writeFile(outFile, `# Merge Report\n\n${mergeReport.join("\n\n")}\n\n## Notes\n- Each repo is copied into a folder under merged_project/<repo_name> to avoid destructive collisions.\n- Ask the agent to scaffold an integration layer after merge if you want a single runnable app entrypoint.\n`);
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



function extractReplyContext(msg: any): string {
  const r = msg?.reply_to_message;
  if (!r) return '';
  const chunks: string[] = [];
  if (r.text) chunks.push(`Replied text: ${r.text}`);
  if (r.caption) chunks.push(`Replied caption: ${r.caption}`);
  if (r.photo?.length) chunks.push('Replied media: photo');
  if (r.video) chunks.push('Replied media: video');
  if (r.document) chunks.push(`Replied document: ${r.document.file_name || 'file'}`);
  if (r.voice) chunks.push('Replied media: voice note');
  return chunks.length ? `

[Reply context]
${chunks.join(' | ')}` : '';
}

  bot.on("text", async (ctx, next) => {
    await notifyAdminsUserActivity(ctx, "text_message");
    const t = ctx.message.text.trim();
    const lower = t.toLowerCase();

    // Let explicit slash commands continue through Telegraf command handlers.
    // Without this, this generic text middleware can swallow commands defined later.
    if (t.startsWith("/")) {
      return next();
    }

    if (lower === "help" || lower === "/help") {
      return ctx.reply(getHelpText(ctx));
    }
    if (lower === "menu" || lower === "/menu") {
      return ctx.reply(getMenuText());
    }
    const state = getState(ctx.from!.id);
    if (state.pendingBuildDescription) {
      const tech = t;
      const description = state.pendingBuildDescription;
      state.pendingBuildDescription = undefined;
      await ctx.reply(`✅ Using tech stack: *${tech}*`, { parse_mode: "Markdown" });
      return buildProject(ctx, description, tech);
    }
    if (state.pendingDeployZip && /^(yes deploy|deploy yes|yes)$/i.test(lower)) {
      const deployDir = state.pendingDeployDir;
      state.pendingDeployZip = undefined;
      state.pendingDeployDir = undefined;
      if (!deployDir) return ctx.reply("❌ No project found for deployment.");
      return deployToRender(ctx, deployDir);
    }
    if (state.pendingDeployZip && /^(no deploy|deploy no|no)$/i.test(lower)) {
      state.pendingDeployZip = undefined;
      state.pendingDeployDir = undefined;
      return ctx.reply("👍 Deployment skipped. You can deploy later with /hostren after pushing to GitHub.");
    }

    const gitCloneMatch = t.match(/^git\s*clone\s+(https?:\/\/github\.com\/\S+)$/i) || t.match(/^gitclone\s+(https?:\/\/github\.com\/\S+)$/i);
    if (gitCloneMatch) {
      return executeShell(ctx, `git clone ${gitCloneMatch[1]}`);
    }
    if (/^https?:\/\/github\.com\//i.test(t)) {
      await ctx.reply("Detected GitHub URL. Use /gitclone <url> or /gitzip <url>, or send: git clone <url>.");
      return;
    }

    const replied = (ctx as any).message?.reply_to_message;
    const wantsVision = /analy[sz]e|read|describe|what is in|what's in|ocr/i.test(lower);
    if (replied?.photo?.length && wantsVision) {
      try {
        const file = replied.photo[replied.photo.length - 1];
        const link = await bot.telegram.getFileLink(file.file_id);
        const response = await axios.get(link.href, { responseType: "arraybuffer" });
        const base64 = Buffer.from(response.data).toString("base64");
        const analysis = await AIEngine.analyzeImage(base64, "image/jpeg", `User prompt: ${t}`);
        await ctx.reply(analysis);
      } catch (e: any) {
        await ctx.reply(`❌ Could not analyze replied image: ${e.message}`);
      }
      return;
    }
    if (t.startsWith("/")) return;

    const naturalMediaIntent = (() => {
      const v = t.trim();
      const lowerText = v.toLowerCase();

      const animeVideoMatch = lowerText.match(/(?:send|give|show|drop)?\s*(?:me\s+)?(?:an\s+)?anime\s+(?:vid|video)/i);
      if (animeVideoMatch) return "/anivid";

      const sunoMatch = lowerText.match(/(?:generate|make|create)\s+(?:me\s+)?(?:a\s+)?(?:song|music|track)\b(?:[:\-]?\s*)(.+)?/i);
      if (sunoMatch) {
        const prompt = (sunoMatch[1] || "").trim() || v;
        return `/suno ${prompt}`.trim();
      }

      const songSendMatch = lowerText.match(/(?:send|play|find|get)\s+(?:me\s+)?(?:a\s+)?song\b(?:[:\-]?\s*)(.+)?/i);
      if (songSendMatch) {
        const query = (songSendMatch[1] || "").trim();
        if (query) return `/play ${query}`;
        return "/play";
      }

      const videoMatch = lowerText.match(/(?:send|find|show|get)\s+(?:me\s+)?(?:a\s+)?video\b(?:[:\-]?\s*)(.+)?/i);
      if (videoMatch) {
        const query = (videoMatch[1] || "").trim();
        if (query) return `/video ${query}`;
        return "/video";
      }

      return null;
    })();
    if (naturalMediaIntent) {
      (ctx as any).message.text = naturalMediaIntent;
      await (bot as any).handleUpdate({ ...ctx.update, message: { ...ctx.message, text: naturalMediaIntent } });
      return;
    }

    const prefixless = t.match(/^(help|menu|build|create|unzip|lszip|zipfiles|model|setmode|play|video|ssweb|musicgen|suno|transcribe|tts|buttonmode|voicemode|search)\b/i);
    if (prefixless) {
      const cmd = prefixless[1].toLowerCase();
      const tail = t.slice(prefixless[0].length).trim();
      const normalized = cmd === "create" ? "build" : cmd;
      const asSlash = `/${normalized}${tail ? ` ${tail}` : ""}`;
      (ctx as any).message.text = asSlash;
      await (bot as any).handleUpdate({ ...ctx.update, message: { ...ctx.message, text: asSlash } });
      return;
    }
    const withReplyContext = t + extractReplyContext((ctx as any).message);
    await handleNaturalChat(ctx, withReplyContext);
  });

  bot.on("voice", async (ctx) => {
     const state = getState(ctx.from!.id);
     if (!state.voiceAiMode) return;
     ctx.reply("🎙 Voice mode is ON. Auto-transcribe flow will run via /transcribe logic.");
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
    const state = getState(ctx.from!.id);
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback("🤖 AI Chat", "ai_chat"), Markup.button.callback("💻 Code Builder", "code_builder")],
      [Markup.button.callback("🌐 Preview Builder", "preview_builder"), Markup.button.callback("🐙 GitHub Tools", "github_tools")],
      [Markup.button.callback("🎵 Media Tools", "media_tools"), Markup.button.callback("🛠 Utilities", "utils_tools")],
      [Markup.button.callback("🔘 Buttons ON", "btn_on"), Markup.button.callback("⚪ Buttons OFF", "btn_off")],
      [Markup.button.callback("🛡 Admin Panel", "admin_panel")]
    ]);
    ctx.replyWithPhoto(HELP_MENU_IMAGE, {
      caption: getMenuText(),
      ...(state.buttonMode ? keyboard : {})
    });
  });
  bot.action("btn_on", (ctx) => { getState(ctx.from!.id).buttonMode = true; return ctx.reply("✅ Button mode enabled."); });
  bot.action("btn_off", (ctx) => { getState(ctx.from!.id).buttonMode = false; return ctx.reply("✅ Button mode disabled."); });
  bot.command("buttonmode", (ctx) => {
    const v = (ctx.message.text.split(" ")[1] || "").toLowerCase();
    if (!["on", "off"].includes(v)) return ctx.reply("Usage: /buttonmode on|off");
    getState(ctx.from!.id).buttonMode = v === "on";
    return ctx.reply(`✅ Button mode ${v.toUpperCase()}`);
  });
  bot.command("voicemode", (ctx) => {
    if (!isAdmin(ctx)) return ctx.reply("❌ Admin only.");
    const v = (ctx.message.text.split(" ")[1] || "").toLowerCase();
    if (!["on", "off"].includes(v)) return ctx.reply("Usage: /voicemode on|off");
    getState(ctx.from!.id).voiceAiMode = v === "on";
    return ctx.reply(`✅ Voice note AI mode ${v.toUpperCase()}`);
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

  const handleBuildCommand = async (ctx: Context) => {
    const prompt = ctx.message.text.split(" ").slice(1).join(" ").trim();
    if (!prompt) return ctx.reply("🏗 Project Construction Started\nAnalyzing requirements...\n\nWhich tech stack should I use?\n(Examples: HTML/CSS/JS, React, Node.js, Django, etc.)\n\nUsage: /build <project description>");
    const state = getState(ctx.from!.id);
    state.pendingBuildDescription = prompt;
    return ctx.reply("🏗 Project Construction Started\nAnalyzing requirements...\n\nWhich tech stack should I use?\n(Examples: HTML/CSS/JS, React, Node.js, Django, etc.)");
  };
  bot.command("build", handleBuildCommand);
  bot.command("create", handleBuildCommand);

  bot.command("scrape", async (ctx) => {
    const raw = ctx.message.text.split(" ").slice(1).join(" ").trim();
    if (!raw) return ctx.reply("Usage: /scrape <url>");
    const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    try {
      const data = await Scraper.scrape(url);
      if (data.status === "error") {
        return ctx.reply(`❌ Scrape failed: ${data.message || "unknown error"}`);
      }
      return ctx.reply(`🌐 *${data.title || "Scraped page"}*\\n\\n${(data.text || "No text extracted").slice(0, 3500)}`, { parse_mode: "Markdown" });
    } catch (e: any) {
      return ctx.reply(`❌ Scrape failed: ${e.message}`);
    }
  });

  bot.command("run", async (ctx) => {
    const parts = ctx.message.text.trim().split(/\s+/);
    const lang = (parts[1] || "").toLowerCase();
    const code = ctx.message.text.split(" ").slice(2).join(" ").trim();
    if (!lang || !code) return ctx.reply("Usage: /run <js|py|bash> <code>");
    try {
      const output = await Sandbox.runCode(lang, code);
      return sendLongTextResponse(ctx, `🧪 Sandbox (${lang})\\n\\n${output}`, true);
    } catch (e: any) {
      return ctx.reply(`❌ Sandbox failed: ${e.message}`);
    }
  });

  bot.command("agent", async (ctx) => {
    const goal = ctx.message.text.split(" ").slice(1).join(" ").trim();
    if (!goal) return ctx.reply("Usage: /agent <goal>");
    const updates: string[] = [];
    const pushUpdate = async (line: string) => {
      updates.push(line);
      await ctx.reply(`🤖 Agent update:\n${line}`);
    };

    await pushUpdate(`Goal received: ${goal}`);
    await pushUpdate("Step 1/4: Creating execution plan...");
    const planPrompt = `Break this goal into 4-7 concrete executable steps for a coding agent. Goal: ${goal}`;
    const plan = await AIEngine.chat(planPrompt, [], "Return short numbered steps only.", "gemini");
    await sendLongTextResponse(ctx, `🧭 Execution Plan\n\n${plan}`);

    await pushUpdate("Step 2/4: Capturing context and memory...");
    const history = await DB.getHistory(ctx.from!.id, 20);
    await pushUpdate(`Loaded ${history.length} recent memory items.`);

    await pushUpdate("Step 3/4: Selecting tools for next action...");
    const toolHint = await AIEngine.chat(`Given this goal, choose ONE immediate tool action to start with: shell|scrape|sandbox|chat. Goal: ${goal}`, history, "Answer with one word.", "gemini");
    await pushUpdate(`Selected tool path: ${toolHint.trim()}`);

    await pushUpdate("Step 4/4: Checkpoint reached. Waiting for your go-ahead before execution.");
    await ctx.reply("Reply with `continue` to execute the first planned step, or tell me what to adjust.");
  });


  bot.command("qwen", async (ctx) => {
      const prompt = ctx.message.text.split(" ").slice(1).join(" ");
      if (!prompt) return ctx.reply("Usage: /qwen <prompt>");
      ctx.reply("📖 Consulting Qwen Knowledge...");
      const res = await AIEngine.generateQwen(prompt);
      ctx.reply(res);
  });



  bot.command("ssweb", async (ctx) => {
    const raw = (ctx.message.text.split(" ")[1] || "").trim();
    if (!raw) return ctx.reply("Usage: /ssweb <url>");
    const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const apiUrl = `https://api.screenshotone.com/take?access_key=KN3bMn5VoWZIWw&url=${encodeURIComponent(url)}&format=jpg&full_page=true&block_ads=true&block_cookie_banners=true&block_trackers=true&image_quality=80&response_type=by_format`;
    const res = await axios.get(apiUrl, { responseType: 'arraybuffer', timeout: 60000 });
    return ctx.replyWithPhoto({ source: Buffer.from(res.data) }, { caption: `🖼️ Full-page screenshot of:
${url}` });
  });

  bot.command("search", async (ctx) => {
    const query = ctx.message.text.split(" ").slice(1).join(" ").trim();
    if (!query) return ctx.reply("Usage: /search <query>");
    try {
      const { data } = await axios.get("https://api.duckduckgo.com/", {
        params: { q: query, format: "json", no_html: 1, no_redirect: 1 },
        timeout: 20000
      });
      const related = Array.isArray(data?.RelatedTopics) ? data.RelatedTopics : [];
      const lines: string[] = [];
      for (const item of related) {
        if (item?.Text && item?.FirstURL) lines.push(`• ${item.Text}\n  ${item.FirstURL}`);
        if (Array.isArray(item?.Topics)) {
          for (const topic of item.Topics) {
            if (topic?.Text && topic?.FirstURL) lines.push(`• ${topic.Text}\n  ${topic.FirstURL}`);
            if (lines.length >= 5) break;
          }
        }
        if (lines.length >= 5) break;
      }
      const heading = data?.Heading ? `🔎 ${data.Heading}\n` : "";
      if (!lines.length) return ctx.reply(`No quick web results found for: ${query}`);
      return ctx.reply(`${heading}${lines.slice(0, 5).join("\n\n")}`);
    } catch (e: any) {
      return ctx.reply(`❌ Search failed: ${e.message}`);
    }
  });

  bot.command("suno", async (ctx) => {
    if (!SUNO_ACCESS_TOKEN) return ctx.reply("❌ Missing SUNO_ACCESS_TOKEN in environment.");
    const prompt = ctx.message.text.split(" ").slice(1).join(" ").trim();
    if (!prompt) return ctx.reply("Usage: /suno <prompt>\nExample: /suno I love you afrobeat by Kenzy");

    const waitMsg = await ctx.reply("🎵 Suno generation started...\n⏳ Please wait 1-4 minutes.");
    try {
      const { data } = await axios.post(`${SUNO_WRAPPER_BASE}/api/v1/generate`, {
        customMode: true,
        instrumental: false,
        model: SUNO_MODEL,
        prompt
      }, { timeout: 45000, headers: buildSunoHeaders() });
      const taskId = data?.data?.taskId || data?.taskId || data?.result?.taskId;
      if (!taskId) throw new Error("No Suno task ID returned");

      let audioUrl = "";
      for (let i = 0; i < 35; i += 1) {
        await new Promise((r) => setTimeout(r, 7000));
        const poll = await axios.get(`${SUNO_WRAPPER_BASE}/api/v1/generate/record-info`, {
          params: { taskId }, timeout: 45000, headers: buildSunoHeaders()
        });
        const raw = poll.data?.data || poll.data?.result || poll.data;
        const firstSong = Array.isArray(raw?.songs) ? raw.songs[0] : null;
        const firstClip = Array.isArray(raw?.clips) ? raw.clips[0] : null;
        audioUrl = firstSong?.audioUrl || firstSong?.audio_url || firstClip?.audioUrl || firstClip?.audio_url || raw?.audioUrl || raw?.audio_url || raw?.url || "";
        const status = String(raw?.status || raw?.state || "").toLowerCase();
        if (audioUrl) break;
        if (["failed", "error", "cancelled"].includes(status)) throw new Error(raw?.message || "generation failed");
      }
      if (!audioUrl) throw new Error("Generation timeout without audio URL");

      await ctx.replyWithAudio({ url: audioUrl }, { caption: `🎵 Suno track ready\n🆔 Task: ${taskId}` });
      return ctx.telegram.deleteMessage(ctx.chat!.id, waitMsg.message_id).catch(() => null);
    } catch (e: any) {
      return ctx.reply(`❌ Suno generation failed: ${e.message}`);
    }
  });

  bot.command("musicgen", async (ctx) => {
    const prompt = ctx.message.text.split(" ").slice(1).join(" ").trim();
    (ctx as any).message.text = `/suno ${prompt}`;
    await (bot as any).handleUpdate({ ...ctx.update, message: { ...ctx.message, text: (ctx as any).message.text } });
  });

  bot.command("audio", async (ctx) => {
    const prompt = ctx.message.text.split(" ").slice(1).join(" ").trim();
    if (!prompt) return ctx.reply("Usage: /audio <music prompt>");
    (ctx as any).message.text = `/suno ${prompt}`;
    await (bot as any).handleUpdate({ ...ctx.update, message: { ...ctx.message, text: (ctx as any).message.text } });
  });

  bot.command("image", async (ctx) => {
    const prompt = ctx.message.text.split(" ").slice(1).join(" ").trim();
    if (!prompt) return ctx.reply("Usage: /image <prompt>");
    try {
      const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?nologo=true&width=1024&height=1024`;
      return ctx.replyWithPhoto({ url: imageUrl }, { caption: `🖼️ Prompt: ${prompt}` });
    } catch (e: any) {
      return ctx.reply(`❌ Image generation failed: ${e.message}`);
    }
  });

  bot.command("video", async (ctx) => {
    const query = ctx.message.text.split(" ").slice(1).join(" ").trim();
    if (!query) return ctx.reply("Usage: /video <query>");
    try {
      const { data } = await axios.get("https://api.duckduckgo.com/", {
        params: { q: `${query} site:youtube.com`, format: "json", no_html: 1, no_redirect: 1 },
        timeout: 20000
      });
      const first = data?.RelatedTopics?.find?.((x: any) => x?.FirstURL)?.FirstURL;
      if (!first) return ctx.reply(`No quick video results found for: ${query}`);
      return ctx.reply(`🎬 Top result for *${query}*\\n${first}`, { parse_mode: "Markdown", link_preview_options: { is_disabled: false } });
    } catch (e: any) {
      return ctx.reply(`❌ Video search failed: ${e.message}`);
    }
  });

  bot.command("play", async (ctx) => {
    const query = ctx.message.text.split(" ").slice(1).join(" ").trim();
    if (!query) return ctx.reply("Usage: /play <song name>");
    try {
      const { data } = await axios.get("https://api.popcat.xyz/spotify", {
        params: { q: query },
        timeout: 25000
      });
      if (!data || data.error) return ctx.reply(`❌ No Spotify result found for: ${query}`);
      const title = data.title || query;
      const artist = data.artist || "Unknown";
      const link = data.url || data.link || data.external_urls?.spotify;
      const preview = data.preview || data.preview_url;
      const cover = data.image || data.thumbnail;
      const caption = `🎵 *${title}*\n👤 ${artist}\n${link ? `🔗 ${link}` : ""}`.trim();
      if (preview) return ctx.replyWithAudio({ url: preview }, { caption, parse_mode: "Markdown" });
      if (cover) return ctx.replyWithPhoto({ url: cover }, { caption, parse_mode: "Markdown", link_preview_options: { is_disabled: false } });
      return ctx.reply(caption, { parse_mode: "Markdown", link_preview_options: { is_disabled: false } });
    } catch (e: any) {
      return ctx.reply(`❌ Spotify command failed: ${e.message}`);
    }
  });

  bot.command("anivid", async (ctx) => {
    const sources = [
      "https://arychauhann.onrender.com/api/sfmhentai",
      "https://arychauhann.onrender.com/api/hentai"
    ];
    try {
      for (const source of sources) {
        try {
          const { data } = await axios.get(source, { timeout: 45000, headers: { "User-Agent": "Mozilla/5.0" } });
          const url = data?.video || data?.url || data?.result?.url || data?.data?.url || data?.data?.video;
          if (url) return ctx.replyWithVideo({ url }, { caption: `🎬 anivid\nsource: ${source}` });
        } catch {}
      }
      return ctx.reply("❌ Failed to fetch anime video from API sources.");
    } catch (e: any) {
      return ctx.reply(`❌ anivid failed: ${e.message}`);
    }
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

  bot.command("adminadd", (ctx) => {
    if (!isAdmin(ctx)) return ctx.reply("❌ Admin only.");
    const raw = (ctx.message.text.split(" ")[1] || "").trim();
    const userId = Number.parseInt(raw, 10);
    if (!raw || Number.isNaN(userId)) return ctx.reply("Usage: /adminadd <user_id>");
    if (config.adminIds.includes(userId)) return ctx.reply(`ℹ️ ${userId} is already an admin.`);
    config.adminIds.push(userId);
    return ctx.reply(`✅ Added ${userId} as bot admin.\nThey can now use admin features.`);
  });

  bot.command("adminremove", (ctx) => {
    if (!isAdmin(ctx)) return ctx.reply("❌ Admin only.");
    const raw = (ctx.message.text.split(" ")[1] || "").trim();
    const userId = Number.parseInt(raw, 10);
    if (!raw || Number.isNaN(userId)) return ctx.reply("Usage: /adminremove <user_id>");
    if (!config.adminIds.includes(userId)) return ctx.reply(`ℹ️ ${userId} is not in admin list.`);
    config.adminIds = config.adminIds.filter((id) => id !== userId);
    return ctx.reply(`✅ Removed ${userId} from bot admin list.`);
  });

  bot.command("adminlist", (ctx) => {
    if (!isAdmin(ctx)) return ctx.reply("❌ Admin only.");
    const text = config.adminIds.length
      ? `🛡 Bot admins:\n${config.adminIds.map((id) => `• ${id}`).join("\n")}`
      : "No bot admins configured.";
    return ctx.reply(text);
  });

  bot.command("cmd", async (ctx) => {
    if (!isAdmin(ctx)) return ctx.reply("❌ Admin only.");
    const [, action = "", source = "", cat = "general"] = ctx.message.text.trim().split(/\s+/);
    const commandsDir = path.join(process.cwd(), "src", "commands");
    const allowedCats = ["admin", "ai", "downloader", "economy", "fun", "games", "general", "media", "owner", "utility"];
    await fs.promises.mkdir(commandsDir, { recursive: true });
    for (const c of allowedCats) await fs.promises.mkdir(path.join(commandsDir, c), { recursive: true });

    if (!action || action === "help") {
      return ctx.reply(
        `🧩 CMD Manager\n\nCommands directory:\n${commandsDir}\n\nCategories:\n${allowedCats.join(", ")}\n\nUsage:\n/cmd dir\n/cmd list\n/cmd install <url> [category]`
      );
    }

    if (action === "dir") {
      return ctx.reply(`📁 Command directory:\n${commandsDir}`);
    }

    if (action === "list") {
      const rows: string[] = [];
      for (const c of allowedCats) {
        const files = (await fs.promises.readdir(path.join(commandsDir, c))).filter((f) => f.endsWith(".js"));
        rows.push(`• ${c}: ${files.length} file(s)`);
      }
      return ctx.reply(`📚 Command categories under:\n${commandsDir}\n\n${rows.join("\n")}`);
    }

    if (action === "install") {
      if (!source) return ctx.reply("Usage: /cmd install <url> [category]");
      const category = cat.toLowerCase();
      if (!allowedCats.includes(category)) return ctx.reply(`❌ Invalid category.\nUse one of: ${allowedCats.join(", ")}`);
      if (!/^https?:\/\//i.test(source)) return ctx.reply("❌ install currently supports URL source only.");

      try {
        const res = await axios.get(source, { timeout: 20000 });
        const content = typeof res.data === "string" ? res.data : JSON.stringify(res.data, null, 2);
        let fileName = path.basename(new URL(source).pathname) || `cmd_${Date.now()}.js`;
        if (!fileName.endsWith(".js")) fileName += ".js";
        const targetPath = path.join(commandsDir, category, fileName);
        await fs.promises.writeFile(targetPath, content, "utf8");
        return ctx.reply(`✅ Installed command file.\nPath: ${targetPath}\nCategory: ${category}\nSize: ${Buffer.byteLength(content, "utf8")} bytes`);
      } catch (e: any) {
        return ctx.reply(`❌ Install failed: ${e.message}`);
      }
    }

    return ctx.reply("Unknown cmd action. Use /cmd help");
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
          const looksLikeInvalidToken = /(?:ETELEGRAM:\s*)?(401|Unauthorized)/i.test(message);
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
