import { useEffect, useState } from "react";
import { Bot, Terminal, Github, Shield, Cpu, MessageSquare } from "lucide-react";
import { motion } from "motion/react";

export default function App() {
  const [status, setStatus] = useState<any>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((res) => res.json())
      .then((data) => setStatus(data))
      .catch((err) => console.error("Failed to fetch status:", err));
  }, []);

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
          {status?.botError && (
            <div className="text-red-400/80 italic text-[10px] max-w-[200px] truncate" title={status.botError}>
              [ERR: {status.botError}]
            </div>
          )}
          {status?.botInfo ? (
            <div className="flex gap-4">
              <div className="flex gap-2"><span className="text-indigo-400">BOT:</span> @{status.botInfo.username}</div>
              <div className="flex gap-2"><span className="text-indigo-400">ID:</span> {status.botInfo.id}</div>
            </div>
          ) : status?.botIdEnv ? (
            <div className="flex gap-2"><span className="text-indigo-400">CONFIGURED_ID:</span> {status.botIdEnv}</div>
          ) : null}
          <div className="flex gap-2"><span className="text-indigo-400">STATUS:</span> {status?.botStatus?.toUpperCase() || 'UNKNOWN'}</div>
          <div className="flex gap-2"><span className="text-indigo-400">ADMIN_ID:</span> {status?.adminId || 'NOT_SET'}</div>
          <div className="px-3 py-1 bg-white/5 rounded border border-white/10 italic text-[10px]">v2.5.1-stable</div>
        </div>
      </nav>

      <div className="flex-1 grid grid-cols-12 gap-0 overflow-hidden">
        <aside className="col-span-3 border-r border-white/5 bg-[#08080C] p-6 hidden lg:block overflow-y-auto">
          {status?.botStatus === 'failed' && (
            <div className="mb-6 p-4 rounded bg-red-500/10 border border-red-500/20">
              <p className="text-[10px] font-bold text-red-500 uppercase mb-2 flex items-center gap-2">
                <Shield className="w-3 h-3" /> Connection Failure
              </p>
              <p className="text-[11px] text-red-400/80 leading-relaxed mb-3">
                Telegram returned a <b>404 Not Found</b>. Verify <code>TELEGRAM_BOT_TOKEN</code>.
              </p>
            </div>
          )}
          
          <h2 className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em] mb-4">Neural Engines</h2>
          <div className="space-y-3 mb-8">
            <div className="p-3 rounded border border-white/10 bg-white/5">
              <div className="flex justify-between items-center mb-1">
                <span className="text-sm font-semibold">Gemini 2.0 Flash</span>
                <div className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_#22c55e]"></div>
              </div>
              <p className="text-[11px] text-slate-400">Primary reasoning active</p>
            </div>
            <div className="p-3 rounded border border-white/10 bg-white/5">
              <div className="flex justify-between items-center mb-1">
                <span className="text-sm font-semibold">Groq (Llama 3.3)</span>
                <div className={`w-2 h-2 rounded-full ${status?.groqActive ? 'bg-green-500' : 'bg-amber-500'}`}></div>
              </div>
              <p className="text-[11px] text-slate-400">High-speed coding LPU</p>
            </div>
            <div className="p-3 rounded border border-white/10 bg-white/5 opacity-50">
              <div className="flex justify-between items-center mb-1">
                <span className="text-sm font-semibold">Qwen Max</span>
                <div className="w-2 h-2 rounded-full bg-slate-700"></div>
              </div>
              <p className="text-[11px] text-slate-400">Educational standby</p>
            </div>
          </div>

          <h2 className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em] mb-4">Core Systems</h2>
          <ul className="space-y-2 text-sm text-slate-300 font-mono">
            <li className="flex items-center justify-between group cursor-help">
              <span className="group-hover:text-indigo-400 transition-colors">Build Engine</span>
              <span className="text-[10px] text-green-500 bg-green-500/10 px-1 rounded">READY</span>
            </li>
            <li className="flex items-center justify-between group cursor-help">
              <span className="group-hover:text-indigo-400 transition-colors">Preview Runner</span>
              <span className="text-[10px] text-green-500 bg-green-500/10 px-1 rounded">READY</span>
            </li>
            <li className="flex items-center justify-between group cursor-help opacity-40">
              <span className="group-hover:text-indigo-400 transition-colors">APK Builder</span>
              <span className="text-[10px] text-slate-500 bg-slate-500/10 px-1 rounded">STANDBY</span>
            </li>
          </ul>
        </aside>

        <main className="col-span-12 lg:col-span-9 p-8 flex flex-col overflow-y-auto">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            <motion.div 
              whileHover={{ y: -4 }}
              className="p-5 rounded-xl bg-gradient-to-br from-indigo-900/20 to-transparent border border-indigo-500/20"
            >
              <div className="text-indigo-400 mb-3"><Cpu className="w-6 h-6" /></div>
              <h3 className="text-lg font-bold mb-1">Coding Core</h3>
              <p className="text-xs text-slate-400 leading-relaxed italic">Generate full-stack logic from natural language instructions.</p>
            </motion.div>
            
            <motion.div 
              whileHover={{ y: -4 }}
              className="p-5 rounded-xl bg-gradient-to-br from-emerald-900/20 to-transparent border border-emerald-500/20"
            >
              <div className="text-emerald-400 mb-3"><Github className="w-6 h-6" /></div>
              <h3 className="text-lg font-bold mb-1">Git Automation</h3>
              <p className="text-xs text-slate-400 leading-relaxed italic">Direct ZIP processing and GitHub repository synchronization.</p>
            </motion.div>

            <motion.div 
              whileHover={{ y: -4 }}
              className="p-5 rounded-xl bg-gradient-to-br from-amber-900/20 to-transparent border border-amber-500/20"
            >
              <div className="text-amber-400 mb-3"><Shield className="w-6 h-6" /></div>
              <h3 className="text-lg font-bold mb-1">Admin Safety</h3>
              <p className="text-xs text-slate-400 leading-relaxed italic">WhatsApp violation reporting and secure account management.</p>
            </motion.div>
          </div>

          <div className="flex-1 flex flex-col rounded-xl bg-[#0D0D14] border border-white/5 overflow-hidden font-mono text-sm shadow-2xl">
            <div className="flex items-center justify-between px-4 py-2 bg-white/5 border-b border-white/5">
              <div className="flex items-center gap-2">
                <div className="flex gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-red-500/50"></div>
                  <div className="w-2.5 h-2.5 rounded-full bg-amber-500/50"></div>
                  <div className="w-2.5 h-2.5 rounded-full bg-green-500/50"></div>
                </div>
                <span className="text-[10px] text-slate-500 ml-2 uppercase tracking-widest">BrokenVzn Agent Session</span>
              </div>
              <div className="text-[10px] text-indigo-500/50">UTF-8 // TELEGRAM_PROTO</div>
            </div>
            
            <div className="flex-1 p-6 space-y-6 overflow-y-auto bg-[radial-gradient(circle_at_50%_0%,rgba(99,102,241,0.05),transparent)]">
              <div className="flex gap-4">
                <span className="text-indigo-400 flex-shrink-0">[AUTH]</span>
                <span className="text-slate-300 italic">User 101 connected to brokenvzn_node_a1...</span>
              </div>

              <div className="p-5 bg-white/5 rounded-lg border border-white/10 max-w-2xl border-l-4 border-l-indigo-600">
                <p className="text-indigo-300 font-bold mb-4 uppercase tracking-wider text-xs">Available Sub-Routines</p>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {['/ping', '/help', '/code', '/shell', '/push', '/unzip'].map((cmd) => (
                    <button key={cmd} className="px-3 py-2 bg-white/5 hover:bg-indigo-600 hover:text-white rounded text-[11px] border border-white/5 hover:border-indigo-400 transition-all text-slate-400 font-bold uppercase tracking-tighter">
                      {cmd}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex gap-4 flex-col md:flex-row">
                <div className="flex gap-4">
                  <span className="text-indigo-400 flex-shrink-0">[SYSTEM]</span>
                  <div className="space-y-2">
                    <p className="text-green-400 flex items-center gap-2 animate-pulse">
                      <Terminal className="w-3 h-3" /> Waiting for Telegram command input...
                    </p>
                    <p className="text-[11px] text-slate-500 leading-relaxed">
                      Connect via @BrokenVznAgentBot to execute tasks. All operations are logged.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="p-4 border-t border-white/5 bg-[#08080C] flex gap-4 items-center">
              <span className="text-indigo-400 animate-pulse font-bold underline underline-offset-4">VZN</span>
              <span className="text-indigo-500 italic block">$</span>
              <input 
                type="text" 
                className="bg-transparent outline-none w-full placeholder-slate-700 text-indigo-100 italic" 
                placeholder="Telegram bridge active... monitoring commands..." 
                disabled
              />
            </div>
          </div>
        </main>
      </div>

      <footer className="h-10 border-t border-white/5 bg-[#08080C] px-8 flex items-center justify-between text-[10px] text-slate-500 font-mono uppercase tracking-widest">
        <div className="flex items-center gap-4">
          <span>BrokenVzn Digital Automation Group</span>
          <span className="text-slate-800">|</span>
          <span className="hover:text-indigo-400 cursor-pointer transition-colors">Documentation</span>
          <span className="hover:text-indigo-400 cursor-pointer transition-colors">Security Audit</span>
        </div>
        <div className="hidden sm:flex gap-6 italic text-slate-600">
          <div className="flex gap-2"><span className="text-indigo-500 opacity-50 block">RAM:</span> 4.2GB / 8GB</div>
          <div className="flex gap-2"><span className="text-indigo-500 opacity-50 block">CPU:</span> 12%</div>
          <div className="flex gap-2"><span className="text-indigo-500 opacity-50 block">UPTIME:</span> 243H</div>
        </div>
      </footer>
    </div>
  );
}

