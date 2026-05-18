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

  static async chat(prompt: string, history: { role: string; content: string }[] = [], systemInstruction: string = "", model: string = "gemini") {
    if (model === "gemini") {
        const chat = this.ai.chats.create({
          model: config.geminiModel, 
          config: { systemInstruction }
        });
        const result = await chat.sendMessage({ message: prompt });
        return result.text;
    } else if (model === "groq") {
        return this.generateGroq(prompt, config.groqModel);
    } else if (model === "qwen") {
        return this.generateQwen(prompt);
    }
    return this.generateGemini(prompt, systemInstruction);
  }

  static async generateProject(description: string) {
    const system = `You are an elite full-stack developer. Generate a complete project based on the description.
Use the format:
=== filename.ext ===
code content
=== nextfile.ext ===
code content

Provide package.json, main entry files, and readme. Be extremely thorough.`;
    
    return this.generateGemini(description, system);
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
    const response = await this.generateGemini(text, system);
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
    if (!config.qwenKey) return "QWEN_API_KEY is not configured.";
    try {
        const response = await axios.post("https://api.qwen.aikit.club/v1/chat/completions", {
            model: "qwen-plus",
            messages: [{ role: "user", content: prompt }]
        }, {
            headers: { "Authorization": `Bearer ${config.qwenKey}` }
        });
        return response.data.choices[0].message.content;
    } catch (e) {
        return "Qwen API Error: " + (e instanceof Error ? e.message : String(e));
    }
  }
}
