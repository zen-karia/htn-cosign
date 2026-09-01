import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import type { Task } from '../src/core/models';
import { COMPLEX_CLAIM, DEMO_CLAIM } from '../src/data/corpus';

const port = Number(process.env.E2E_PORT || 8790), base = `http://127.0.0.1:${port}`;
mkdirSync('.cache/e2e', { recursive: true });
const args = ['scripts/wrangler.mjs', 'dev', '--ip', '127.0.0.1', '--port', String(port), '--persist-to', '.cache/e2e/state'];
for (const service of ['OPENAI', 'GPTZERO', 'ELASTICSEARCH', 'SOLANA', 'SENTRY']) args.push('--var', `MOCK_MODE_${service}:true`);
const child = spawn(process.execPath, args, { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });
let logs = ''; child.stdout.on('data', d => { logs += d.toString(); }); child.stderr.on('data', d => { logs += d.toString(); });
async function waitReady() { const deadline = Date.now() + 45_000; while (Date.now() < deadline) { if (child.exitCode !== null) throw new Error(`Worker exited: ${logs.slice(-3000)}`); try { const r = await fetch(`${base}/api/config`); if (r.ok) return; } catch {} await new Promise(r => setTimeout(r, 200)); } throw new Error(`Worker failed to start: ${logs.slice(-3000)}`); }
async function complete(scenario: string, extra = {}) {
  const key = crypto.randomUUID(); const body = JSON.stringify({ claim: DEMO_CLAIM, scenario, ...extra });
  const response = await fetch(`${base}/api/tasks`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': key }, body });
  assert.equal(response.status, 201); assert.equal(response.headers.get('x-cosign-backend'), 'cloudflare-durable-objects');
  const duplicate = await fetch(`${base}/api/tasks`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': key }, body }); assert.equal(duplicate.status, 200);
  const conflict = await fetch(`${base}/api/tasks`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': key }, body: JSON.stringify({ claim: 'A different authorization must not reuse the same key.' }) }); assert.equal(conflict.status, 409);
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const task = await (await fetch(`${base}/api/tasks/${key}`)).json() as Task;
    if (task.phase === 'complete') return task;
    if (task.attempts >= 3) throw new Error(JSON.stringify({ phase: task.phase, error: task.error, logs: logs.slice(-4000) }));
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error(`Timed out waiting for ${scenario}: ${logs.slice(-3000)}`);
}
try {
  await waitReady();
  const home = await fetch(base); assert.equal(home.status, 200); assert.match(await home.text(), /Cosign/);
  const badRequest = await fetch(`${base}/api/tasks`, { method: 'POST', body: JSON.stringify({ claim: 'short' }) }); assert.equal(badRequest.status, 400);
  const origin = await fetch(`${base}/api/tasks`, { method: 'POST', headers: { origin: 'https://untrusted.example' }, body: '{}' }); assert.equal(origin.status, 403);
  const good = await complete('reliable'); assert.equal(good.status, 'paid'); assert.equal(good.paid_sol, 0.05); assert.equal(good.receipts.length, 2);
  const bad = await complete('fabricator'); assert.equal(bad.status, 'refunded'); assert.equal(bad.refunded_sol, 0.05); assert.equal(bad.deliveries[0].dispute?.resolution, 'auto_refund');
  const pool = await complete('pool', { decompose: true, claim: COMPLEX_CLAIM }); assert.equal(pool.deliveries.length, 12); assert.equal(pool.paid_sol, 0.1); assert.equal(pool.refunded_sol, 0.1); assert.equal(pool.parent_verdict, 'refuted');
  const naive = await complete('fabricator', { protected: false }); assert.equal(naive.paid_sol, 0.05); assert.equal(naive.deliveries[0].verification, undefined);
  const repeat = await fetch(`${base}/api/tasks/${pool.task_id}/retry`, { method: 'POST' }); const unchanged = await repeat.json() as Task; assert.equal(unchanged.receipts.length, 5);
  writeFileSync('.cache/e2e/results.json', JSON.stringify({ passed: true, at: new Date().toISOString(), cases: ['actual Worker/DO backend', 'input validation', 'CSRF rejection', 'idempotent task post', 'happy payout', 'dispute refund', 'pool', 'decomposition', 'contested resolution', 'naive baseline', 'no double settlement'], task_ids: [good.task_id, bad.task_id, pool.task_id, naive.task_id] }, null, 2));
  console.log('PASS: actual Wrangler Worker + Durable Objects; happy, dispute, pool/decomposition, naive flow, idempotency, input validation.');
} finally {
  writeFileSync(resolve('.cache/e2e/worker.log'), logs);
  child.kill('SIGTERM');
  await new Promise<void>(resolve => { child.once('exit', () => resolve()); setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 5000).unref(); });
}
