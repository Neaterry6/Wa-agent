import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'workspaces');

function ensureRoot() {
  if (!fs.existsSync(ROOT)) fs.mkdirSync(ROOT, { recursive: true });
}

export function createWorkspace(name) {
  ensureRoot();
  const dir = path.join(ROOT, String(name || 'default').trim());
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function listWorkspaces() {
  ensureRoot();
  return fs.readdirSync(ROOT, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
}
