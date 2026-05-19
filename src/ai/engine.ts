import { GoogleGenAI } from "@google/genai";
import Groq from "groq-sdk";
import axios from "axios";
import https from "https";
import { randomUUID } from "crypto";
import { config } from "../config/index.ts";

export class AIEngine {
  private static normalizeGroqBaseUrl(rawBaseUrl: string) {
    return rawBaseUrl.replace(/\/openai\/v1\/?$/i, "");
  }

  private static ai = new GoogleGenAI({
    apiKey: config.geminiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      }
    }
  });
  private static groq = new Groq({
    apiKey: config.groqKey,
    baseURL: this.normalizeGroqBaseUrl(config.groqBaseUrl),
  });

  private static buildMessages(prompt: string, history: { role: string; content: string }[] = [], systemInstruction: string = "") {
    const messages: { role: "system" | "user" | "assistant"; content: string }[] = [];
    if (systemInstruction) messages.push({ role: "system", content: systemInstruction });
    for (const h of history) {
      const role = h.role === "model" ? "assistant" : (h.role as "system" | "user" | "assistant");
      if (role === "system" || role === "user" || role === "assistant") messages.push({ role, content: h.content });
    }
    messages.push({ role: "user", content: prompt });
    return messages;
  }

  private static async withFallback(prompt: string, history: { role: string; content: string }[] = [], systemInstruction: string = "", preferred: string = "gemini") {
    const fallbackOrder = preferred === "broken"
      ? ["broken", "gemini", "groq", "qwen"]
      : [preferred, "gemini", "groq", "qwen"];
    const order = fallbackOrder.filter((v, i, a) => a.indexOf(v) === i);
    const errors: string[] = [];

    for (const provider of order) {
      try {
        if (provider === "gemini") return await this.generateGemini(prompt, systemInstruction);
        if (provider === "groq") return await this.generateGroq(this.buildMessages(prompt, history, systemInstruction), config.groqModel);
        if (provider === "qwen") return await this.generateQwen(this.buildMessages(prompt, history, systemInstruction));
        if (provider === "broken") return await this.generateBroken(prompt, history, systemInstruction);
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
    return this.withFallback(prompt, history, systemInstruction, model);
  }

  static async generateProject(description: string) {
    const system = `You are an elite full-stack developer. Generate a complete, production-style project based on the description.
Use the format:
=== filename.ext ===
code content
=== nextfile.ext ===
code content

Requirements:
- Return MANY files when needed (not a tiny demo). Create deep folder structures for real apps.
- Include package.json, lockfile-friendly scripts, main entry files, README, .env.example, and config files.
- Add reusable modules/components and clear separation of concerns.
- If the project is web/apk related and needs images, include an assets pipeline:
  - A downloader utility that can fetch image URLs from Google Images or Pinterest result pages.
  - A documented command/script for downloading and storing images under assets/.
  - Fallback placeholders when external downloads fail.
- Keep file headers exactly in the required === path === format so parsing works.

Be extremely thorough.`;

    return this.withFallback(description, [], system, "gemini");
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
    const response = await this.withFallback(text, [], system, "gemini");
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

  static async analyzeImage(base64Data: string, mimeType: string, prompt: string = "Analyze this image in detail.") {
    if (!config.geminiKey) {
      return this.withFallback(`User shared an image but vision model is unavailable. Respond helpfully and ask for description. User prompt: ${prompt}`);
    }

    const response = await this.ai.models.generateContent({
      model: config.geminiModel,
      contents: [
        {
          role: "user",
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType,
                data: base64Data,
              },
            },
          ],
        },
      ],
    });

    return response.text || "I analyzed the image but couldn't produce a detailed response.";
  }

  static async generateGroq(messages: { role: "system" | "user" | "assistant"; content: string }[], model: string = config.groqModel) {
    if (!config.groqKey) throw new Error("GROQ_API_KEY missing");
    const chatCompletion = await this.groq.chat.completions.create({
      messages,
      model: model,
    });
    return chatCompletion.choices[0]?.message?.content || "";
  }

  static async generateQwen(messages: { role: "system" | "user" | "assistant"; content: string }[]) {
    if (!config.qwenKey) throw new Error("QWEN_API_KEY is not configured.");
    const baseUrl = config.qwenBaseUrl.replace(/\/$/, "");
    const response = await axios.post(`${baseUrl}/chat/completions`, {
      model: config.qwenModel,
      messages
    }, {
      headers: { "Authorization": `Bearer ${config.qwenKey}` }
    });
    return response.data.choices[0].message.content;
  }

  static async generateBroken(prompt: string, history: { role: string; content: string }[] = [], systemInstruction: string = "") {
    const messages = [
      ...(systemInstruction ? [{ role: "system", content: systemInstruction }] : []),
      ...history,
      { role: "user", content: prompt }
    ];

    const payload = JSON.stringify({
      type: "chat",
      messagesHistory: messages.map((msg) => ({
        id: randomUUID(),
        from: msg.role === "assistant" || msg.role === "model" ? "bot" : "you",
        content: msg.content,
      })),
      settings: {
        model: config.brokenModel,
        temperature: config.brokenTemperature,
      },
    });

    const options = {
      hostname: config.brokenHost,
      path: config.brokenPath,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
        Accept: "text/event-stream",
        Referer: `https://${config.brokenHost}/pt/`,
        Origin: `https://${config.brokenHost}`,
        "User-Agent": "Mozilla/5.0",
      },
    };

    return new Promise<string>((resolve, reject) => {
      const req = https.request(options, (res) => {
        let text = "";
        let buffer = "";

        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          buffer += chunk;
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.startsWith("data:")) continue;
            text += line.replace(/^data:\s?/, "");
          }
        });

        res.on("end", () => resolve(text.trim()));
      });

      req.on("error", reject);
      req.write(payload);
      req.end();
    });
  }
}
