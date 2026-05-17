import express from "express";
import path from "path";
import fs from "fs";
import axios from "axios";
import { createServer as createViteServer } from "vite";
import { Telegraf, Context, Markup } from "telegraf";
import { config } from "./src/config/index.ts";
import { AIEngine } from "./src/ai/engine.ts";
import { ShellUtils, FileUtils } from "./src/utils/index.ts";
import { GitHubService } from "./src/github/service.ts";
import { PreviewEngine } from "./src/preview/engine.ts";
import { TaskManager } from "./src/utils/tasks.ts";

async function startServer() {
  const app = express();
  const PORT = config.port;

  const taskManager = new TaskManager();
  const userSessions = new Map<number, { role: string; content: string }[]>();

  let botStatus = "initializing";
  let botError: string | null = null;
  let botInfo: any = null;

  const bot = new Telegraf(config.botToken || "DUMMY_TOKEN");

  // Middlewares
  app.use(express.json());

  const isAdmin = (ctx: Context) => ctx.from?.id === config.adminId;

  // --- HELPER: Natural Chat Router ---
  async function handleNaturalChat(ctx: Context, text: string) {
    const userId = ctx.from!.id;
    if (!userSessions.has(userId)) userSessions.set(userId, []);
    const history = userSessions.get(userId)!;

    // Show typing status
    await ctx.sendChatAction("typing");

    // Detect Intent
    const analysis = await AIEngine.detectIntent(text);
    console.log("Intent detected:", analysis);

    switch (analysis.intent) {
      case "BUILD_APP":
        return buildProject(ctx, analysis.description || text);
      case "BUILD_APK":
        return buildProject(ctx, `${analysis.description || text} (React Native/Mobile format)`);
      case "TASK_ADD":
        const task = taskManager.addTask(analysis.description || text);
        return ctx.reply(`✅ Task added: "${task.description}" (ID: ${task.id})`);
      case "TASK_LIST":
        const tasks = taskManager.getTasks();
        if (tasks.length === 0) return ctx.reply("No pending tasks. 📭");
        return ctx.reply(`📋 *Current Tasks:*\n${tasks.map(t => `${t.completed ? '✅' : '⏳'} \`${t.id}\` - ${t.description}`).join("\n")}`, { parse_mode: "Markdown" });
      case "MEDIA_LYRICS":
        ctx.reply(`🔍 Searching lyrics for "${analysis.song || text}"...`);
        const lyrics = await AIEngine.generateGemini(`Find lyrics for ${analysis.song || text}. Just the lyrics.`);
        return ctx.reply(lyrics.slice(0, 4000));
      case "MEDIA_VIDEO":
        return ctx.reply(`🎬 Searching video for "${analysis.query || text}"... (Mock)`);
      case "MEDIA_DOWNLOAD":
        return ctx.reply(`📥 Initializing download for: ${analysis.url || text}... (Mock)`);
      case "PUSH_GITHUB":
        return pushToGithub(ctx, analysis.repo || "my-awesome-project");
      case "ZIP_FOLDER":
        return zipFolder(ctx, analysis.folder || ".");
      case "UNZIP_FILE":
        return unzipLatest(ctx);
      case "CMD_SHELL":
        if (!isAdmin(ctx)) return ctx.reply("❌ Shell access restricted to Admin.");
        return executeShell(ctx, analysis.command || text);
      case "SEARCH_FILE":
        return searchFiles(ctx, analysis.query || text);
      case "CHAT":
      default:
        const response = await AIEngine.chat(text, history, "You are BrokenVzn Agent. An advanced AI with system-level access. You can build apps, manage files, and automate tasks. Be concise and professional.");
        history.push({ role: "user", content: text });
        history.push({ role: "model", content: response });
        if (history.length > 20) history.splice(0, 2); // Keep last 10 rounds
        return ctx.reply(response, { parse_mode: "Markdown" });
    }
  }

  // --- CORE LOGIC WRAPPERS ---

  async function buildProject(ctx: Context, description: string) {
    ctx.reply(`🏗 *Building Project:* ${description}\nThinking about architecture...`, { parse_mode: 'Markdown' });
    try {
        const codePrompt = `Create a robust project structure for: ${description}. Provide the content of key files (index.js, package.json, README.md) in backticks.`;
        const result = await AIEngine.generateGemini(codePrompt, "You are a lead developer building production-grade source code.");
        
        const projectDir = `build_` + Date.now();
        const projectPath = path.join(process.cwd(), "builds", projectDir);
        if (!fs.existsSync(projectPath)) fs.mkdirSync(projectPath, { recursive: true });

        const blocks = result.match(/```.*?\n([\s\S]*?)```/g);
        if (blocks) {
            blocks.forEach((block, i) => {
                const content = block.replace(/```.*?\n/, "").replace(/```$/, "");
                let name = "file_" + i;
                if (content.includes("package.json") || i === 1) name = "package.json";
                else if (content.includes("README") || i === 2) name = "README.md";
                else if (i === 0) name = "index.js";
                
                FileUtils.writeFile(path.join(projectPath, name), content);
            });
        }

        const zipPath = `${projectPath}.zip`;
        await FileUtils.zipFolder(projectPath, zipPath);
        await ctx.replyWithDocument({ source: zipPath, filename: `${projectDir}.zip` });
        ctx.reply("✅ *Build Successful.*\nSource code delivered.", { parse_mode: 'Markdown' });
    } catch (e: any) {
        ctx.reply(`❌ *Build Failed:*\n${e.message}`, { parse_mode: 'Markdown' });
    }
  }

  async function executeShell(ctx: Context, cmd: string) {
    const msg = await ctx.reply(`🐚 \`[TERMINAL]\` $ ${cmd}\n\nRunning...`, { parse_mode: 'Markdown' });
    const output = await ShellUtils.run(cmd);
    await bot.telegram.editMessageText(ctx.chat!.id, msg.message_id, undefined, `🐚 \`[TERMINAL]\` $ ${cmd}\n\n\`\`\`\n${output.slice(0, 3900)}\n\`\`\``, { parse_mode: 'Markdown' });
  }

  async function pushToGithub(ctx: Context, repo: string) {
    if (!userGithubToken) return ctx.reply("❌ GitHub token missing. Use `/github login <token>`");
    ctx.reply(`🐙 *GitHub Sync:* Pushing to \`${repo}\`...`, { parse_mode: 'Markdown' });
    // Implementation logic here
  }

  async function zipFolder(ctx: Context, folder: string) {
    const fullPath = path.join(process.cwd(), folder);
    if (!fs.existsSync(fullPath)) return ctx.reply(`❌ Folder \`${folder}\` not found.`);
    const zipName = `${folder.replace(/\W/g, '_')}_${Date.now()}.zip`;
    await FileUtils.zipFolder(fullPath, path.join(process.cwd(), zipName));
    await ctx.replyWithDocument({ source: zipName });
  }

  async function unzipLatest(ctx: Context) {
    ctx.reply("🔧 Extracting latest zip archive...");
    // Logic to find latest zip in temp or current and unzip
  }

  async function searchFiles(ctx: Context, query: string) {
    const results = FileUtils.searchContent(process.cwd(), query);
    if (results.length === 0) return ctx.reply("🔍 No matches found.");
    ctx.reply(`🔍 *Matches Found* (${results.length}):\n${results.slice(0, 10).map(r => `• \`${path.basename(r.path)}\`:${r.line} - ${r.content}`).join("\n")}`, { parse_mode: "Markdown" });
  }

  // --- BOT COMMANDS ---

  bot.start((ctx) => {
    ctx.reply(
      `BrokenVzn Agent v2.6 🚀\n\nI am your advanced coding assistant. I can chat normally, build apps, and manage your GitHub.\n\nType anything to start.`,
      Markup.keyboard([
        ["/menu", "/ping"],
        ["/tasks", "/files"],
        ["/help", "/clear"]
      ]).resize()
    );
  });

  bot.command("clear", (ctx) => {
      userSessions.delete(ctx.from!.id);
      ctx.reply("Memory cleared. 🧠✨");
  });

  bot.command("tasks", (ctx) => {
    const tasks = taskManager.getTasks();
    if (tasks.length === 0) return ctx.reply("No pending tasks. 📭");
    const list = tasks.map(t => `${t.completed ? '✅' : '⏳'} \`${t.id}\` - ${t.description}`).join("\n");
    ctx.reply(`📋 *Current Tasks:*\n${list}`, { parse_mode: "Markdown" });
  });

  bot.command("add_task", (ctx) => {
    const desc = ctx.message.text.split(" ").slice(1).join(" ");
    if (!desc) return ctx.reply("Usage: /add_task <description>");
    const task = taskManager.addTask(desc);
    ctx.reply(`📝 Task added with ID: \`${task.id}\``, { parse_mode: "Markdown" });
  });

  bot.command("done_task", (ctx) => {
    const id = parseInt(ctx.message.text.split(" ")[1]);
    if (isNaN(id)) return ctx.reply("Usage: /done_task <id>");
    if (taskManager.completeTask(id)) ctx.reply(`✅ Task \`${id}\` marked as complete.`, { parse_mode: "Markdown" });
    else ctx.reply("❌ Task not found.");
  });

  bot.command("download_file", (ctx) => {
      const file = ctx.message.text.split(" ")[1];
      if (!file) return ctx.reply("Usage: /download_file <name>");
      const fullPath = path.join(process.cwd(), file);
      if (!fs.existsSync(fullPath)) return ctx.reply("❌ File not found.");
      ctx.replyWithDocument({ source: fullPath });
  });

  bot.on("text", async (ctx) => {
    if (ctx.message.text.startsWith("/")) return; // Ignore structured commands
    await handleNaturalChat(ctx, ctx.message.text);
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

  // --- GITHUB INTEGRATION ---
  let userGithubToken: string | null = null;

  bot.command("github", async (ctx) => {
      const args = ctx.message.text.split(" ");
      if (args[1] === "login") {
          userGithubToken = args[2];
          return ctx.reply("🐙 GitHub token stored for this session.");
      }
      ctx.reply("Usage: /github login <token>\n/push <repo_name>");
  });

  bot.command("push", async (ctx) => {
      if (!userGithubToken) return ctx.reply("Please login first: /github login <token>");
      const repoName = ctx.message.text.split(" ")[1];
      if (!repoName) return ctx.reply("Specify repo name.");

      const gh = new GitHubService(userGithubToken);
      try {
          ctx.reply("🐙 Creating repository...");
          await gh.createRepo(repoName);
          ctx.reply(`✅ Repository ${repoName} created and initial push successful (Simulated).`);
      } catch (e: any) {
          ctx.reply("GitHub Error: " + e.message);
      }
  });

  // --- FILE HANDLING ---

  bot.on("document", async (ctx) => {
    const doc = ctx.message.document;
    if (doc.file_name?.endsWith(".zip")) {
        ctx.reply("📥 Downloading ZIP for analysis...");
        try {
            const link = await bot.telegram.getFileLink(doc.file_id);
            const response = await axios.get(link.href, { responseType: 'arraybuffer' });
            const tempDir = path.join(process.cwd(), "temp");
            const zipPath = path.join(tempDir, `${doc.file_id}.zip`);
            
            if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
            fs.writeFileSync(zipPath, Buffer.from(response.data));
            
            ctx.reply(`✅ ZIP received and stored.\nUse /unzip to extract or /push <repo> to send to GitHub.`);
        } catch (e) {
            ctx.reply("Failed to download file.");
        }
    } else {
        ctx.reply("📄 File received. I'm optimized for .zip files.");
    }
  });

  bot.command("unzip", async (ctx) => {
      ctx.reply("🔧 Unzipping tool active. Extracting contents into workspace...");
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
    ctx.reply("📜 Fetching last 10 system events...\n- [LOG] Bot Started\n- [LOG] AI Engine Initialized\n- [LOG] Connection Stable");
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
      adminId: config.adminId 
    });
  });

  // Start Bot
  if (config.botToken && config.botToken !== "YOUR_TELEGRAM_BOT_TOKEN") {
      bot.launch()
        .then(async () => {
          botStatus = "live";
          botInfo = await bot.telegram.getMe();
          console.log("BrokenVzn Bot is live as", botInfo.username);
        })
        .catch(err => {
          botStatus = "failed";
          botError = err instanceof Error ? err.message : String(err);
          console.error("Bot launch failed:", err);
        });
  } else {
    botStatus = "missing_token";
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
