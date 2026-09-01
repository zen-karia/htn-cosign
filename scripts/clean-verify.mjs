import { cpSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
const source = process.cwd(); const dest = resolve('.verify', `clean-${Date.now()}`); mkdirSync(dest, { recursive: true });
const excluded = new Set(['.git', 'node_modules', '.env', '.dev.vars', '.keys', '.tools', '.cache', '.verify', '.wrangler', 'dist', 'target', '.anchor']);
for (const name of readdirSync(source)) if (!excluded.has(name)) cpSync(resolve(source, name), resolve(dest, name), { recursive: true, filter: path => { const parts = relative(source, path).split('/'); return !parts.some(p => excluded.has(p)) && !parts.includes('live'); } });
// Literally the README local setup/check sequence, with no copied dependencies, credentials or state.
const commands = [['ci', '--cache', '.cache/npm'], ['run', 'setup'], ['run', 'seed'], ['test'], ['run', 'build'], ['run', 'test:e2e'], ['run', 'demo', '--', '--decompose'], ['run', 'demo:replay']];
const outcomes = [];
for (const args of commands) {
  console.log(`CLEAN: npm ${args.join(' ')}`);
  const result = spawnSync('npm', args, { cwd: dest, env: { ...process.env, E2E_PORT: '8791', COSIGN_URL: 'http://127.0.0.1:8792' }, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  outcomes.push({ command: `npm ${args.join(' ')}`, exit_code: result.status });
  writeFileSync(resolve(dest, `.cache/clean-${outcomes.length}.log`), (result.stdout || '') + (result.stderr || ''));
  if (result.status !== 0) { console.error((result.stderr || result.stdout || '').slice(-4000)); throw new Error(`Clean verification failed at ${args.join(' ')}`); }
}
mkdirSync('artifacts', { recursive: true }); writeFileSync('artifacts/clean-verification.json', JSON.stringify({ at: new Date().toISOString(), fresh_directory: relative(source, dest), no_dependencies_or_env_copied: true, commands: outcomes }, null, 2));
console.log(`PASS: clean setup/build/Worker tests/demo/offline replay in ${relative(source, dest)}`);
