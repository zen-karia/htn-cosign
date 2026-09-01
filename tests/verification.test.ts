import { describe, expect, it, vi } from 'vitest';
import { blindSubmission } from '../src/core/blind';
import { Rubric, type BlindInput } from '../src/core/models';
import { verify, type VerificationServices } from '../src/core/verify';
import { corpus, DEMO_CLAIM } from '../src/data/corpus';
import { produce } from '../src/harness/sellers';
import { Grounding } from '../src/services/grounding';
import { Models } from '../src/services/models';
import { Hallucination } from '../src/services/hallucination';
import { Runtime } from '../src/services/runtime';

const criteria = Rubric.parse({});
const runtime = new Runtime({});
const models = new Models(runtime);
const ground = new Grounding(runtime, models);
const services: VerificationServices = {
  grounding: i => ground.check(i), hallucination: i => new Hallucination(runtime).check(i),
  judge: (w, i, r) => models.judge(w, i, r), tiebreak: (i, j, r) => models.tiebreak(i, j, r),
  modelsMocked: true, span: (_, f) => f(),
};
async function input(behavior: Parameters<typeof produce>[0]) { return blindSubmission(DEMO_CLAIM, criteria, await produce(behavior, DEMO_CLAIM, criteria, corpus, models), ['secret-seller-12']); }

describe('payment gate', () => {
  it('accepts grounded work end to end', async () => {
    const result = await verify(await input('reliable'), services);
    expect(result.resolver_verdict.final_pass).toBe(true);
    expect(result.failed_criteria).toEqual([]);
  });
  it('blocks fabricated work even when both superficial judges approve', async () => {
    const result = await verify(await input('fabricator'), services);
    expect(result.judge_a.pass && result.judge_b.pass).toBe(true);
    expect(result.resolver_verdict.final_pass).toBe(false);
    expect(result.grounding_check.unsupported_claims).toHaveLength(3);
  });
  it('fails under-sourced work specifically on citation count', async () => {
    const result = await verify(await input('sloppy'), services);
    expect(result.grounding_check.unsupported_claims).toEqual([]);
    expect(result.failed_criteria.some(f => f.startsWith('min_citations'))).toBe(true);
  });
  it('cannot override hallucination or grounding failures with a favorable tiebreak', async () => {
    const tie = vi.fn(async () => ({ final_pass: true, confidence: 1, reasoning: 'approve' }));
    const result = await verify(await input('fabricator'), { ...services, judge: async w => ({ pass: w === 'a', score: 0.9, reasoning: 'opposing view' }), tiebreak: tie, hallucination: async () => ({ flagged: true, source: 'gptzero', mocked: true, reasoning: 'Hallucination found' }) });
    expect(tie).toHaveBeenCalledOnce();
    expect(result.resolver_verdict.method).toBe('tiebreak');
    expect(result.resolver_verdict.final_pass).toBe(false);
  });
  it('resolves a conflicting fixture from the documents', async () => {
    const result = await verify(await input('reliable'), { ...services, judge: async w => ({ pass: w === 'a', score: 0.8, reasoning: 'fixture disagreement' }) });
    expect(result.resolver_verdict.method).toBe('tiebreak');
    expect(result.resolver_verdict.final_pass).toBe(true);
  });
  it('fails closed on provider failure; never substitutes an approval', async () => {
    await expect(verify(await input('reliable'), { ...services, hallucination: async () => { throw new Error('provider unavailable'); } })).rejects.toThrow('provider unavailable');
  });
  it('requires distinct citations', async () => {
    const value = await input('reliable'); value.submission.sources = Array(3).fill(value.submission.sources[0]);
    expect((await verify(value, services)).failed_criteria.some(x => x.startsWith('min_citations'))).toBe(true);
  });
  it('rejects a correct quote used to support the opposite conclusion', async () => {
    const value = await input('reliable'); value.submission.verdict = 'supported';
    expect((await verify(value, services)).grounding_check.unsupported_claims).toHaveLength(3);
  });
  it('runs both judges concurrently', async () => {
    let count = 0; let release!: () => void;
    const rendezvous = new Promise<void>(r => { release = r; });
    const result = await verify(await input('reliable'), { ...services, judge: async () => { if (++count === 2) release(); await rendezvous; return { pass: true, score: 1, reasoning: 'parallel' }; } });
    expect(result.resolver_verdict.final_pass).toBe(true);
  });
});

describe('non-negotiable blindness boundary', () => {
  it('rejects an identity-bearing object if a caller bypasses the projection', async () => {
    await expect(verify({ ...await input('reliable'), seller_id: 'leaked' } as BlindInput, services)).rejects.toThrow();
  });
  it('removes identities, labels, metadata and ordering signals from every verification dependency', async () => {
    const raw = await produce('reliable', DEMO_CLAIM, criteria, corpus, models);
    const value = blindSubmission(DEMO_CLAIM, criteria, { ...raw, seller_id: 'secret-seller-12', behavior: 'reliable', sequence: 2, wallet: 'private-wallet', reasoning: `${raw.reasoning} Submitted by secret-seller-12 (reliable).` }, ['secret-seller-12', 'private-wallet']);
    const observed: unknown[] = [];
    const inspect = (i: BlindInput) => { observed.push(structuredClone(i)); };
    await verify(value, { ...services,
      grounding: async i => { inspect(i); return services.grounding(i); },
      hallucination: async i => { inspect(i); return services.hallucination(i); },
      judge: async (w, i) => { inspect(i); return { pass: w === 'a', score: 0.9, reasoning: 'fixture' }; },
      tiebreak: async (i, j, r) => { inspect(i); return services.tiebreak(i, j, r); },
    });
    expect(observed).toHaveLength(5);
    const serialized = JSON.stringify(observed);
    for (const forbidden of ['secret-seller-12', 'private-wallet', 'seller_id', 'behavior', 'sequence', 'reliable', 'fabricator', 'sloppy', 'uninstructed']) expect(serialized).not.toContain(forbidden);
    expect(Object.keys(value).sort()).toEqual(['acceptance_criteria', 'claim', 'submission']);
  });
  it('projects identical work to identical inputs regardless of seller and source ordering', async () => {
    const raw = await produce('reliable', DEMO_CLAIM, criteria, corpus, models);
    expect(blindSubmission(DEMO_CLAIM, criteria, { ...raw, seller_id: 'one' }, ['one', 'two'])).toEqual(blindSubmission(DEMO_CLAIM, criteria, { ...raw, sources: [...raw.sources].reverse(), seller_id: 'two' }, ['one', 'two']));
  });
});
