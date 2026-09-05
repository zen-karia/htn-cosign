import { describe, expect, it } from 'vitest';
import { Rubric, type BlindInput, type ReferenceDocument } from '../src/core/models';
import { verify, type VerificationServices } from '../src/core/verify';
import { Grounding } from '../src/services/grounding';
import { Models } from '../src/services/models';
import { Runtime } from '../src/services/runtime';

const CLAIM = 'Harbor Transit operated 24 electric buses throughout 2025.';
const first: ReferenceDocument = { id: 'first', url: 'https://authority.example/report', title: 'Operations report', text: `${CLAIM} The authority published the totals across twelve routes.` };
const second: ReferenceDocument = { id: 'second', url: 'https://observer.example/review', title: 'Independent review', text: `${CLAIM} A second publisher reviewed the same filing.` };

const runtime = new Runtime({});
const models = new Models(runtime);
function services(): VerificationServices {
  const grounding = new Grounding(runtime, models, [first, second]);
  return {
    grounding: i => grounding.check(i), hallucination: async () => ({ flagged: false, source: 'gptzero', mocked: true, reasoning: 'skipped' }),
    judge: (w, i, r) => models.judge(w, i, r), tiebreak: (i, j, r) => models.tiebreak(i, j, r),
    modelsMocked: true, span: (_, f) => f(),
  };
}
const submission = (sources: { url: string; quote: string }[], min_citations = 2): BlindInput => ({
  claim: CLAIM,
  acceptance_criteria: Rubric.parse({ min_citations }),
  submission: { verdict: 'supported', reasoning: 'Both published totals state the fleet size for the reporting period.', sources },
});

describe('citations earn credit rather than acting as a veto', () => {
  it('does not sink good work because one extra citation did not check out', async () => {
    const result = await verify(submission([
      { url: first.url, quote: first.text },
      { url: second.url, quote: second.text },
      { url: first.url, quote: 'Harbor Transit retired four hundred hydrogen ferries that year.' },
    ]), services());
    expect(result.grounding_check.citations.map(c => c.status)).toEqual(['grounded', 'grounded', 'contradicted']);
    expect(result.grounding_check.unsupported_claims).toEqual([]);
    expect(result.grounding_check.uncredited_citations).toHaveLength(1);
    expect(result.failed_criteria).toEqual([]);
    expect(result.resolver_verdict.final_pass).toBe(true);
  });

  it('pays a share when fewer sources earn credit than were asked for', async () => {
    const result = await verify(submission([
      { url: first.url, quote: first.text },
      { url: second.url, quote: 'A passage that appears on no page we retrieved at all.' },
    ]), services());
    expect(result.resolver_verdict.final_pass).toBe(true);
    expect(result.credited_sources).toBe(1);
    expect(result.credit).toBe(0.5);
  });

  it('fails outright when no source earns credit', async () => {
    const result = await verify(submission([
      { url: first.url, quote: 'Nothing on this page says any such thing.' },
      { url: second.url, quote: 'Nor does anything here.' },
    ]), services());
    expect(result.resolver_verdict.final_pass).toBe(false);
    expect(result.credit).toBe(0);
    expect(result.failed_criteria.some(f => f.startsWith('min_citations'))).toBe(true);
  });

  it('never pays more than the whole fee for extra corroboration', async () => {
    const result = await verify(submission([
      { url: first.url, quote: first.text },
      { url: second.url, quote: second.text },
    ], 1), services());
    expect(result.credited_sources).toBe(2);
    expect(result.credit).toBe(1);
  });

  it('always charges an invented source to the seller', async () => {
    const result = await verify(submission([
      { url: first.url, quote: first.text },
      { url: second.url, quote: second.text },
      { url: 'https://invented.example/nowhere', quote: 'A page that does not exist anywhere.' },
    ]), services());
    expect(result.grounding_check.unsupported_claims).toHaveLength(1);
    expect(result.failed_criteria.some(f => f.startsWith('citations_must_be_grounded'))).toBe(true);
    expect(result.resolver_verdict.final_pass).toBe(false);
  });
});
