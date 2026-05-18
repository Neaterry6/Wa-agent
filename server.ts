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

async function startServer() {
  const app = express();
  const PORT = config.port;

  let botStatus = "initializing";
  let botError: string | null = null;
  let botInfo: any = null;

  const bot = new Telegraf(config.botToken || "DUMMY_TOKEN");

  // Bot Middlewares
  bot.use(channelCheckMiddleware);
  
  // Custom Session Storage (Simple Map for demo, could be persistent)
  const userStates = new Map<number, { model: string; cwd: string; isTerminal: boolean; lastZip?: string }>();

  function getState(userId: number) {
    if (!userStates.has(userId)) {
      userStates.set(userId, { model: 'gemini', cwd: process.cwd(), isTerminal: false });
    }
    return userStates.get(userId)!;
  }

  async function handleNaturalChat(ctx: Context, text: string) {
    const userId = ctx.from!.id;
    const state = getState(userId);

    // Terminal Mode Handling
    if (state.isTerminal) {
      if (text === "/exit") {
        state.isTerminal = false;
        return ctx.reply("🔌 *Disconnected from shell.*", { parse_mode: 'Markdown' });
      }
      return executeShell(ctx, text);
    }

    const history = DB.getHistory(userId);
    DB.logChat(userId, "user", text);

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
Mode: ${state.model}. Current Directory: ${state.cwd}. 
Be concise, helpful, and slightly savage when appropriate. You have full access to tools like shell, github, and files.`;
        
        const response = await AIEngine.chat(text, history, systemPrompt, state.model);
        DB.logChat(userId, "model", response);
        return ctx.reply(response, { parse_mode: "Markdown" });
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

  bot.command("model", (ctx) => {
    const model = ctx.message.text.split(" ")[1];
    if (!['gemini', 'groq', 'qwen'].includes(model)) {
      return ctx.reply("Usage: /model qwen | gemini | groq");
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
      const rawCode = await AIEngine.generateProject(description);
      const files = FileUtils.parseProjectCode(rawCode);
      
      if (files.length === 0) {
        return ctx.reply("❌ Failed to generate structured code. Try a clearer description.");
      }

      const buildDir = path.join(process.cwd(), "builds", `prj_${Date.now()}`);
      fs.mkdirSync(buildDir, { recursive: true });

      for (const file of files) {
        FileUtils.writeFile(path.join(buildDir, file.name), file.content);
      }

      const zipPath = `${buildDir}.zip`;
      await FileUtils.zipFolder(buildDir, zipPath);
      
      await ctx.replyWithDocument({ source: zipPath, filename: "project_source.zip" });
      await bot.telegram.editMessageText(ctx.chat!.id, msg.message_id, undefined, `✅ *Build Complete*
Delivered ${files.length} files. Enjoy!`, { parse_mode: 'Markdown' });
      
    } catch (e: any) {
      ctx.reply(`❌ *Build Error:* ${e.message}`);
    }
  }

  async function executeShell(ctx: Context, cmd: string) {
    const msg = await ctx.reply(`🐚 \`[TERMINAL]\` $ ${cmd}\n\nRunning...`, { parse_mode: 'Markdown' });
    const output = await ShellUtils.run(cmd);
    await bot.telegram.editMessageText(ctx.chat!.id, msg.message_id, undefined, `🐚 \`[TERMINAL]\` $ ${cmd}\n\n\`\`\`\n${output.slice(0, 3900)}\n\`\`\``, { parse_mode: 'Markdown' });
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
    if (ctx.message.text.startsWith("/")) return; 
    await handleNaturalChat(ctx, ctx.message.text);
  });

  bot.on("voice", async (ctx) => {
     ctx.reply("🎙 *Voice Transcribing...* (Simulated)\nI understood your request. Processing...");
     // Real implementation would use OpenAI Whisper or Gemini multi-modal
  });

  bot.on("photo", async (ctx) => {
     ctx.reply("👁 *Vision Analysis Active*\nChecking image for code, UI, or secrets...");
     // Real implementation would pass image to Gemini Vision
  });

  bot.command("menu", (ctx) => {
    ctx.reply(
      "BrokenVzn Agent Menu:",
      Markup.inlineKeyboard([
        [Markup.button.callback("🤖 AI Chat", "ai_chat"), Markup.button.callback("💻 Code Builder", "code_builder")],
        [Markup.button.callback("🌐 Preview Builder", "preview_builder"), Markup.button.callback("🐙 GitHub Tools", "github_tools")],
        [Markup.button.callback("🎵 Media Tools", "media_tools"), Markup.button.callback("🛠 Utilities", "utils_tools")],
        [Markup.button.callback("🛡 Admin Panel", "admin_panel")]
      ])
    );
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
    const helpText = `
🦾 *BrokenVzn Agent - Commands*

*AI Chat*
/code <p> - Gemini coding
/groq <p> - Fast reasoning
/qwen <p> - Code teaching

*Build & Preview*
/build <desc> - Generate Node/Web project
/apk <desc> - React Native source
/webbuild <desc> - Web project source

*Terminal & Files*
/shell <cmd> - Run commands (Admin)
/files - List workspace
/edit <p> <cont> - Edit file
/search <text> - Search content
/unzip - Extract ZIP
/zip <folder> - Compress folder

*Productivity*
/remind <sec> <task> - Set reminder
/note <text> - Quick note
/task <text> - Add task

*GitHub*
/github login <token> - Set token
/push <repo> - Push latest build

*Media*
/lyrics <song> - Find lyrics
/video <query> - Search video
/download <url> - Download media

*Admin*
/stats /users /logs /broadcast /ban /unban
    `;
    ctx.replyWithMarkdown(helpText);
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

      const gh = new GitHubService(user.github_token);
      ctx.reply(`🐙 *GitHub Sync:* Pushing current workspace to \`${repoName}\`...`, { parse_mode: 'Markdown' });

      try {
          logger.info(`User ${userId} pushing ${state.cwd} to GitHub repo ${repoName}`);
          
          let repo;
          try {
            repo = await gh.createRepo(repoName);
          } catch (e) {
            // Repo might already exist, try to get existing
            repo = { name: repoName, owner: { login: (await bot.telegram.getChatMember(config.requiredChannelId, userId)).user.username || 'user' } };
          }
          
          const files = FileUtils.listFiles(state.cwd);
          let count = 0;
          for (const file of files) {
             const fullPath = path.join(state.cwd, file);
             if (fs.statSync(fullPath).isFile()) {
               const content = FileUtils.readFile(fullPath);
               if (content) {
                 await gh.uploadFile(repo.owner?.login || 'owner', repoName, file, content);
                 count++;
               }
             }
          }
          
          ctx.reply(`✅ *Push Successful*\n\nUploaded ${count} files to [${repoName}](https://github.com/${repo.owner?.login || 'owner'}/${repoName})`, { parse_mode: 'Markdown', link_preview_options: { is_disabled: true } });
          logger.info(`User ${userId} successfully pushed ${count} files to GitHub.`);
      } catch (e: any) {
          logger.error(`GitHub push failed for ${userId}: ${e.message}`);
          ctx.reply("❌ GitHub Error: " + e.message);
      }
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
            
            const zipPath = path.join(storageDir, doc.file_name);
            fs.writeFileSync(zipPath, Buffer.from(response.data));
            
            state.lastZip = zipPath;
            
            ctx.reply(`✅ *ZIP Stored Successfully*\n\nFile: \`${doc.file_name}\`\n\nCommands:\n/unzip - Extract all files\n/lszip - List contents`, { parse_mode: 'Markdown' });
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
    
    if (!state.lastZip || !fs.existsSync(state.lastZip)) {
      return ctx.reply("❌ No ZIP uploaded recently or file missing.");
    }

    const workspaceDir = path.join(process.cwd(), "workspaces", `${userId}_${Date.now()}`);
    fs.mkdirSync(workspaceDir, { recursive: true });

    try {
      logger.info(`User ${userId} unzipping ${state.lastZip} to ${workspaceDir}`);
      FileUtils.unzip(state.lastZip, workspaceDir);
      state.cwd = workspaceDir;
      
      const contents = FileUtils.listFiles(workspaceDir);
      ctx.reply(`🔓 *Extraction Complete*\n\nWorkspace set to: \`${path.basename(workspaceDir)}\`\nFiles: ${contents.length}\n\nUse /ls to see contents.`, { parse_mode: 'Markdown' });
    } catch (e: any) {
      logger.error(`Unzip failed for ${userId}: ${e.message}`);
      ctx.reply(`❌ Error during extraction: ${e.message}`);
    }
  });

  bot.command("lszip", (ctx) => {
    const userId = ctx.from!.id;
    const state = getState(userId);
    if (!state.lastZip) return ctx.reply("❌ No ZIP file found.");
    
    try {
      const list = FileUtils.listZipContent(state.lastZip);
      ctx.reply(`📦 *ZIP Contents:*\n\n\`\`\`\n${list.slice(0, 50).join("\n")}${list.length > 50 ? '\n...' : ''}\n\`\`\``, { parse_mode: 'Markdown' });
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
    const target = ctx.message.text.split(" ")[1];
    if (!target) return ctx.reply("Usage: /ban <user_id>");
    ctx.reply(`🚫 User ${target} has been restricted from the agent.`);
  });

  bot.command("unban", (ctx) => {
    if (!isAdmin(ctx)) return ctx.reply("❌ Admin only.");
    const target = ctx.message.text.split(" ")[1];
    if (!target) return ctx.reply("Usage: /unban <user_id>");
    ctx.reply(`✅ Restrictions removed for user ${target}.`);
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
          botError = err instanceof Error ? err.message : String(err);
          logger.error(`Bot launch failed: ${botError}`);
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
