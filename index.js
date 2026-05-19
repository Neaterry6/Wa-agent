import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

const builtServerPath = new URL('./dist/server.mjs', import.meta.url);

if (!existsSync(builtServerPath)) {
  console.log('[bootstrap] dist/server.mjs not found. Building project...');
  execSync('npm run build', { stdio: 'inherit' });
}

await import('./dist/server.mjs');
