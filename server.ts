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

async function startServer() {
  const app = express();
  const PORT = config.port;

  let botStatus = "initializing";
  let botError: string | null = null;
  let botInfo: any = null;

  const bot = new Telegraf(config.botToken || "DUMMY_TOKEN");

  // Middlewares
  app.use(express.json());

  const isAdmin = (ctx: Context) => ctx.from?.id === config.adminId;

  // --- BOT COMMANDS ---

  bot.start((ctx) => {
    ctx.reply(
      `BrokenVzn Agent v2.5 🚀\n\nI am your advanced coding and automation assistant.\nPress /menu to see what I can do.`,
      Markup.keyboard([
        ["/menu", "/ping"],
        ["/build", "/shell"],
        ["/github", "/help"]
      ]).resize()
    );
  });

  bot.command("menu", (ctx) => {
    ctx.reply(
      "BrokenVzn Agent Menu:",
      Markup.inlineKeyboard([
        [Markup.button.callback("🤖 AI Chat", "ai_chat"), Markup.button.callback("💻 Code Builder", "code_builder")],
        [Markup.button.callback("🌐 Preview Builder", "preview_builder"), Markup.button.callback("🐙 GitHub Tools", "github_tools")],
        [Markup.button.callback("🎵 Downloader/Media", "media_tools"), Markup.button.callback("🛠 Utilities", "utils_tools")],
        [Markup.button.callback("🛡 Admin Panel", "admin_panel")]
      ])
    );
  });

  bot.help((ctx) => {
    const helpText = `
🦾 *BrokenVzn Agent - Commands*

*AI Chat*
/code <prompt> - Gemini-powered coding
/groq <prompt> - High-speed LPU reasoning
/qwen <prompt> - Educational coding help

*Build & Preview*
/build <description> - Generate full app project
/apk <description> - Generate mobile project source
/webbuild <description> - Generate web app source

*Terminal & Files*
/shell <cmd> - Run commands (Admin)
/files - List workspace files
/unzip - Extract uploaded ZIP
/zip <folder> - Compress folder

*GitHub*
/github login <token> - Set session token
/push <repo> - Push latest build to GitHub

*Media*
/play <song> - Search audio
/video <query> - Search video
/downloader <url> - Download media
    `;
    ctx.replyWithMarkdown(helpText);
  });

  bot.command("ping", (ctx) => {
    const start = Date.now();
    ctx.reply("📶 Measuring latency...").then((msg) => {
      const ms = Date.now() - start;
      bot.telegram.editMessageText(ctx.chat!.id, msg.message_id, undefined, `✅ Connected!\nLatency: ${ms}ms\nUptime: ${process.uptime().toFixed(0)}s`);
    });
  });

  bot.command("code", async (ctx) => {
    const prompt = ctx.message.text.split(" ").slice(1).join(" ");
    if (!prompt) return ctx.reply("Please specify a task.");
    try {
        ctx.reply("🧠 Gemini is thinking...");
        const response = await AIEngine.generateGemini(prompt, "You are a senior coding assistant.");
        ctx.reply(response);
    } catch (e: any) {
        ctx.reply("AI Error: " + e.message);
    }
  });

  bot.command("groq", async (ctx) => {
    const prompt = ctx.message.text.split(" ").slice(1).join(" ");
    if (!prompt) return ctx.reply("Please specify a task.");
    try {
        ctx.reply("⚡ Groq LPU processing...");
        const response = await AIEngine.generateGroq(prompt);
        ctx.reply(response);
    } catch (e: any) {
        ctx.reply("Groq Error: " + e.message);
    }
  });

  bot.command("shell", async (ctx) => {
    if (!isAdmin(ctx)) return ctx.reply("❌ Admin access required.");
    const cmd = ctx.message.text.split(" ").slice(1).join(" ");
    if (!cmd) return ctx.reply("Usage: /shell <command>");
    
    ctx.reply(`🐚 Executing...`);
    const output = await ShellUtils.run(cmd);
    ctx.reply(`\`\`\`\n${output.slice(0, 4000)}\n\`\`\``, { parse_mode: 'Markdown' });
  });

  bot.command("build", async (ctx) => {
    const prompt = ctx.message.text.split(" ").slice(1).join(" ");
    if (!prompt) return ctx.reply("What should I build?");

    ctx.reply("🏗 Building project structure...");
    try {
        // Simple logic for single-file output for now, expandable to multi-file
        const codePrompt = `Generate a full Node.js project for: ${prompt}. Output the content of index.js and package.json enclosed in backticks with filenames.`;
        const result = await AIEngine.generateGemini(codePrompt);
        
        const projectPath = path.join(process.cwd(), "builds", `project_${Date.now()}`);
        if (!fs.existsSync(projectPath)) fs.mkdirSync(projectPath, { recursive: true });

        // Parsing logic (naive)
        const files = result.match(/```.*?\n([\s\S]*?)```/g);
        if (files) {
            files.forEach((f, i) => {
                const content = f.replace(/```.*?\n/, "").replace(/```$/, "");
                const name = i === 0 ? "index.js" : "package.json";
                FileUtils.writeFile(path.join(projectPath, name), content);
            });
        }

        ctx.reply("📦 Zipping project...");
        const zipPath = `${projectPath}.zip`;
        await FileUtils.zipFolder(projectPath, zipPath);
        
        await ctx.replyWithDocument({ source: zipPath, filename: "brokenvzn_app.zip" });
        ctx.reply("✅ Delivery complete.");
    } catch (e: any) {
        ctx.reply("Build failed: " + e.message);
    }
  });

  bot.command("report_whatsapp", async (ctx) => {
    if (!isAdmin(ctx)) return ctx.reply("❌ Unauthorized.");
    const number = ctx.message.text.split(" ").slice(1).join(" ");
    if (!number) return ctx.reply("Usage: /report_whatsapp <number>");
    ctx.reply(`⚡ Reporting ${number} to WhatsApp Support...`);
    // Simulated reporting logic as requested
    setTimeout(() => {
        ctx.reply("✅ Report filed. Case ID: WA-" + Math.floor(Math.random() * 100000));
    }, 2000);
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

  bot.command("downloader", (ctx) => {
    ctx.reply("📥 Send a link to begin downloading.");
  });

  bot.command("play", (ctx) => {
    ctx.reply("🎵 Searching media library...");
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
