import { describe, expect, it, vi } from 'vitest';
import { createTask, Engine } from '../src/core/engine';
import { corpus, COMPLEX_CLAIM, DEMO_CLAIM } from '../src/data/corpus';
import type { Task } from '../src/core/models';
import type { EscrowService } from '../src/services/escrow';

async function run(scenario: string, extra = {}) {
  const task = createTask({ claim: DEMO_CLAIM, scenario, ...extra }, {});
  const engine = new Engine(task, {}, async () => {});
  while (task.phase !== 'complete') await engine.step();
  return task;
}
describe('phase 1 end-to-end state machine', () => {
  it('creates a fixture-free live pool while pinning settlement to simulation', () => {
    const task = createTask({ claim: 'The Eiffel Tower opened to the public on May 15, 1889.', execution_mode: 'live' }, { OPENAI_API_KEY: 'configured', ELASTICSEARCH_URL: 'https://index.example' });
    expect(task.phase).toBe('classify');
    expect(task.slots.map(slot => slot.seller_id)).toEqual(['research-agent-1', 'research-agent-2', 'research-agent-3', 'research-agent-4']);
    expect(task.service_modes).toMatchObject({ openai: false, elasticsearch: false, evidence: false, solana: true });
  });
  it('rejects non-verifiable live work before creating a simulated escrow receipt', async () => {
    const task = createTask({ claim: 'Vanilla ice cream is objectively the best flavor.', execution_mode: 'live' }, { OPENAI_API_KEY: 'configured', ELASTICSEARCH_URL: 'https://index.example' });
    const engine = new Engine(task, {}, async () => {});
    vi.spyOn(engine.models, 'classify').mockResolvedValue({ classification: 'SUBJECTIVE', reason: 'This is a preference.' });
    await engine.step();
    expect(task.phase).toBe('complete'); expect(task.receipts).toEqual([]); expect(task.verifiability?.classification).toBe('SUBJECTIVE');
  });
  it('locks, verifies, releases and ends with zero locked balance', async () => {
    const task = await run('reliable');
    expect(task.status).toBe('paid'); expect(task.paid_sol).toBe(0.05); expect(task.locked_sol).toBe(0);
    expect(task.receipts.map(r => r.operation)).toEqual(['initialize', 'release']);
  });
  it('accepts the percentage spelling a judge can type into the demo', async () => {
    const task = await run('reliable', { claim: DEMO_CLAIM.replace('80 percent', '80%') });
    expect(task.status).toBe('paid'); expect(task.parent_verdict).toBe('refuted');
  });
  it('survives paraphrasing by the live decomposition adapter through settlement', async () => {
    const env = { MOCK_MODE_OPENAI: 'false', OPENAI_API_KEY: 'test-only' };
    const task = createTask({ claim: DEMO_CLAIM, scenario: 'reliable', decompose: true }, env);
    const engine = new Engine(task, env, async () => {});
    const paraphrase = 'Annual operating emissions from Meridian electric ferries fell by 80%.';
    const sources = corpus.slice(-3).map(d => ({ url: d.url, quote: d.text }));
    // Real structured adapters and engine; transport and payment rails stay stubbed.
    vi.spyOn(engine.runtime, 'json').mockImplementation(async <T>(_url: string, init: RequestInit): Promise<T> => {
      const body = JSON.parse(init.body as string);
      const operation = body.text.format.name;
      const payload = JSON.parse(body.input);
      const content = operation === 'buyer_decomposition' ? { claims: [paraphrase] }
        : operation === 'seller_fact_check' ? { verdict: 'refuted', reasoning: 'The indexed audit measures an 18 percent reduction, not 80 percent.', sources }
        : operation === 'passage_entailment' ? { assessments: payload.passages.map((p: { citation_index: number }) => ({ citation_index: p.citation_index, supports_verdict: true, reasoning: 'The measured reduction contradicts the claim.' })) }
        : operation.startsWith('judge_') ? { verdict: 'refuted', confidence: 0.95, grounded: true, unsupported_claims: [], evidence_ids: corpus.slice(-3).map(d => d.id), reason: 'The cited records refute the claim.' } : undefined;
      if (!content) throw new Error(`Unexpected operation: ${operation}`);
      return { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(content) } }] } as T;
    });
    while (task.phase !== 'complete') await engine.step();
    expect(task.sub_claims[0].text).toBe(paraphrase);
    expect(task.status).toBe('paid'); expect(task.paid_sol).toBe(0.05);
    expect(task.deliveries[0].verification?.grounding_check.unsupported_claims).toEqual([]);
    expect(task.receipts.every(r => r.mocked)).toBe(true);
  });
  it('restores an active status when retrying a stalled stage', async () => {
    const task = createTask({ claim: DEMO_CLAIM, scenario: 'reliable' }, {});
    task.status = 'stalled';
    await new Engine(task, {}, async () => {}).step();
    expect(task.status).toBe('posted'); expect(task.phase).toBe('decompose');
  });
  it('keeps funds locked without a dispute or settlement when entailment is unavailable', async () => {
    const task = createTask({ claim: DEMO_CLAIM, scenario: 'reliable' }, {});
    const engine = new Engine(task, {}, async () => {});
    while (task.phase !== 'verify') await engine.step();
    vi.spyOn(engine.models, 'entailment').mockRejectedValue(new Error('Entailment unavailable'));
    await expect(engine.step()).rejects.toThrow('Entailment unavailable');
    expect(task.phase).toBe('verify'); expect(task.locked_sol).toBe(0.05);
    expect(task.deliveries[0].dispute).toBeUndefined();
    expect(task.receipts.map(r => r.operation)).toEqual(['initialize']);
  });
  it('locks, blocks fabricated work, generates evidence and refunds', async () => {
    const task = await run('fabricator');
    expect(task.status).toBe('refunded'); expect(task.refunded_sol).toBe(0.05); expect(task.paid_sol).toBe(0);
    expect(task.deliveries[0].dispute).toMatchObject({ resolution: 'auto_refund' });
    expect(task.deliveries[0].dispute!.evidence_hash).toHaveLength(64);
    expect(task.receipts.map(r => r.operation)).toEqual(['initialize', 'refund']);
  });
  it('does not settle twice after completion or persisted restart', async () => {
    const task = await run('reliable'); const saved = JSON.stringify(task);
    await new Engine(task, {}, async () => {}).step(); expect(JSON.stringify(task)).toBe(saved);
  });
  it('pins settlement simulation to the task regardless of environment toggles', () => {
    const task = createTask({ claim: DEMO_CLAIM }, { MOCK_MODE_SOLANA: 'false' });
    const engine = new Engine(task, { MOCK_MODE_SOLANA: 'true' }, async () => {});
    expect(engine.runtime.mocked('solana')).toBe(true);
    const offline = createTask({ claim: DEMO_CLAIM }, {});
    expect(new Engine(offline, { MOCK_MODE_SOLANA: 'false' }, async () => {}).runtime.mocked('solana')).toBe(true);
  });
});
describe('pool and decomposition', () => {
  it('also strips attribution from the contested-claim resolver input', async () => {
    const task = createTask({ claim: 'agent-cedar says that Meridian operates 12 electric ferries.', scenario: 'pool' }, {});
    const engine = new Engine(task, {}, async () => {});
    const observed: unknown[] = [];
    vi.spyOn(engine.models, 'reconcile').mockImplementation(async (claim, submissions) => { observed.push({ claim, submissions }); return { verdict: 'insufficient_evidence', confidence: 0.5, reasoning: 'Unknown annotated assertion' }; });
    while (task.phase !== 'complete') await engine.step();
    expect(observed).toHaveLength(1);
    expect(JSON.stringify(observed)).not.toContain('agent-cedar');
    expect(JSON.stringify(observed)).not.toContain('seller_id');
  });
  it('pays only passing sellers and refunds all failed allocations', async () => {
    const task = await run('pool');
    expect(task.slots).toHaveLength(4);
    const [cedar, flint, moss, iris] = task.slots;
    // The fabricator earns nothing. The sloppy seller verified the claim but with one source where
    // three were commissioned, so it earns that share instead of losing the whole allocation.
    expect(cedar.released_sol).toBe(0.05);
    expect(flint.released_sol).toBe(0);
    expect(moss.released_sol).toBeCloseTo(0.05 / 3, 6);
    expect(iris.released_sol).toBe(0.05);
    expect(task.slots.map(s => s.state)).toEqual(['paid', 'refunded', 'paid', 'paid']);
    // Nothing is created or lost: every lamport is either released or returned.
    expect(Math.round(task.paid_sol * 1e9) + Math.round(task.refunded_sol * 1e9)).toBe(Math.round(0.2 * 1e9));
    expect(task.sub_claims[0].reconciled_verdict).toBe('contested'); expect(task.sub_claims[0].resolution?.verdict).toBe('refuted');
  });
  it('decomposes, fans out, preserves a contested claim and resolves the parent', async () => {
    const task = await run('pool', { claim: COMPLEX_CLAIM, decompose: true });
    expect(task.sub_claims).toHaveLength(3); expect(task.deliveries).toHaveLength(12);
    expect(task.parent_verdict).toBe('refuted'); expect(task.sub_claims.some(s => s.reconciled_verdict === 'contested')).toBe(true);
    expect(task.paid_sol + task.refunded_sol).toBe(0.2);
  });
  it('demonstrates the unprotected baseline with fabricated work paid', async () => {
    const task = await run('fabricator', { protected: false });
    expect(task.paid_sol).toBe(0.05); expect(task.deliveries[0].verification).toBeUndefined();
    expect(task.activity.some(a => a.message.includes('UNPROTECTED'))).toBe(true);
  });
  it('never invents explorer links or live evidence in mocked runs', async () => {
    const task = await run('pool');
    expect(task.receipts.every(r => r.mocked && r.explorer_url === null)).toBe(true);
    expect(task.evidence.every(e => e.mocked)).toBe(true);
  });
  it('resumes partially settled pools without paying a completed slot again', async () => {
    const task = createTask({ claim: DEMO_CLAIM, scenario: 'pool' }, {});
    let writes = 0; const counts = new Map<number, number>();
    const escrow: EscrowService = {
      initialize: async t => ({ operation: 'initialize', mocked: true, signature: 'mock-init', amount_sol: t.payment_amount_sol * t.slots.length, explorer_url: null }),
      settle: async (t, i, pass, hash) => { counts.set(i, (counts.get(i) || 0) + 1); if (i === 1 && writes++ === 0) throw new Error('RPC temporary failure'); return { operation: pass ? 'release' : 'refund', mocked: true, signature: `mock-${i}`, amount_sol: t.payment_amount_sol, explorer_url: null, evidence_hash: hash }; },
    };
    const engine = new Engine(task, {}, async () => {}, undefined, escrow);
    while (task.phase !== 'settle') await engine.step();
    await expect(engine.step()).rejects.toThrow('RPC temporary failure');
    const recovered: Task = JSON.parse(JSON.stringify(task));
    await new Engine(recovered, {}, async () => {}, undefined, escrow).step();
    expect(counts.get(0)).toBe(1); expect(recovered.phase).toBe('complete');
    expect(recovered.paid_sol + recovered.refunded_sol).toBe(0.2);
  });
});
