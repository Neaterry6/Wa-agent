import { GoogleGenAI } from "@google/genai";
import Groq from "groq-sdk";
import { config } from "../config/index.ts";
import logger from "../utils/logger.ts";

type Provider = "gemini" | "groq";

type QueueTask<T> = {
  fn: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

export class AIEngine {
  private static readonly queue: QueueTask<string>[] = [];
  private static processing = false;
  private static readonly maxQueueLength = 10;
  private static readonly paceDelayMs = 250;
  private static readonly maxRetries = 3;

  private static gemini = config.geminiKey ? new GoogleGenAI({ apiKey: config.geminiKey }) : null;
  private static groq = config.groqKey ? new Groq({ apiKey: config.groqKey }) : null;

  static providerName() {
    return "Gemini + Groq";
  }

  static async chat(prompt: string, _history: { role: string; content: string }[] = [], systemInstruction = "", model: string = "gemini") {
    const provider = (model || "gemini").toLowerCase() === "groq" ? "groq" : "gemini";
    return this.enqueue(() => this.runWithRetry(provider, prompt, systemInstruction));
  }

  private static enqueue(fn: () => Promise<string>) {
    if (this.queue.length > this.maxQueueLength) {
      throw new Error("System busy, please wait...");
    }
    return new Promise<string>((resolve, reject) => {
      this.queue.push({ fn, resolve, reject });
      void this.processQueue();
    });
  }

  private static async processQueue() {
    if (this.processing || this.queue.length === 0) return;
    this.processing = true;
    const task = this.queue.shift();
    if (!task) {
      this.processing = false;
      return;
    }
    try {
      const result = await task.fn();
      task.resolve(result);
    } catch (error) {
      task.reject(error);
    } finally {
      this.processing = false;
      setTimeout(() => void this.processQueue(), this.paceDelayMs);
    }
  }

  private static async runWithRetry(provider: Provider, prompt: string, systemInstruction: string) {
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        if (provider === "groq") return await this.callGroq(prompt, systemInstruction);
        return await this.callGemini(prompt, systemInstruction);
      } catch (error: any) {
        const status = error?.status || error?.response?.status;
        if (status === 429 && attempt < this.maxRetries) {
          const retryAfterHeader = error?.response?.headers?.["retry-after"] || error?.headers?.["retry-after"];
          const retryAfterMs = this.parseRetryAfterMs(retryAfterHeader);
          const fallbackMs = Math.pow(2, attempt - 1) * 1000;
          const waitMs = retryAfterMs ?? fallbackMs;
          logger.error(`${provider} rate limited (429). Retrying in ${waitMs}ms (attempt ${attempt}/${this.maxRetries}).`);
          await new Promise((r) => setTimeout(r, waitMs));
          continue;
        }
        logger.error(`${provider} request failed: ${error?.message || String(error)}`);
        throw error;
      }
    }
    throw new Error("Error: Service temporarily overloaded. Try again later.");
  }

  private static parseRetryAfterMs(retryAfter: string | number | undefined) {
    if (!retryAfter) return null;
    const seconds = Number(retryAfter);
    if (!Number.isNaN(seconds) && seconds > 0) return seconds * 1000;
    const dateMs = new Date(String(retryAfter)).getTime();
    if (Number.isNaN(dateMs)) return null;
    const delay = dateMs - Date.now();
    return delay > 0 ? delay : null;
  }

  private static async callGemini(prompt: string, systemInstruction: string) {
    if (!this.gemini) throw new Error("GEMINI_API_KEY missing");
    const response = await this.gemini.models.generateContent({
      model: config.geminiModel,
      config: { systemInstruction: systemInstruction || "You are the main AI agent handling search, code, and responses." },
      contents: prompt,
    });
    const content = response.text;
    if (!content) throw new Error("Gemini returned empty response");
    return content;
  }

  private static async callGroq(prompt: string, systemInstruction: string) {
    if (!this.groq) throw new Error("GROQ_API_KEY missing");
    const completion = await this.groq.chat.completions.create({
      model: config.groqModel,
      messages: [
        { role: "system", content: systemInstruction || "You are the main AI agent handling search, code, and responses." },
        { role: "user", content: prompt },
      ],
      temperature: 0.2,
    });
    const content = completion.choices?.[0]?.message?.content;
    if (!content) throw new Error("Groq returned empty response");
    return content;
  }

  static async generateProject(description: string) {
    const system = "You are an elite full-stack developer. Generate a complete, production-style project based on the description.";
    return this.chat(description, [], system, "gemini");
  }

  static async detectIntent(text: string) {
    const system = "You are an intent classifier. Respond ONLY JSON with intent.";
    try {
      return JSON.parse(await this.chat(text, [], system, "gemini"));
    } catch {
      return { intent: "CHAT", query: text };
    }
  }

  static async analyzeImage(_base64Data: string, _mimeType: string, prompt = "Analyze this image in detail.") {
    return this.chat(prompt, [], "You are a vision assistant without direct pixels. Ask for image details when needed.", "gemini");
  }
}
