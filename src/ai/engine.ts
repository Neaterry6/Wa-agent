import { GoogleGenAI } from "@google/genai";
import Groq from "groq-sdk";
import axios from "axios";
import { config } from "../config/index.ts";

export class AIEngine {
  private static gemini = new GoogleGenAI(config.geminiKey);
  private static groq = new Groq({ apiKey: config.groqKey });

  static async generateGemini(prompt: string, systemInstruction?: string) {
    if (!config.geminiKey) throw new Error("GEMINI_API_KEY missing");
    const model = this.gemini.getGenerativeModel({ 
        model: "gemini-2.0-flash",
        systemInstruction
    });
    const result = await model.generateContent(prompt);
    return result.response.text();
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
    // Placeholder for Qwen API which often uses OpenAI-compatible format
    // or direct endpoint if they have a custom one
    return "Qwen engine response placeholder. Connect your Qwen endpoint here.";
  }
}
