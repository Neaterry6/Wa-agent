import 'dotenv/config';
import P from 'pino';
import fs from 'fs-extra';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, makeCacheableSignalKeyStore } from '@whiskeysockets/baileys';
import { handleMessage } from './wa/controllers/messageController.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SESSION_DIR = path.join(__dirname, 'session_single');
const SESSION_EXPORT_FILE = path.join(__dirname, 'data', 'generated_session_id.txt');
const BOT_HANDLE = (process.env.BOT_HANDLE || 'brokenvzn').toLowerCase();
const OWNER_NUMBER = String(process.env.OWNER_NUMBER || '').replace(/\D/g, '');

let cachedPairingNumber = null;

function jidToPhone(jid = '') {
  return String(jid).split('@')[0].split(':')[0];
}

function shouldRespondInGroup(message, sock) {
  const remoteJid = message?.key?.remoteJid || '';
  if (!remoteJid.endsWith('@g.us')) return true;
  const msg = message?.message?.conversation || message?.message?.extendedTextMessage?.text || '';
  if (String(msg).toLowerCase().includes(BOT_HANDLE)) return true;
  const mentions = message?.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
  const me = sock?.user?.id ? `${jidToPhone(sock.user.id)}@s.whatsapp.net` : '';
  return me ? mentions.includes(me) : false;
}

async function promptNumber() {
  if (cachedPairingNumber) return cachedPairingNumber;
  const fromEnv = (process.env.PAIRING_NUMBER || '').replace(/\D/g, '');
  if (fromEnv.length >= 10) return (cachedPairingNumber = fromEnv);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question('📱 Enter WhatsApp number with country code: ');
    const normalized = String(answer || '').replace(/\D/g, '');
    if (normalized.length < 10) throw new Error('Invalid number');
    return (cachedPairingNumber = normalized);
  } finally {
    rl.close();
  }
}

async function persistSessionId() {
  const credsPath = path.join(SESSION_DIR, 'creds.json');
  const keysPath = path.join(SESSION_DIR, 'keys');
  if (!await fs.pathExists(credsPath)) return;
  const creds = await fs.readJSON(credsPath);
  const keys = {};
  if (await fs.pathExists(keysPath)) {
    for (const file of await fs.readdir(keysPath)) {
      if (file.endsWith('.json')) keys[file.replace(/\.json$/, '')] = await fs.readJSON(path.join(keysPath, file));
    }
  }
  const sessionId = `BrokenVzn~${Buffer.from(JSON.stringify({ creds, keys })).toString('base64')}`;
  await fs.ensureDir(path.dirname(SESSION_EXPORT_FILE));
  await fs.writeFile(SESSION_EXPORT_FILE, `${sessionId}\n`, 'utf8');
  console.log('✅ Session saved to data/generated_session_id.txt');
}

async function start() {
  await fs.ensureDir(SESSION_DIR);
  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
  const { version } = await fetchLatestBaileysVersion();
  const sock = makeWASocket({
    version,
    auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, P({ level: 'silent' })) },
    printQRInTerminal: false,
    logger: P({ level: 'silent' }),
    markOnlineOnConnect: true,
    syncFullHistory: false
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async ({ connection }) => {
    if (connection === 'connecting' && !state.creds?.registered) {
      const phone = await promptNumber();
      console.log('⏳ Generating pairing code, please wait...');
      const rawCode = await sock.requestPairingCode(phone);
      console.log(`🔑 Pair code: ${rawCode?.match(/.{1,4}/g)?.join('-') || rawCode}`);
    }
    if (connection === 'open') {
      console.log('✅ WhatsApp connected.');
      await persistSessionId();
    }
  });

  sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const message of messages || []) {
      if (!message?.message) continue;
      if (!shouldRespondInGroup(message, sock)) continue;
      await handleMessage(sock, message, { ownerNumber: OWNER_NUMBER });
    }
  });
}

start().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
