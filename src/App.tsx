import { useEffect, useMemo, useRef, useState } from "react";
import { ImagePlus, Paperclip, Send, Bot, User } from "lucide-react";

type Msg = { role: "user" | "assistant"; content: string; meta?: string };

export default function App() {
  const [status, setStatus] = useState<any>(null);
  const [messages, setMessages] = useState<Msg[]>([{ role: "assistant", content: "Hi! Upload an image/zip or ask me anything." }]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploadInfo, setUploadInfo] = useState<string>("");
  const [imagePayload, setImagePayload] = useState<{ base64: string; mimeType: string } | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/health").then((r) => r.json()).then(setStatus).catch(() => null);
  }, []);

  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  const canSend = useMemo(() => !!input.trim() || !!imagePayload, [input, imagePayload]);

  const readFile = async (file: File) => {
    const buffer = await file.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
    return base64;
  };

  const onFile = async (file?: File) => {
    if (!file) return;
    const lower = file.name.toLowerCase();
    if (file.type.startsWith("image/")) {
      const base64 = await readFile(file);
      setImagePayload({ base64, mimeType: file.type || "image/png" });
      setUploadInfo(`Image ready: ${file.name}`);
      return;
    }

    if (lower.endsWith(".zip")) {
      setUploadInfo(`ZIP attached: ${file.name} (analysis context only)`);
      return;
    }

    setUploadInfo(`File attached: ${file.name}`);
  };

  const send = async () => {
    if (!canSend || busy) return;
    const userText = input.trim() || (imagePayload ? "Please analyze this image." : "Analyze file.");
    setMessages((p) => [...p, { role: "user", content: userText, meta: uploadInfo || undefined }]);
    setInput("");
    setBusy(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: userText,
          history: messages,
          imageBase64: imagePayload?.base64,
          imageMimeType: imagePayload?.mimeType,
        }),
      });
      const data = await res.json();
      setMessages((p) => [...p, { role: "assistant", content: data.reply || data.error || "No response." }]);
    } catch (e: any) {
      setMessages((p) => [...p, { role: "assistant", content: `Error: ${e.message}` }]);
    } finally {
      setBusy(false);
      setUploadInfo("");
      setImagePayload(null);
    }
  };

  return (
    <div className="h-screen bg-[#0b0f19] text-white flex flex-col">
      <header className="h-14 border-b border-white/10 px-5 flex items-center justify-between">
        <div className="font-semibold">Chat Assistant</div>
        <div className="text-xs text-slate-300">{status?.botStatus || "offline"}</div>
      </header>

      <main ref={scrollerRef} className="flex-1 overflow-y-auto px-4 py-5 space-y-4">
        {messages.map((m, i) => (
          <div key={i} className={`max-w-3xl ${m.role === "user" ? "ml-auto" : "mr-auto"}`}>
            <div className={`rounded-2xl px-4 py-3 border ${m.role === "user" ? "bg-indigo-600/30 border-indigo-400/30" : "bg-[#111827] border-white/10"}`}>
              <div className="text-xs opacity-70 mb-1 flex items-center gap-2">{m.role === "user" ? <User size={14} /> : <Bot size={14} />} {m.role}</div>
              <div className="whitespace-pre-wrap text-sm">{m.content}</div>
              {m.meta && <div className="text-xs mt-2 text-emerald-300">{m.meta}</div>}
            </div>
          </div>
        ))}
        {busy && <div className="text-sm text-slate-400">Thinking...</div>}
      </main>

      <footer className="border-t border-white/10 p-4 space-y-2">
        {uploadInfo && <div className="text-xs text-emerald-300">{uploadInfo}</div>}
        <div className="flex gap-2 items-end">
          <label className="p-2 rounded-lg border border-white/15 hover:bg-white/5 cursor-pointer"><ImagePlus size={18} /><input type="file" accept="image/*,.zip" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} /></label>
          <label className="p-2 rounded-lg border border-white/15 hover:bg-white/5 cursor-pointer"><Paperclip size={18} /><input type="file" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} /></label>
          <textarea value={input} onChange={(e) => setInput(e.target.value)} placeholder="Message..." className="flex-1 min-h-[48px] max-h-36 rounded-xl bg-[#111827] border border-white/10 px-3 py-2 text-sm" />
          <button onClick={send} disabled={!canSend || busy} className="px-4 py-3 rounded-xl bg-indigo-600 disabled:opacity-50"><Send size={18} /></button>
        </div>
      </footer>
    </div>
  );
}
