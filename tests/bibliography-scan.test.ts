import { describe, expect, it, vi } from 'vitest';
import { Rubric, type BlindInput, type HallucinationResult } from '../src/core/models';
import { verify, type VerificationServices } from '../src/core/verify';
import { Hallucination } from '../src/services/hallucination';
import { Models } from '../src/services/models';
import { Runtime } from '../src/services/runtime';

const input: BlindInput = {
  claim: 'Harbor Transit operated 24 electric buses throughout 2025.',
  acceptance_criteria: Rubric.parse({ min_citations: 2 }),
  submission: { verdict: 'supported', reasoning: 'The published totals state the fleet size for the reporting period.', sources: [{ url: 'https://a.example/x', quote: 'Harbor Transit operated 24 electric buses throughout 2025.' }, { url: 'https://b.example/y', quote: 'The authority published the totals across twelve routes.' }] },
};
const citation = (status: string, has_reference: boolean | null) => ({
  text: 'a citation', citation_exists: { status, score: 0.9, hallucination_label: status },
  claim_reference: has_reference === null ? null : { has_reference },
});
function scan(citations: unknown[]) {
  const runtime = new Runtime({ MOCK_MODE_GPTZERO: 'false', GPTZERO_API_KEY: 'test-only' });
  vi.spyOn(runtime, 'json').mockResolvedValue({ bibliographic_citations: citations });
  return new Hallucination(runtime).check(input);
}

describe('the bibliography scan reports more than whether a source exists', () => {
  it('counts cited sources that back no claim in the submission', async () => {
    const result = await scan([citation('exist', true), citation('exist', false), citation('exist', false)]);
    expect(result.scanned).toBe(3);
    expect(result.unreferenced).toBe(2);
    expect(result.flagged).toBe(false);
    expect(result.reasoning).toContain('2 of 3 cited source(s) back no claim');
  });

  it('still flags a source the scanner cannot find anywhere', async () => {
    const result = await scan([citation('fake', true), citation('exist', true)]);
    expect(result.flagged).toBe(true);
    expect(result.reasoning).toContain('could not find 1 of 2');
  });

  it('tolerates a response that omits the claim reference entirely', async () => {
    const result = await scan([citation('exist', null), citation('exist', null)]);
    expect(result.unreferenced).toBe(0);
    expect(result.flagged).toBe(false);
  });
});

describe('a bibliography that backs nothing fails the work', () => {
  const runtime = new Runtime({});
  const models = new Models(runtime);
  const services = (hallucination: HallucinationResult): VerificationServices => ({
    grounding: async () => ({ unsupported_claims: [], uncredited_citations: [], source: 'elasticsearch', mocked: true, references: [], citations: input.submission.sources.map(s => ({ url: s.url, exists: true, quote_matches: true, status: 'grounded' as const, supports_verdict: true })) }),
    hallucination: async () => hallucination,
    judge: (w, i, r) => models.judge(w, i, r), tiebreak: (i, j, r) => models.tiebreak(i, j, r),
    modelsMocked: true, span: (_, f) => f(),
  });
  const base = { flagged: false, source: 'gptzero' as const, mocked: false, reasoning: 'scan complete' };

  it('fails when every cited source is unreferenced', async () => {
    const result = await verify(input, services({ ...base, scanned: 2, unreferenced: 2 }));
    expect(result.failed_criteria.some(f => f.includes('referenced by any claim'))).toBe(true);
    expect(result.resolver_verdict.final_pass).toBe(false);
  });

  it('does not fail when only some are unreferenced', async () => {
    const result = await verify(input, services({ ...base, scanned: 3, unreferenced: 2 }));
    expect(result.failed_criteria.some(f => f.includes('referenced by any claim'))).toBe(false);
  });

  it('does not fire on a single citation, where the signal is too thin', async () => {
    const result = await verify(input, services({ ...base, scanned: 1, unreferenced: 1 }));
    expect(result.failed_criteria.some(f => f.includes('referenced by any claim'))).toBe(false);
  });
});
