import Groq from "groq-sdk";
import axios from "axios";
import { config } from "../config/index.ts";
import logger from "../utils/logger.ts";

type Provider = "groq" | "external";

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
  private static lastProviderUsed: Provider | "none" = "none";

  private static groq = config.groqKey ? new Groq({ apiKey: config.groqKey }) : null;

  static providerName() {
    return "Groq + External";
  }

  static queueStatus() {
    return {
      pending: this.queue.length,
      processing: this.processing,
      maxQueueLength: this.maxQueueLength,
      lastProviderUsed: this.lastProviderUsed
    };
  }

  static async chat(prompt: string, _history: { role: string; content: string }[] = [], systemInstruction = "", model: string = "auto", userId: string = "") {
    const mode = (model || "auto").toLowerCase();
    if (mode === "groq") return this.enqueue(() => this.runWithRetry("groq", prompt, systemInstruction, userId));
    if (mode === "external" || mode === "toolbot" || mode === "claude") return this.enqueue(() => this.runWithRetry("external", prompt, systemInstruction, userId, mode));
    if (mode === "auto") return this.enqueue(() => this.runAutoWithFallback(prompt, systemInstruction, userId));
    return this.enqueue(() => this.runAutoWithFallback(prompt, systemInstruction, userId));
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

  private static async runWithRetry(provider: Provider, prompt: string, systemInstruction: string, userId = "", externalMode = "external") {
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const content = provider === "groq"
          ? await this.callGroq(prompt, systemInstruction)
          : await this.callExternal(prompt, systemInstruction, userId, externalMode);
        this.lastProviderUsed = provider;
        return content;
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

  private static async runAutoWithFallback(prompt: string, systemInstruction: string, userId = "") {
    try {
      if (config.externalAiUrl) return await this.callExternal(prompt, systemInstruction, userId, "external");
      return await this.runWithRetry("groq", prompt, systemInstruction, userId);
    } catch (firstErr: any) {
      if (this.isTokenLimitError(firstErr)) {
        logger.warn("Primary model token/context limit reached. Auto-rotating to Groq.");
      }
      return await this.runWithRetry("groq", prompt, systemInstruction, userId);
    }
  }

  private static isTokenLimitError(error: any) {
    const msg = String(error?.message || error?.response?.data?.error?.message || "").toLowerCase();
    const status = error?.status || error?.response?.status;
    return status === 413
      || msg.includes("token limit")
      || msg.includes("context length")
      || msg.includes("maximum context")
      || msg.includes("too many tokens")
      || msg.includes("request too large");
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

  private static async callExternal(prompt: string, systemInstruction: string, userId = "", mode = "external") {
    const composed = systemInstruction ? `${systemInstruction}\n\nUser: ${prompt}` : prompt;

    if (mode === "toolbot" && config.externalToolbotUrl) {
      const { data } = await axios.get(config.externalToolbotUrl, { params: { prompt: composed }, timeout: 30000 });
      const content = data?.result?.result || data?.result || data?.message;
      if (!content) throw new Error("External toolbot returned empty response");
      return String(content).trim();
    }

    if (mode === "claude" && config.externalClaudeUrl) {
      const { data } = await axios.get(config.externalClaudeUrl, { params: { text: composed }, timeout: 30000 });
      const content = data?.result?.result || data?.result || data?.message || data?.text;
      if (!content) throw new Error("External Claude endpoint returned empty response");
      return String(content).trim();
    }

    if (!config.externalAiUrl) throw new Error("EXTERNAL_AI_URL missing");
    const { data } = await axios.get(config.externalAiUrl, {
      params: { prompt: composed, uid: userId || "global", reset: "" },
      timeout: 30000
    });
    const content = data?.result?.choices?.[0]?.message?.content || data?.message || data?.result?.result;
    if (!content) throw new Error("External AI returned empty response");
    return String(content).trim();
  }

  static async generateProject(description: string) {
    const system = "You are an elite full-stack developer. Generate a complete, production-style project based on the description.";
    return this.chat(description, [], system, "auto");
  }

  static async detectIntent(text: string) {
    const system = "You are an intent classifier. Respond ONLY JSON with intent.";
    try {
      return JSON.parse(await this.chat(text, [], system, "auto"));
    } catch {
      return { intent: "CHAT", query: text };
    }
  }

  static async analyzeImage(_base64Data: string, _mimeType: string, prompt = "Analyze this image in detail.") {
    return this.chat(prompt, [], "You are a vision assistant without direct pixels. Ask for image details when needed.", "auto");
  }
}
