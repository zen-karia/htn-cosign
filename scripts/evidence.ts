import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import type { Task } from '../src/core/models';
const runs: Task[] = existsSync('artifacts/runs') ? readdirSync('artifacts/runs').filter(f => f.endsWith('.json')).map(f => JSON.parse(readFileSync(`artifacts/runs/${f}`, 'utf8')).task) : [];
const deliveries = runs.flatMap(t => t.deliveries);
const live = (service: string) => runs.some(t => t.evidence.some(e => e.service === service && e.ok && !e.mocked));
const report = {
  inspected_at: new Date().toISOString(),
  happy_devnet: runs.some(t => t.request.protected && t.receipts.some(r => r.operation === 'release' && !r.mocked && r.explorer_url)),
  dispute_devnet: runs.some(t => t.deliveries.some(d => d.dispute?.resolution === 'auto_refund') && t.receipts.some(r => r.operation === 'refund' && !r.mocked && r.explorer_url)),
  real_judge_disagreement: deliveries.some(d => d.verification && !d.verification.mocked && !d.verification.agreement && d.verification.resolver_verdict.method === 'tiebreak'),
  real_uninstructed_failure: runs.some(t => t.evidence.some(e => e.operation === 'seller_fact_check' && !e.mocked && e.ok) && t.deliveries.some(d => d.seller_id === 'agent-iris' && d.verification && !d.verification.mocked && !d.verification.resolver_verdict.final_pass)),
  pool_settled: runs.some(t => t.slots.length === 4 && t.phase === 'complete' && t.slots.some(s => s.state === 'paid') && t.slots.some(s => s.state === 'refunded')),
  decomposition_contested: runs.some(t => t.sub_claims.length > 1 && t.sub_claims.some(s => s.reconciled_verdict === 'contested' && s.resolution)),
  replay_cached: existsSync('artifacts/demo-cache.json'),
  real_gptzero: live('gptzero'),
  real_elasticsearch_catch: deliveries.some(d => d.verification && !d.verification.grounding_check.mocked && d.verification.grounding_check.unsupported_claims.length > 0) || (existsSync('artifacts/elasticsearch-validation.json') && JSON.parse(readFileSync('artifacts/elasticsearch-validation.json', 'utf8')).elasticsearch_mocked === false),
  real_openai: live('openai'),
  sentry_viewable_happy_and_dispute: existsSync('artifacts/live/sentry-validation.json') && JSON.parse(readFileSync('artifacts/live/sentry-validation.json', 'utf8')).verified === true,
};
mkdirSync('artifacts', { recursive: true }); writeFileSync('artifacts/readiness.json', JSON.stringify(report, null, 2));
console.table(report);
console.log('Run npm run test:sentry after live demos to confirm trace ingestion. Fixture evidence is never credited as live.');
if (process.argv.includes('--require-live') && Object.values(report).some(v => v === false)) process.exitCode = 1;
