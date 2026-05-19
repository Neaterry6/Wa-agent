import dotenv from "dotenv";
import logger from "../utils/logger.ts";
dotenv.config();

const botToken = process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN;
if (!botToken) {
  logger.error("CRITICAL: TELEGRAM_BOT_TOKEN (or BOT_TOKEN) is missing in environment variables.");
  throw new Error("Missing TELEGRAM_BOT_TOKEN");
}

const botId = process.env.TELEGRAM_BOT_ID || process.env.BOT_ID || "";
const adminIdsRaw = process.env.TELEGRAM_ADMIN_IDS || process.env.ADMIN_IDS || "";

export const config = {
  botToken: botToken,
  botId,
  adminIds: adminIdsRaw.split(",").map(id => parseInt(id.trim())).filter(id => !isNaN(id)),
  geminiKey: process.env.GEMINI_API_KEY || "",
  geminiModel: process.env.GEMINI_MODEL || "gemini-2.0-flash",
  groqKey: process.env.GROQ_API_KEY || "",
  groqModel: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
  groqBaseUrl: process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1",
  qwenKey: process.env.QWEN_API_KEY || "",
  qwenModel: process.env.QWEN_MODEL || "qwen-plus",
  qwenBaseUrl: process.env.QWEN_BASE_URL || "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
  brokenHost: process.env.BROKEN_HOST || "gemini.talkai.info",
  brokenPath: process.env.BROKEN_PATH || "/pt/chat/send/",
  brokenModel: process.env.BROKEN_MODEL || "gemini-2.0-flash-lite",
  brokenTemperature: Number(process.env.BROKEN_TEMPERATURE || "0.7"),
  malvryxKey: process.env.MALVRYX_API_KEY || "",
  githubToken: process.env.GITHUB_TOKEN || "",
  renderKey: process.env.RENDER_API_KEY || "",
  firebaseProjectId: process.env.FIREBASE_PROJECT_ID || "",
  firebaseAppId: process.env.FIREBASE_APP_ID || "",
  firebaseApiKey: process.env.FIREBASE_API_KEY || "",
  firebaseAuthDomain: process.env.FIREBASE_AUTH_DOMAIN || "",
  firebaseDatabaseId: process.env.FIRESTORE_DATABASE_ID || "(default)",
  firebaseStorageBucket: process.env.FIREBASE_STORAGE_BUCKET || "",
  firebaseMessagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || "",
  firebaseMeasurementId: process.env.FIREBASE_MEASUREMENT_ID || "",
  requiredChannelId: process.env.REQUIRED_CHANNEL_ID || "",
  channelLink: process.env.CHANNEL_LINK || "https://t.me/BrokenVzn",
  port: 3000,
  nodeEnv: process.env.NODE_ENV || "development",
};
