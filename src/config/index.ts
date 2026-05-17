import dotenv from "dotenv";
dotenv.config();

export const config = {
  botToken: process.env.TELEGRAM_BOT_TOKEN || "",
  botId: process.env.TELEGRAM_BOT_ID || "",
  adminId: parseInt(process.env.ADMIN_ID || "0"),
  geminiKey: process.env.GEMINI_API_KEY || "",
  groqKey: process.env.GROQ_API_KEY || "",
  qwenKey: process.env.QWEN_API_KEY || "",
  githubToken: process.env.GITHUB_TOKEN || "",
  port: 3000,
  nodeEnv: process.env.NODE_ENV || "development",
};
