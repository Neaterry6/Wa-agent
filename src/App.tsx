import { useEffect, useMemo, useState } from "react";
import { Bot, Terminal, Github, Shield, Cpu } from "lucide-react";
import { motion } from "motion/react";

const DEFAULT_SANDBOX_URL = "https://codesandbox.io/";

export default function App() {
  const [status, setStatus] = useState<any>(null);
  const [sandboxUrl, setSandboxUrl] = useState(DEFAULT_SANDBOX_URL);
  const [activeWorkspace, setActiveWorkspace] = useState<"dashboard" | "sandbox" | "terminal">("dashboard");

  const terminalHint = useMemo(
    () =>
      [
        "$ /terminal",
        "[ADMIN] Interactive shell opened in Telegram.",
        "$ /shell npm run dev",
        "[RUN] Local preview booting...",
      ].join("\n"),
    [],
  );

  useEffect(() => {
    fetch("/api/health")
      .then((res) => res.json())
      .then((data) => setStatus(data))
      .catch((err) => console.error("Failed to fetch status:", err));
  }, []);

  const normalizedUrl = (value: string) => {
    if (!value.trim()) return DEFAULT_SANDBOX_URL;
    if (value.startsWith("http://") || value.startsWith("https://")) return value;
    return `https://${value}`;
  };

  return (
    <div className="h-screen w-full flex flex-col bg-[#0A0A0F] text-[#E0E0E0] font-sans overflow-hidden">
      <nav className="h-16 border-b border-white/10 flex items-center justify-between px-8 bg-[#0D0D14]">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-indigo-600 flex items-center justify-center font-mono text-white font-bold">B</div>
          <h1 className="text-xl font-bold tracking-tight text-white uppercase">BROKENVZN <span className="text-indigo-400">AGENT</span></h1>
          <div className="flex items-center gap-2 px-3 py-1 bg-zinc-900 border border-zinc-800 rounded-full">
            <div className={`w-2 h-2 rounded-full ${status?.botActive ? 'bg-emerald-500 shadow-[0_0_8px_#10b981]' : status?.botStatus === 'failed' ? 'bg-red-500 shadow-[0_0_8px_#ef4444]' : 'bg-zinc-600'}`} />
            <span className="text-[10px] font-mono uppercase tracking-widest text-slate-300">
              {status?.botStatus === 'live' ? 'Connected' : status?.botStatus === 'failed' ? 'Auth Error' : 'Offline'}
            </span>
          </div>
        </div>
        <div className="hidden md:flex gap-6 items-center font-mono text-xs text-slate-400 uppercase">
          <div className="flex gap-2"><span className="text-indigo-400">STATUS:</span> {status?.botStatus?.toUpperCase() || 'UNKNOWN'}</div>
          <div className="px-3 py-1 bg-white/5 rounded border border-white/10 italic text-[10px]">v2.6.0-workspace</div>
        </div>
      </nav>

      <div className="flex-1 grid grid-cols-12 gap-0 overflow-hidden">
        <aside className="col-span-3 border-r border-white/5 bg-[#08080C] p-6 hidden lg:block overflow-y-auto">
          <h2 className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em] mb-4">Workspaces</h2>
          <div className="space-y-3 mb-8">
            <button onClick={() => setActiveWorkspace("dashboard")} className={`w-full text-left p-3 rounded border ${activeWorkspace === "dashboard" ? "border-indigo-500/40 bg-indigo-500/10" : "border-white/10 bg-white/5"}`}>
              <div className="flex justify-between items-center mb-1"><span className="text-sm font-semibold">Control Dashboard</span><Cpu className="w-4 h-4 text-indigo-400" /></div>
              <p className="text-[11px] text-slate-400">Health, model, and pipeline state</p>
            </button>
            <button onClick={() => setActiveWorkspace("sandbox")} className={`w-full text-left p-3 rounded border ${activeWorkspace === "sandbox" ? "border-emerald-500/40 bg-emerald-500/10" : "border-white/10 bg-white/5"}`}>
              <div className="flex justify-between items-center mb-1"><span className="text-sm font-semibold">CodeSandbox</span><Github className="w-4 h-4 text-emerald-400" /></div>
              <p className="text-[11px] text-slate-400">Embed any sandbox project or workspace URL</p>
            </button>
            <button onClick={() => setActiveWorkspace("terminal")} className={`w-full text-left p-3 rounded border ${activeWorkspace === "terminal" ? "border-amber-500/40 bg-amber-500/10" : "border-white/10 bg-white/5"}`}>
              <div className="flex justify-between items-center mb-1"><span className="text-sm font-semibold">Inbuilt Terminal</span><Terminal className="w-4 h-4 text-amber-400" /></div>
              <p className="text-[11px] text-slate-400">Admin command bridge + quick shell macros</p>
            </button>
          </div>
        </aside>

        <main className="col-span-12 lg:col-span-9 p-8 flex flex-col overflow-y-auto">
          {activeWorkspace === "dashboard" && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                <motion.div whileHover={{ y: -4 }} className="p-5 rounded-xl bg-gradient-to-br from-indigo-900/20 to-transparent border border-indigo-500/20"><div className="text-indigo-400 mb-3"><Cpu className="w-6 h-6" /></div><h3 className="text-lg font-bold mb-1">Coding Core</h3></motion.div>
                <motion.div whileHover={{ y: -4 }} className="p-5 rounded-xl bg-gradient-to-br from-emerald-900/20 to-transparent border border-emerald-500/20"><div className="text-emerald-400 mb-3"><Github className="w-6 h-6" /></div><h3 className="text-lg font-bold mb-1">Git Automation</h3></motion.div>
                <motion.div whileHover={{ y: -4 }} className="p-5 rounded-xl bg-gradient-to-br from-amber-900/20 to-transparent border border-amber-500/20"><div className="text-amber-400 mb-3"><Shield className="w-6 h-6" /></div><h3 className="text-lg font-bold mb-1">Admin Safety</h3></motion.div>
              </div>
              <div className="rounded-xl border border-white/10 bg-[#0D0D14] p-6">
                <p className="text-sm text-slate-300">Use the left panel to open the new <span className="text-emerald-400">CodeSandbox</span> workspace or jump into the <span className="text-amber-400">inbuilt terminal</span> panel.</p>
              </div>
            </>
          )}

          {activeWorkspace === "sandbox" && (
            <div className="rounded-xl border border-emerald-500/20 bg-[#0D0D14] p-4 h-full flex flex-col gap-4">
              <div className="flex flex-col md:flex-row gap-3 md:items-center">
                <input value={sandboxUrl} onChange={(e) => setSandboxUrl(e.target.value)} className="flex-1 bg-black/30 border border-white/10 rounded px-3 py-2 text-sm" placeholder="Paste CodeSandbox URL" />
                <button onClick={() => setSandboxUrl(normalizedUrl(sandboxUrl))} className="px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold">Load Sandbox</button>
              </div>
              <iframe title="CodeSandbox Embed" src={normalizedUrl(sandboxUrl)} className="w-full flex-1 min-h-[500px] rounded border border-white/10 bg-black" />
            </div>
          )}

          {activeWorkspace === "terminal" && (
            <div className="rounded-xl border border-amber-500/20 bg-[#0D0D14] p-4 h-full flex flex-col gap-4">
              <div className="flex items-center gap-2 text-amber-300 font-mono text-xs uppercase"><Bot className="w-4 h-4" /> Inbuilt Terminal Bridge</div>
              <textarea readOnly value={terminalHint} className="w-full flex-1 min-h-[360px] rounded bg-black/70 border border-white/10 p-4 font-mono text-sm text-emerald-300" />
              <p className="text-xs text-slate-400">Live command execution remains controlled by the admin-only Telegram commands (<code>/terminal</code>, <code>/shell</code>).</p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
