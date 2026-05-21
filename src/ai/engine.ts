import axios from "axios";
import { config } from "../config/index.ts";
import logger from "../utils/logger.ts";

export class AIEngine {
  static providerName() {
    return "Notte AI";
  }

  static async chat(prompt: string, _history: { role: string; content: string }[] = [], systemInstruction: string = "", _model: string = "notte") {
    return this.generateNotte(prompt, systemInstruction);
  }

  static async generateNotte(prompt: string, systemInstruction: string = "") {
    if (!config.notteKey) throw new Error("NOTTE_API_KEY missing");
    const model = /coder|code|program/i.test(systemInstruction) ? config.notteCodeModel : config.notteGeneralModel;
    const maxAttempts = 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await axios.post(
          `${config.notteBaseUrl.replace(/\/$/, "")}/chat/completions`,
          {
            model,
            messages: [
              { role: "system", content: systemInstruction || "You are the main AI agent handling search, code, and responses." },
              { role: "user", content: prompt },
            ],
          },
          {
            headers: {
              Authorization: `Bearer ${config.notteKey}`,
              "Content-Type": "application/json",
            },
          }
        );
        const content = response.data?.choices?.[0]?.message?.content;
        if (!content) throw new Error("Notte returned empty response");
        return content;
      } catch (error: any) {
        const status = error?.response?.status;
        if (status === 429 && attempt < maxAttempts) {
          const delayMs = 1500 * attempt;
          logger.error(`Notte rate limited (429). Retrying in ${delayMs}ms (attempt ${attempt}/${maxAttempts}).`);
          await new Promise((r) => setTimeout(r, delayMs));
          continue;
        }
        throw error;
      }
    }

    throw new Error("Notte request failed after retries");
  }

  static async generateProject(description: string) {
    const system = `You are an elite full-stack developer. Generate a complete, production-style project based on the description.`;
    return this.generateNotte(description, system);
  }

  static async detectIntent(text: string) {
    const system = `You are an intent classifier. Respond ONLY JSON with intent.`;
    try {
      return JSON.parse(await this.generateNotte(text, system));
    } catch {
      return { intent: "CHAT", query: text };
    }
  }

  static async analyzeImage(_base64Data: string, _mimeType: string, prompt: string = "Analyze this image in detail.") {
    return this.generateNotte(prompt, "You are a vision assistant without direct pixels. Ask for image details when needed.");
  }
}
