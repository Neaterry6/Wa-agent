import 'dotenv/config';
import { Telegraf } from 'telegraf';
import { GoogleGenAI } from '@google/genai';
import Groq from 'groq-sdk';
import axios from 'axios';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';

const execAsync = promisify(exec);
const WORK_DIR = path.join(process.cwd(), 'telegram_workspace');
const CONTEXT_FILE = path.join(WORK_DIR, 'axon-context.json');
const APP_DRAFT_FILE = path.join(WORK_DIR, 'axon-app-draft.json');
const SCREENSHOT_ACCESS_KEY = process.env.SCREENSHOTONE_ACCESS_KEY || 'KN3bMn5VoWZIWw';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const ADMIN_IDS = (process.env.TELEGRAM_ADMIN_IDS || '').split(',').map((v) => v.trim()).filter(Boolean);
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
if (!BOT_TOKEN) throw new Error('Missing TELEGRAM_BOT_TOKEN in environment.');

const bot = new Telegraf(BOT_TOKEN);
const gemini = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null;
const groq = GROQ_API_KEY ? new Groq({ apiKey: GROQ_API_KEY }) : null;

const queue = [];
let busy = false;
let currentTask = null;
let lastEndpoint = 'none';

const isAdmin = (ctx) => ADMIN_IDS.includes(String(ctx.from?.id || ''));
const trimMessage = (text = '', max = 3900) => (text.length > max ? `${text.slice(0, max)}\n...truncated` : text);

async function readJsonFile(filePath, fallback) { try { return JSON.parse(await fs.readFile(filePath, 'utf8')); } catch { return fallback; } }
async function writeJsonFile(filePath, data) { await fs.mkdir(path.dirname(filePath), { recursive: true }); await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8'); }

async function updateContext(mutator) {
  const state = await readJsonFile(CONTEXT_FILE, { lastRepo: '', lastToken: '', lastPushAt: null });
  mutator(state);
  await writeJsonFile(CONTEXT_FILE, state);
  return state;
}

function aiSystemPrompt() {
  return 'You are Axon. You can code in all major languages (js/ts/python/go/rust/java/c/c++/php/ruby/swift/kotlin). Keep replies useful and direct.';
}

function shouldRunNaturalShell(text) {
  return /(\bgit\b|\bshell\b|\bterminal\b|\bnpm\b|\bnode\b|\bpnpm\b|\byarn\b|\bbun\b|\bpython\b|\bpip\b|\bdocker\b|\bzip\b|\bunzip\b|\bclone\b|\bpush\b|\bdeploy\b|\bbuild\b|\brun\b|\bexecute\b|\bcommand\b)/i.test(text);
}

async function askGemini(prompt) {
  if (!gemini) throw new Error('Gemini is not configured.');
  lastEndpoint = 'gemini';
  const response = await gemini.models.generateContent({ model: 'gemini-2.5-flash', config: { systemInstruction: aiSystemPrompt() }, contents: prompt });
  return response.text || 'No response.';
}

async function askGroq(prompt) {
  if (!groq) throw new Error('Groq is not configured.');
  lastEndpoint = 'groq';
  const completion = await groq.chat.completions.create({ model: 'llama-3.3-70b-versatile', messages: [{ role: 'system', content: aiSystemPrompt() }, { role: 'user', content: prompt }], temperature: 0.2 });
  return completion.choices?.[0]?.message?.content || 'No response.';
}

async function planShellCommand(text) {
  const plannerPrompt = [
    'Convert the request to ONE executable bash command (or chained command with &&).',
    'Rules:',
    '- Output command only. No markdown. No explanation.',
    '- Prefer safe repo-local commands in the current workspace.',
    '- If task mentions pushing code/zip to GitHub, include required git steps and use provided URL/token if present.',
    `Request: ${text}`
  ].join('\n');

  const answer = gemini ? await askGemini(plannerPrompt) : await askGroq(plannerPrompt);
  return answer.replace(/```[a-z]*|```/gi, '').trim();
}

async function runShell(command) {
  const { stdout, stderr } = await execAsync(command, { cwd: WORK_DIR, timeout: 240000, maxBuffer: 12 * 1024 * 1024 });
  return [stdout?.trim(), stderr?.trim()].filter(Boolean).join('\n');
}

function enqueueTask(ctx, label, handler) {
  queue.push({ ctx, label, handler });
  if (queue.length > 5) ctx.reply('⚠️ System busy, please wait...').catch(() => {});
  processQueue().catch(() => {});
}

async function processQueue() {
  if (busy) return;
  busy = true;
  try {
    while (queue.length) {
      const task = queue.shift();
      currentTask = task?.label || 'unknown';
      try { await task.handler(); } catch (error) { await task.ctx.reply(`Task failed (${currentTask}): ${error.message}`); }
    }
  } finally { currentTask = null; busy = false; }
}

async function installMediaTools() {
  await runShell('command -v yt-dlp >/dev/null 2>&1 || python3 -m pip install --user yt-dlp');
  await runShell('command -v ffmpeg >/dev/null 2>&1 || (apt-get update && apt-get install -y ffmpeg) || true');
}

async function runGitPush(ctx, repo, token) {
  const normalizedRepo = repo.replace(/^https?:\/\//, '').replace(/^github\.com\//, '').replace(/\.git$/, '');
  const remote = `https://${token}@github.com/${normalizedRepo}.git`;
  const steps = ['git init', 'git remote remove origin || true', `git remote add origin "${remote}"`, 'git add .', 'git commit -m "AI Agent commit" || git commit --allow-empty -m "AI Agent commit"', 'git branch -M main', 'git push -u origin main'];
  for (let i = 0; i < steps.length; i += 1) { await ctx.reply(`🚀 Push step ${i + 1}/${steps.length}: ${steps[i]}`); const out = await runShell(steps[i]); if (out) await ctx.reply(trimMessage(out)); }
  await updateContext((state) => { state.lastRepo = normalizedRepo; state.lastToken = token; state.lastPushAt = Date.now(); });
  await ctx.reply('✅ Git push complete.');
}

async function screenshotUrl(ctx, url) {
  const apiUrl = `https://api.screenshotone.com/take?access_key=${SCREENSHOT_ACCESS_KEY}&url=${encodeURIComponent(url)}&format=jpg&full_page=true&block_ads=true&block_cookie_banners=true&block_trackers=true&image_quality=80`;
  const response = await axios.get(apiUrl, { responseType: 'arraybuffer', timeout: 30000 });
  const filePath = path.join(WORK_DIR, `screenshot-${Date.now()}.jpg`);
  await fs.writeFile(filePath, Buffer.from(response.data));
  await ctx.replyWithPhoto({ source: filePath });
}

async function generateImage(ctx, prompt) {
  const apiUrl = `https://theone-fast-image-gen.vercel.app/download-image?prompt=${encodeURIComponent(prompt)}&expires=${Date.now() + 10000}&size=16%3A9`;
  const response = await axios.get(apiUrl, { responseType: 'arraybuffer', timeout: 30000, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } });
  const buffer = Buffer.from(response.data, 'binary');
  await ctx.replyWithPhoto({ source: buffer });
}

async function webSearch(ctx, query) {
  const html = await axios.get(`https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`, { timeout: 20000 }).then((r) => r.data);
  const lines = html.split('\n').filter((l) => l.includes('result__a')).slice(0, 5).map((l) => l.replace(/<[^>]+>/g, '').trim()).filter(Boolean);
  await ctx.reply(trimMessage(`Top web results for: ${query}\n- ${lines.join('\n- ') || 'No results parsed.'}`));
}

async function downloadMedia(ctx, url, mode = 'audio') {
  await installMediaTools();
  const outTemplate = path.join(WORK_DIR, `media-${Date.now()}.%(ext)s`);
  const cmd = mode === 'video' ? `yt-dlp -f "bv*+ba/b" --merge-output-format mp4 -o "${outTemplate}" "${url}"` : `yt-dlp -x --audio-format mp3 -o "${outTemplate}" "${url}"`;
  await runShell(cmd);
  const files = await fs.readdir(WORK_DIR);
  const picked = files.filter((f) => f.startsWith('media-')).sort().pop();
  if (!picked) throw new Error('Download failed.');
  const full = path.join(WORK_DIR, picked);
  if (mode === 'video') await ctx.replyWithVideo({ source: full }); else await ctx.replyWithAudio({ source: full });
}

bot.command('status', async (ctx) => { const state = await readJsonFile(CONTEXT_FILE, { lastRepo: 'none' }); await ctx.reply(`📊 Queue length: ${queue.length}\n⚙️ Current task: ${currentTask || 'idle'}\n🧠 Last AI endpoint: ${lastEndpoint}\n📦 Last repo pushed: ${state.lastRepo || 'none'}`); });
bot.command('shell', async (ctx) => { if (!isAdmin(ctx)) return ctx.reply('Not allowed.'); const command = ctx.message?.text?.replace('/shell', '').trim(); if (!command) return ctx.reply('Usage: /shell <command>'); enqueueTask(ctx, `shell: ${command}`, async () => { await ctx.reply(`▶️ Running: ${command}`); await ctx.reply(trimMessage(await runShell(command) || 'Done.')); }); });
bot.command('push', async (ctx) => { if (!isAdmin(ctx)) return ctx.reply('Not allowed.'); const [repo, token] = (ctx.message?.text?.replace('/push', '').trim() || '').split(/\s+/); if (!repo || !token) return ctx.reply('Usage: /push <repo> <token>'); enqueueTask(ctx, `git push ${repo}`, async () => runGitPush(ctx, repo, token)); });
bot.command('sendfile', async (ctx) => { if (!isAdmin(ctx)) return ctx.reply('Not allowed.'); const rel = ctx.message?.text?.replace('/sendfile', '').trim(); if (!rel) return ctx.reply('Usage: /sendfile <path>'); await ctx.replyWithDocument({ source: path.join(WORK_DIR, rel) }); });

bot.on('text', async (ctx) => {
  const text = ctx.message?.text?.trim() || '';
  if (text.startsWith('/')) return;

  if (isAdmin(ctx)) {
    if (/^screenshot\s+/i.test(text)) return enqueueTask(ctx, 'screenshot', async () => screenshotUrl(ctx, text.replace(/^screenshot\s+/i, '').trim()));
    if (/^generate image\s+/i.test(text)) return enqueueTask(ctx, 'image-gen', async () => generateImage(ctx, text.replace(/^generate image\s+/i, '').trim()));
    if (/^search\s+/i.test(text)) return enqueueTask(ctx, 'web-search', async () => webSearch(ctx, text.replace(/^search\s+/i, '').trim()));
    if (/^(play song|download song)\s+/i.test(text)) return enqueueTask(ctx, 'download-audio', async () => downloadMedia(ctx, text.replace(/^(play song|download song)\s+/i, '').trim(), 'audio'));
    if (/^(download video|send video)\s+/i.test(text)) return enqueueTask(ctx, 'download-video', async () => downloadMedia(ctx, text.replace(/^(download video|send video)\s+/i, '').trim(), 'video'));
    if (shouldRunNaturalShell(text)) return enqueueTask(ctx, 'nl-cli', async () => {
      await ctx.reply('🧠 Planning terminal command from your request...');
      const cmd = await planShellCommand(text);
      await ctx.reply(trimMessage(`▶️ Running command:\n${cmd}`));
      const out = await runShell(cmd);
      await ctx.reply(trimMessage(out || 'Done.'));
    });
  }

  try { const answer = await askGemini(`${text}\n\nIf relevant, mention you can handle coding in many languages, web search, screenshot, media downloads, and git/shell execution.`); await ctx.reply(trimMessage(answer)); }
  catch (error) { await ctx.reply(`AI error: ${error.message}`); }
});

await fs.mkdir(WORK_DIR, { recursive: true });
bot.launch();
console.log('✅ Telegram bot started. Workspace:', WORK_DIR);
