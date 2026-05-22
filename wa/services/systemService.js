import { exec as execCb } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(execCb);

export async function runShell(command) {
  const cmd = String(command || '').trim();
  if (!cmd) return 'Usage: !shell <command>';
  const { stdout, stderr } = await execAsync(cmd, { timeout: 30000, maxBuffer: 1024 * 1024 });
  return [stdout?.trim(), stderr?.trim()].filter(Boolean).join('\n') || 'Command completed with no output.';
}

export async function runGit(args) {
  const safeArgs = String(args || '').trim();
  if (!safeArgs) return 'Usage: !git <args>';
  const { stdout, stderr } = await execAsync(`git ${safeArgs}`, { timeout: 30000, maxBuffer: 1024 * 1024 });
  return [stdout?.trim(), stderr?.trim()].filter(Boolean).join('\n') || 'Git command completed with no output.';
}
