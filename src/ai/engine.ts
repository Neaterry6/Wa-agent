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

  static async chat(prompt: string, history: { role: string; content: string }[] = [], systemInstruction: string = "") {
    if (!config.geminiKey) throw new Error("GEMINI_API_KEY missing");
    
    // Create a chat session manually or use chats.create but sendMessage is cleaner
    const chat = this.ai.chats.create({
      model: "gemini-2.0-flash", // Use a valid model from skill
      config: {
        systemInstruction
      }
    });

    // Handle history manually if needed or just use current session
    // For this implementation, we'll just send the message
    const result = await chat.sendMessage({ message: prompt });
    return result.text;
  }

  static async detectIntent(text: string) {
    const system = `You are an intent classifier for BrokenVzn Agent.
Available intents: BUILD_APP, BUILD_APK, PUSH_GITHUB, ZIP_FOLDER, UNZIP_FILE, CMD_SHELL, SEARCH_FILE, TASK_ADD, TASK_LIST, MEDIA_LYRICS, MEDIA_VIDEO, MEDIA_DOWNLOAD, CHAT.
Respond ONLY with the intent name and optional parameters in JSON format.
Example: {"intent": "BUILD_APP", "description": "weather app"}
Example: {"intent": "MEDIA_LYRICS", "song": "Bohemian Rhapsody"}
Example: {"intent": "MEDIA_DOWNLOAD", "url": "https://example.com/video.mp4"}
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
        model: "gemini-2.0-flash",
        contents: prompt,
        config: {
            systemInstruction
        }
    });
    return response.text;
  }

  static async generateGroq(prompt: string, model: string = "llama-3.3-70b-versatile") {
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
