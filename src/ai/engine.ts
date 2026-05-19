import { GoogleGenAI } from "@google/genai";
import Groq from "groq-sdk";
import axios from "axios";
import { config } from "../config/index.ts";

export class AIEngine {
  private static ai = new GoogleGenAI({
    apiKey: config.geminiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      }
    }
  });
  private static groq = new Groq({ apiKey: config.groqKey });

  private static async withFallback(prompt: string, systemInstruction: string = "", preferred: string = "gemini") {
    const order = [preferred, "groq", "qwen", "gemini"].filter((v, i, a) => a.indexOf(v) === i);
    const errors: string[] = [];

    for (const provider of order) {
      try {
        if (provider === "gemini") return await this.generateGemini(prompt, systemInstruction);
        if (provider === "groq") return await this.generateGroq(this.mergePrompt(prompt, systemInstruction), config.groqModel);
        if (provider === "qwen") return await this.generateQwen(this.mergePrompt(prompt, systemInstruction));
      } catch (e) {
        errors.push(`${provider}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    throw new Error(`All model providers failed. ${errors.join(" | ")}`);
  }

  private static mergePrompt(prompt: string, systemInstruction: string) {
    return systemInstruction ? `System Instructions:
${systemInstruction}

User Prompt:
${prompt}` : prompt;
  }

  static async chat(prompt: string, history: { role: string; content: string }[] = [], systemInstruction: string = "", model: string = "gemini") {
    return this.withFallback(prompt, systemInstruction, model);
  }

  static async generateProject(description: string) {
    const system = `You are an elite full-stack developer. Generate a complete project based on the description.
Use the format:
=== filename.ext ===
code content
=== nextfile.ext ===
code content

Provide package.json, main entry files, and readme. Be extremely thorough.`;

    return this.withFallback(description, system, "gemini");
  }

  static async detectIntent(text: string) {
    const system = `You are an intent classifier for BrokenVzn Agent.
Available intents: BUILD_APP, PUSH_GITHUB, ZIP_FOLDER, CMD_SHELL, SEARCH_FILE, MEDIA_DOWNLOAD, CHAT.
Respond ONLY with the intent name and optional parameters in JSON format.
Examples:
{"intent": "BUILD_APP", "description": "weather website"}
{"intent": "CMD_SHELL", "command": "ls -la"}
{"intent": "MEDIA_DOWNLOAD", "url": "https://google.com"}
`;
    const response = await this.withFallback(text, system, "gemini");
    try {
      return JSON.parse(response);
    } catch {
      return { intent: "CHAT", query: text };
    }
  }

  static async generateGemini(prompt: string, systemInstruction?: string) {
    if (!config.geminiKey) throw new Error("GEMINI_API_KEY missing");
    const response = await this.ai.models.generateContent({
      model: config.geminiModel,
      contents: prompt,
      config: {
        systemInstruction
      }
    });
    return response.text;
  }

  static async generateGroq(prompt: string, model: string = config.groqModel) {
    if (!config.groqKey) throw new Error("GROQ_API_KEY missing");
    const chatCompletion = await this.groq.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      model: model,
    });
    return chatCompletion.choices[0]?.message?.content || "";
  }

  static async generateQwen(prompt: string) {
    if (!config.qwenKey) throw new Error("QWEN_API_KEY is not configured.");
    const response = await axios.post("https://api.qwen.aikit.club/v1/chat/completions", {
      model: "qwen-plus",
      messages: [{ role: "user", content: prompt }]
    }, {
      headers: { "Authorization": `Bearer ${config.qwenKey}` }
    });
    return response.data.choices[0].message.content;
  }
}
