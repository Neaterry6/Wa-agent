import 'dotenv/config';
import { Telegraf } from 'telegraf';
import { GoogleGenAI } from '@google/genai';
import Groq from 'groq-sdk';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';

const execAsync = promisify(exec);
const WORK_DIR = path.join(process.cwd(), 'telegram_workspace');

const BOT_ID = process.env.TELEGRAM_BOT_ID || '';
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const ADMIN_IDS = (process.env.TELEGRAM_ADMIN_IDS || '').split(',').map((v) => v.trim()).filter(Boolean);
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';

if (!BOT_TOKEN) throw new Error('Missing TELEGRAM_BOT_TOKEN in environment.');

const bot = new Telegraf(BOT_TOKEN);
const gemini = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null;
const groq = GROQ_API_KEY ? new Groq({ apiKey: GROQ_API_KEY }) : null;

function isAdmin(ctx) { return ADMIN_IDS.includes(String(ctx.from?.id || '')); }

function aiSystemPrompt() {
  return 'You are Axon. Reply to everyone who texts you. Be blunt, sarcastic, and a bit rude, but still helpful. You are great at shell, git, zip tasks, and writing scripts.';
}

async function askGemini(prompt) {
  if (!gemini) throw new Error('Gemini is not configured. Add GEMINI_API_KEY.');
  const response = await gemini.models.generateContent({ model: 'gemini-2.5-flash', config: { systemInstruction: aiSystemPrompt() }, contents: prompt });
  return response.text || 'No response from Gemini.';
}

async function askGroq(prompt) {
  if (!groq) throw new Error('Groq is not configured. Add GROQ_API_KEY.');
  const completion = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [{ role: 'system', content: aiSystemPrompt() }, { role: 'user', content: prompt }],
    temperature: 0.2
  });
  return completion.choices?.[0]?.message?.content || 'No response from Groq.';
}

async function runShell(command) {
  const { stdout, stderr } = await execAsync(command, { cwd: WORK_DIR, timeout: 180000, maxBuffer: 8 * 1024 * 1024 });
  return [stdout?.trim(), stderr?.trim()].filter(Boolean).join('\n');
}

async function getRepliedText(ctx) {
  return ctx.message?.reply_to_message?.text || ctx.message?.reply_to_message?.caption || '';
}

async function downloadTelegramFile(fileId) {
  const fileInfo = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fileId}`).then((r) => r.json());
  if (!fileInfo?.ok || !fileInfo?.result?.file_path) throw new Error('Could not resolve Telegram file path.');
  const filePath = fileInfo.result.file_path;
  const fileName = path.basename(filePath);
  const localPath = path.join(WORK_DIR, fileName);
  const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;
  const buffer = Buffer.from(await fetch(fileUrl).then((r) => r.arrayBuffer()));
  await fs.mkdir(WORK_DIR, { recursive: true });
  await fs.writeFile(localPath, buffer);
  return localPath;
}

async function getZipFromMessage(ctx) {
  const message = ctx.message || {};
  const reply = message.reply_to_message || {};
  const doc = message.document || reply.document;
  if (!doc) return null;
  const name = (doc.file_name || '').toLowerCase();
  if (!name.endsWith('.zip')) return null;
  return downloadTelegramFile(doc.file_id);
}


function looksLikeExecutionRequest(text = '') {
  const t = text.toLowerCase();
  const keys = [
    'git ', 'clone ', 'push ', 'pull ', 'commit ', 'checkout ',
    'zip', 'unzip', 'tar ', 'npm ', 'node ', 'python ', 'bash ', 'sh ',
    'make script', 'write script', 'create script', 'run command', 'terminal', 'repo'
  ];
  return keys.some((k) => t.includes(k));
}

async function writeScriptFromPrompt(ctx, userText) {
  const prompt = `Create one bash script from this request. Return JSON with keys: filename, content. Request: ${userText}`;
  const raw = await askGemini(prompt);
  const cleaned = raw.replace(/```json|```/gi, '').trim();
  const parsed = JSON.parse(cleaned);
  const filename = String(parsed.filename || 'script.sh').replace(/[^a-zA-Z0-9._-]/g, '_');
  const outPath = path.join(WORK_DIR, filename);
  await fs.writeFile(outPath, String(parsed.content || '#!/usr/bin/env bash\necho ok\n'), 'utf8');
  await runShell(`chmod +x "${outPath}"`);
  await ctx.reply(`Script written: ${outPath}`);
  await ctx.replyWithDocument({ source: outPath });
}

async function executeNaturalTask(ctx, userText) {
  const replied = await getRepliedText(ctx);
  const zipPath = await getZipFromMessage(ctx);
  const prompt = `Convert this request into one safe shell command chain. Return shell only, no markdown.\nRequest: ${userText}\nReplied context: ${replied || 'none'}\nDownloaded zip path: ${zipPath || 'none'}\nUse cwd only.`;
  const command = (await askGemini(prompt)).replace(/```[a-z]*|```/gi, '').trim();
  const output = await runShell(command);
  await ctx.reply(`Executed:\n${command}`.slice(0, 4000));
  await ctx.reply((output || 'Done (no output).').slice(0, 4000));
}

bot.start((ctx) => ctx.reply('Axon is online. Text me normally, I reply to everyone. Admins can request shell/git/zip tasks directly.'));

bot.command('id', (ctx) => ctx.reply(`Your Telegram ID: ${ctx.from?.id || 'unknown'}\nBot ID: ${BOT_ID || 'not set'}`));

bot.command('shell', async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply('Not allowed.');
  const command = ctx.message?.text?.replace('/shell', '').trim();
  if (!command) return ctx.reply('Usage: /shell <command>');
  try { await ctx.reply((await runShell(command) || 'Done.').slice(0, 4000)); } catch (error) { await ctx.reply(`Command failed: ${error.message}`); }
});

bot.command('zipls', async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply('Not allowed.');
  try {
    const zipPath = await getZipFromMessage(ctx);
    if (!zipPath) return ctx.reply('Reply to a .zip file and run /zipls');
    const out = await runShell(`unzip -l "${zipPath}"`);
    await ctx.reply(out.slice(0, 4000));
  } catch (error) { await ctx.reply(`zipls error: ${error.message}`); }
});

bot.command('unzip', async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply('Not allowed.');
  try {
    const zipPath = await getZipFromMessage(ctx);
    if (!zipPath) return ctx.reply('Reply to a .zip file and run /unzip');
    const target = path.join(WORK_DIR, path.basename(zipPath, '.zip'));
    await fs.mkdir(target, { recursive: true });
    const out = await runShell(`unzip -o "${zipPath}" -d "${target}" && ls -la "${target}"`);
    await ctx.reply(`Unzipped to: ${target}`);
    await ctx.reply(out.slice(0, 4000));
  } catch (error) { await ctx.reply(`unzip error: ${error.message}`); }
});

bot.command('sendzip', async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply('Not allowed.');
  const rel = ctx.message?.text?.replace('/sendzip', '').trim();
  if (!rel) return ctx.reply('Usage: /sendzip <folder-or-file-in-workspace>');
  try {
    const src = path.join(WORK_DIR, rel);
    const zipFile = `${src}.zip`;
    await runShell(`cd "${WORK_DIR}" && zip -r "${zipFile}" "${src}"`);
    await ctx.replyWithDocument({ source: zipFile });
  } catch (error) { await ctx.reply(`sendzip error: ${error.message}`); }
});

bot.command('ai', async (ctx) => {
  const prompt = ctx.message?.text?.replace('/ai', '').trim();
  if (!prompt) return ctx.reply('Usage: /ai your question');
  try {
    const replied = await getRepliedText(ctx);
    const answer = await askGemini(`${prompt}\n\nReplied message context: ${replied || 'none'}`);
    await ctx.reply(answer.slice(0, 4000));
  } catch (error) { await ctx.reply(`Gemini error: ${error.message}`); }
});

bot.command('grok', async (ctx) => {
  const prompt = ctx.message?.text?.replace('/grok', '').trim();
  if (!prompt) return ctx.reply('Usage: /grok your question');
  try {
    const replied = await getRepliedText(ctx);
    const answer = await askGroq(`${prompt}\n\nReplied message context: ${replied || 'none'}`);
    await ctx.reply(answer.slice(0, 4000));
  } catch (error) { await ctx.reply(`Groq error: ${error.message}`); }
});

bot.on('document', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const docName = ctx.message?.document?.file_name || 'file';
  if (!docName.toLowerCase().endsWith('.zip')) return ctx.reply(`Received ${docName}.`);
  try {
    const local = await downloadTelegramFile(ctx.message.document.file_id);
    const list = await runShell(`unzip -l "${local}"`);
    await ctx.reply(`Zip saved: ${local}`);
    await ctx.reply(list.slice(0, 4000));
  } catch (error) { await ctx.reply(`Zip receive error: ${error.message}`); }
});

bot.on('text', async (ctx) => {
  const text = ctx.message?.text?.trim() || '';
  if (text.startsWith('/')) return;
  try {
    if (isAdmin(ctx) && looksLikeExecutionRequest(text)) return executeNaturalTask(ctx, text);
    if (isAdmin(ctx) && /write script|make script|create script/i.test(text)) return writeScriptFromPrompt(ctx, text);
    const replied = await getRepliedText(ctx);
    const answer = await askGemini(`${text}\n\nReplied message context: ${replied || 'none'}`);
    await ctx.reply(answer.slice(0, 4000));
  } catch (error) {
    await ctx.reply(`AI error: ${error.message}`);
  }
});

await fs.mkdir(WORK_DIR, { recursive: true });
bot.launch();
console.log('✅ Telegram bot started. Workspace:', WORK_DIR);
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
