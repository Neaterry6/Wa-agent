import dotenv from "dotenv";
import logger from "../utils/logger.ts";
dotenv.config();

const botToken = process.env.TELEGRAM_BOT_TOKEN;
if (!botToken) {
  logger.error("CRITICAL: TELEGRAM_BOT_TOKEN is missing in environment variables.");
  throw new Error("Missing TELEGRAM_BOT_TOKEN");
}

export const config = {
  botToken: botToken,
  botId: process.env.TELEGRAM_BOT_ID || "",
  adminIds: (process.env.TELEGRAM_ADMIN_IDS || "").split(",").map(id => parseInt(id.trim())).filter(id => !isNaN(id)),
  geminiKey: process.env.GEMINI_API_KEY || "",
  geminiModel: process.env.GEMINI_MODEL || "gemini-2.0-flash",
  groqKey: process.env.GROQ_API_KEY || "",
  groqModel: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
  groqBaseUrl: process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1",
  qwenKey: process.env.QWEN_API_KEY || "",
  malvryxKey: process.env.MALVRYX_API_KEY || "",
  githubToken: process.env.GITHUB_TOKEN || "",
  renderKey: process.env.RENDER_API_KEY || "",
  requiredChannelId: process.env.REQUIRED_CHANNEL_ID || "",
  channelLink: process.env.CHANNEL_LINK || "https://t.me/BrokenVzn",
  port: 3000,
  nodeEnv: process.env.NODE_ENV || "development",
};
