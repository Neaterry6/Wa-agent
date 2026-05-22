import fs from 'fs-extra';
import path from 'node:path';
import { runGit, runShell } from '../services/systemService.js';
import { createWorkspace, listWorkspaces } from '../services/workspaceService.js';
import { isOwnerJid } from '../utils/registry.js';

function jidToPhone(jid = '') {
  return String(jid).split('@')[0].split(':')[0];
}

function textOf(message) {
  return message?.message?.conversation || message?.message?.extendedTextMessage?.text || '';
}

export async function handleMessage(sock, message, options) {
  const text = textOf(message);
  const remoteJid = message?.key?.remoteJid;
  if (!text || !remoteJid) return;

  if (/^!ping/i.test(text)) return sock.sendMessage(remoteJid, { text: 'pong 🏓' }, { quoted: message });

  if (/^!tagme/i.test(text)) {
    const sender = message.key.participant || message.key.remoteJid;
    return sock.sendMessage(remoteJid, { text: `@${jidToPhone(sender)} tagged as requested.`, mentions: [sender] }, { quoted: message });
  }

  if (/^!sendzip\s+/i.test(text)) {
    const zipPath = text.replace(/^!sendzip\s+/i, '').trim();
    if (!await fs.pathExists(zipPath)) return sock.sendMessage(remoteJid, { text: `File not found: ${zipPath}` }, { quoted: message });
    return sock.sendMessage(remoteJid, { document: await fs.readFile(zipPath), fileName: path.basename(zipPath), mimetype: 'application/zip' }, { quoted: message });
  }

  if (/^!shell\s+/i.test(text)) {
    if (!isOwnerJid(message, options.ownerNumber)) return sock.sendMessage(remoteJid, { text: '⛔ Owner only command.' }, { quoted: message });
    const result = await runShell(text.replace(/^!shell\s+/i, '')).catch((e) => `Shell error: ${e.message}`);
    return sock.sendMessage(remoteJid, { text: String(result).slice(0, 3500) }, { quoted: message });
  }

  if (/^!git\s+/i.test(text)) {
    if (!isOwnerJid(message, options.ownerNumber)) return sock.sendMessage(remoteJid, { text: '⛔ Owner only command.' }, { quoted: message });
    const result = await runGit(text.replace(/^!git\s+/i, '')).catch((e) => `Git error: ${e.message}`);
    return sock.sendMessage(remoteJid, { text: String(result).slice(0, 3500) }, { quoted: message });
  }

  if (/^!workspace\s+/i.test(text)) {
    if (!isOwnerJid(message, options.ownerNumber)) return sock.sendMessage(remoteJid, { text: '⛔ Owner only command.' }, { quoted: message });
    const args = text.replace(/^!workspace\s+/i, '').trim().split(/\s+/);
    const action = args.shift();
    if (action === 'create') {
      const dir = createWorkspace(args.join(' ') || 'default');
      return sock.sendMessage(remoteJid, { text: `✅ Workspace created: ${dir}` }, { quoted: message });
    }
    if (action === 'list') {
      const all = listWorkspaces();
      return sock.sendMessage(remoteJid, { text: all.length ? `📂 Workspaces:\n${all.join('\n')}` : 'No workspaces yet.' }, { quoted: message });
    }
    return sock.sendMessage(remoteJid, { text: 'Usage: !workspace <create|list> [name]' }, { quoted: message });
  }

  if (!text.startsWith('!')) {
    return sock.sendMessage(remoteJid, { text: `Received: "${text.slice(0, 400)}"` }, { quoted: message });
  }
}
