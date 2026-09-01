import { mkdirSync, writeFileSync } from 'node:fs';
import { COMPLEX_CLAIM, DEMO_CLAIM } from '../src/data/corpus';
import type { Task } from '../src/core/models';
import { loadEnv } from './env';
import { ensureServer } from './local-server';
const env = loadEnv(), base = env.COSIGN_URL || 'http://127.0.0.1:8787';
const scenario = process.argv.includes('--scenario') ? process.argv[process.argv.indexOf('--scenario') + 1] : 'pool';
const decompose = process.argv.includes('--decompose');
const server = await ensureServer(base);
try {
  const response = await fetch(`${base}/api/tasks`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID(), ...(env.API_TOKEN ? { authorization: `Bearer ${env.API_TOKEN}` } : {}) }, body: JSON.stringify({ claim: decompose ? COMPLEX_CLAIM : DEMO_CLAIM, scenario, protected: !process.argv.includes('--unprotected'), decompose }) });
  if (!response.ok) throw new Error(`Post failed: ${response.status}`);
  const initial = await response.json() as Task; console.log(`Task ${initial.task_id} · ${base}`);
  let last = 0; const deadline = Date.now() + 600_000;
  while (Date.now() < deadline) {
    const task = await (await fetch(`${base}/api/tasks/${initial.task_id}`)).json() as Task;
    for (const event of task.activity.slice(last)) console.log(`${event.at.slice(11, 19)} ${event.stage.padEnd(12)} ${event.message}`);
    last = task.activity.length;
    if (task.attempts >= 3) throw new Error(`Task paused safely: ${task.error}`);
    if (task.phase === 'complete') {
      mkdirSync('artifacts/runs', { recursive: true }); mkdirSync('public', { recursive: true });
      const payload = { version: 1, cached_at: new Date().toISOString(), replay: true, task };
      writeFileSync(`artifacts/runs/${task.task_id}.json`, JSON.stringify(payload, null, 2));
      // Keep a pool run as the dashboard replay, not the unprotected baseline.
      if (task.request.protected && scenario === 'pool') { writeFileSync('artifacts/demo-cache.json', JSON.stringify(payload, null, 2)); writeFileSync('public/demo-cache.json', JSON.stringify(payload, null, 2)); try { writeFileSync('dist/web/demo-cache.json', JSON.stringify(payload, null, 2)); } catch {} }
      console.log(`Completed. Paid ${task.paid_sol.toFixed(3)} SOL; protected/refunded ${task.refunded_sol.toFixed(3)} SOL.`);
      console.log(task.receipts.every(r => r.mocked) ? '[MOCKED] No on-chain transaction was made.' : task.receipts.map(r => r.explorer_url).filter(Boolean).join('\n'));
      break;
    }
    await new Promise(r => setTimeout(r, 400));
    if (Date.now() >= deadline) throw new Error('Run timed out; task remains persisted and retryable.');
  }
} finally { server.stop(); }
