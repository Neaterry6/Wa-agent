import express from 'express';
import fs from 'fs-extra';
import pino from 'pino';
import pn from 'awesome-phonenumber';
import archiver from 'archiver';
import { PassThrough } from 'stream';
import {
  makeWASocket,
  useMultiFileAuthState,
  delay,
  makeCacheableSignalKeyStore,
  Browsers,
  fetchLatestBaileysVersion,
  DisconnectReason
} from '@whiskeysockets/baileys';

const router = express.Router();

const MAX_RECONNECT_ATTEMPTS = 6;
const SESSION_TIMEOUT = 12 * 60 * 1000;
const CLEANUP_DELAY = 5000;
const POST_PAIRING_CODE_WAIT_MS = 4000;
const POST_CONNECT_SETTLE_MS = 8000;
const CREDS_WAIT_TIMEOUT_MS = 15000;
const CREDS_POLL_INTERVAL_MS = 500;
const SESSION_DIR = './auth_info_baileys';

async function removePath(targetPath) {
  if (!await fs.pathExists(targetPath)) return;
  await fs.remove(targetPath);
}

async function zipAuthDir(dirPath) {
  return new Promise((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 9 } });
    const stream = new PassThrough();
    const chunks = [];

    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);

    archive.on('error', reject);
    archive.pipe(stream);
    archive.directory(dirPath, false);
    archive.finalize().catch(reject);
  });
}

async function waitForFile(filePath, timeoutMs = CREDS_WAIT_TIMEOUT_MS, intervalMs = CREDS_POLL_INTERVAL_MS) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fs.pathExists(filePath)) return true;
    await delay(intervalMs);
  }
  return fs.pathExists(filePath);
}

router.get('/', async (req, res) => {
  let num = String(req.query.number || '').replace(/\D/g, '');
  if (!num) return res.status(400).send({ code: 'Phone number is required' });

  const phone = pn(`+${num}`);
  if (!phone.isValid()) return res.status(400).send({ code: 'Invalid phone number.' });

  num = phone.getNumber('e164').replace('+', '');
  const authDir = `${SESSION_DIR}/session_${num}`;

  let pairingCodeSent = false;
  let sessionCompleted = false;
  let isCleaningUp = false;
  let responseSent = false;
  let reconnectAttempts = 0;
  let currentSocket = null;
  let timeoutHandle = null;

  async function cleanup(reason = 'unknown') {
    if (isCleaningUp) return;
    isCleaningUp = true;
    console.log(`🧹 Cleanup (${num}) - ${reason}`);

    if (timeoutHandle) clearTimeout(timeoutHandle);

    if (currentSocket) {
      try {
        currentSocket.ev.removeAllListeners();
        currentSocket.ws?.close?.();
      } catch {}
      currentSocket = null;
    }

    setTimeout(() => removePath(authDir), CLEANUP_DELAY);
  }

  async function initiateSession() {
    if (sessionCompleted || isCleaningUp) return;

    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      if (!responseSent && !res.headersSent) res.status(503).send({ code: 'Connection failed' });
      await cleanup('max_reconnects');
      return;
    }

    try {
      await fs.ensureDir(authDir);
      const { state, saveCreds } = await useMultiFileAuthState(authDir);
      const { version } = await fetchLatestBaileysVersion();

      if (currentSocket) {
        try {
          currentSocket.ev.removeAllListeners();
          currentSocket.ws?.close?.();
        } catch {}
      }

      const sock = makeWASocket({
        version,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' }).child({ level: 'fatal' }))
        },
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: typeof Browsers?.ubuntu === 'function' ? Browsers.ubuntu('Chrome') : Browsers.macOS('Chrome')
      });
      currentSocket = sock;

      sock.ev.on('creds.update', saveCreds);
      sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
        if (connection === 'open') {
          sessionCompleted = true;
          await delay(POST_CONNECT_SETTLE_MS);
          await saveCreds();
          const credsFile = `${authDir}/creds.json`;
          const ready = await waitForFile(credsFile);
          if (!ready) throw new Error('creds.json not found after successful link');

          const zipBuffer = await zipAuthDir(authDir);
          const sessionId = `BrokenVzn~${zipBuffer.toString('base64')}`;
          const savePath = `./data/session_${num}.id`;
          await fs.ensureDir('./data');
          await fs.writeFile(savePath, `${sessionId}\n`, 'utf8');

          if (!responseSent && !res.headersSent) {
            responseSent = true;
            res.send({
              code: 'linked',
              message: 'WhatsApp linked successfully.',
              sessionFile: savePath,
              sessionId
            });
          }
          await cleanup('session_complete');
        }

        if (connection === 'close') {
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          if (sessionCompleted || isCleaningUp) return cleanup('already_complete');

          if ([DisconnectReason.loggedOut, DisconnectReason.badSession, 401].includes(statusCode)) {
            if (!responseSent && !res.headersSent) res.status(401).send({ code: 'Session expired or invalid' });
            return cleanup('logged_out');
          }

          if (pairingCodeSent) {
            reconnectAttempts += 1;
            await delay(2000);
            return initiateSession();
          }

          await cleanup('connection_closed');
        }
      });

      if (!state.creds.registered && !pairingCodeSent) {
        await delay(POST_PAIRING_CODE_WAIT_MS);
        pairingCodeSent = true;
        const code = await sock.requestPairingCode(num);
        if (!responseSent && !res.headersSent) {
          responseSent = true;
          res.send({ code: code?.match(/.{1,4}/g)?.join('-') || code, message: 'Enter this in WhatsApp linked devices.' });
        }
      }

      timeoutHandle = setTimeout(async () => {
        if (!sessionCompleted && !isCleaningUp) {
          if (!responseSent && !res.headersSent) res.status(408).send({ code: 'Pairing timeout — please try again' });
          await cleanup('timeout');
        }
      }, SESSION_TIMEOUT);
    } catch (error) {
      console.error(`❌ Error initializing session for ${num}:`, error);
      if (!responseSent && !res.headersSent) res.status(503).send({ code: 'Service unavailable' });
      await cleanup('init_error');
    }
  }

  await initiateSession();
});

export default router;
