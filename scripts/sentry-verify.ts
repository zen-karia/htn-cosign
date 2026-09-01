import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import { Runtime, ServiceUnavailable } from '../src/services/runtime';
import type { Task } from '../src/core/models';
import { loadEnv, logEvidence } from './env';
const env = loadEnv(); const runtime = new Runtime(env, logEvidence);
if (runtime.mocked('sentry')) throw new Error('Sentry ingestion checks are deferred until live mode and credentials are configured.');
const org = runtime.require('SENTRY_ORG'); if (!/^[a-zA-Z0-9_-]+$/.test(org)) throw new Error('Invalid Sentry organization slug');
const base = env.SENTRY_API_URL || 'https://sentry.io';
const url = new URL(base); if (url.protocol !== 'https:' || !(url.hostname === 'sentry.io' || url.hostname.endsWith('.sentry.io'))) throw new Error('Use the official regional Sentry HTTPS API');
const runs: Task[] = existsSync('artifacts/runs') ? readdirSync('artifacts/runs').filter(f => f.endsWith('.json')).map(f => JSON.parse(readFileSync(`artifacts/runs/${f}`, 'utf8')).task).filter(t => t.service_modes?.sentry === false && t.request.protected && t.phase === 'complete').sort((a, b) => b.created_at.localeCompare(a.created_at)) : [];
const samples = [{ kind: 'happy', task: runs.find(t => t.paid_sol > 0) }, { kind: 'dispute', task: runs.find(t => t.refunded_sol > 0) }];
const results = [];
for (const { kind, task } of samples) {
  if (!task) throw new Error(`No completed ${kind} run with live Sentry. Run the demo and save its receipts first.`);
  const result = await runtime.call('sentry', `verify_${kind}_trace`, () => { throw new Error('Trace ingestion cannot be mocked'); }, async () => {
    const raw = await runtime.json(`${base.replace(/\/$/, '')}/api/0/organizations/${org}/trace-meta/${task.trace_id}/?statsPeriod=24h`, { headers: { authorization: `Bearer ${runtime.require('SENTRY_READ_TOKEN')}` } });
    const metadata = z.object({ spansCount: z.number().positive(), spansCountMap: z.record(z.number()) }).parse(raw);
    const required = ['cosign.grounding', 'cosign.hallucination', 'cosign.judge_a', 'cosign.judge_b', kind === 'happy' ? 'cosign.escrow.release' : 'cosign.escrow.refund'];
    if (required.some(op => !(metadata.spansCountMap[op] > 0))) throw new ServiceUnavailable('sentry', 'Trace is incomplete or not fully indexed; rerun after ingestion');
    return { kind, task_id: task.task_id, trace_id: task.trace_id, trace_url: `https://${org}.sentry.io/explore/traces/trace/${task.trace_id}/`, metadata };
  });
  results.push(result);
}
mkdirSync('artifacts/live', { recursive: true }); writeFileSync('artifacts/live/sentry-validation.json', JSON.stringify({ verified: true, mocked: false, at: new Date().toISOString(), results }, null, 2));
console.log('PASS: Sentry API confirms ingested happy/dispute traces containing verification and settlement spans.');
console.log(results.map(x => x.trace_url).join('\n'));
