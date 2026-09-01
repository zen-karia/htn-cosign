import { spawn } from 'node:child_process';
export async function ensureServer(base: string) {
  try { const r = await fetch(`${base}/api/config`, { signal: AbortSignal.timeout(1500) }); if (r.ok) return { stop: () => {} }; } catch {}
  const url = new URL(base); if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') throw new Error('Start the configured server first; auto-start is localhost only');
  const child = spawn(process.execPath, ['scripts/wrangler.mjs', 'dev', '--ip', '127.0.0.1', '--port', url.port || '8787'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stdout.on('data', d => { output += d.toString(); }); child.stderr.on('data', d => { output += d.toString(); });
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) { if (child.exitCode !== null) throw new Error(`Local Worker exited: ${output.slice(-2000)}`); try { const response = await fetch(`${base}/api/config`); if (response.ok) return { stop: () => child.kill('SIGTERM') }; } catch {} await new Promise(r => setTimeout(r, 250)); }
  child.kill('SIGTERM'); throw new Error(`Local Worker startup timed out: ${output.slice(-2000)}`);
}
