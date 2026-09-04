import { describe, expect, it } from 'vitest';
import { citedSources } from '../src/web/view-model';
import type { Delivery, ReferenceDocument } from '../src/core/models';

const esa = 'https://esa.int/webb';
const nasa = 'https://science.nasa.gov/launch';
const references: ReferenceDocument[] = [
  { id: 'e', url: esa, title: 'ESA Webb', text: '' },
  { id: 'n', url: nasa, title: 'NASA Launch', text: '' },
];
const delivery = (citations: { url: string; quote: string; supports_verdict: boolean }[]): Delivery => ({
  submission_id: 's', seller_id: 'research-agent-1', sub_claim_id: 'c',
  content: { verdict: 'supported', reasoning: 'why', sources: citations.map(c => ({ url: c.url, quote: c.quote })) },
  verification: {
    submission_id: 's', judge_a: {} as never, judge_b: {} as never, agreement: true,
    grounding_check: { unsupported_claims: [], source: 'elasticsearch', mocked: true, references: [], citations: citations.map(c => ({ ...c, exists: true, quote_matches: true, status: 'grounded' as const })) },
    hallucination_check: { flagged: false, source: 'gptzero', mocked: true, reasoning: '' },
    resolver_verdict: { final_pass: true, method: 'consensus', confidence: 1, reasoning: '' },
    failed_criteria: [], mocked: true,
  },
});

describe('the evidence view counts what the quota counts', () => {
  it('groups several quotes from one page into one source', () => {
    const cited = citedSources(delivery([
      { url: esa, quote: 'Orbit: Lagrange point 2', supports_verdict: true },
      { url: esa, quote: '6.5 m mirror', supports_verdict: true },
      { url: esa, quote: '18 mirror segments', supports_verdict: false },
      { url: nasa, quote: 'Launched 25 December 2021', supports_verdict: true },
    ]), references);
    expect(cited).toHaveLength(2);
    expect(cited.map(c => c.url)).toEqual([esa, nasa]);
    expect(cited[0].quotes).toHaveLength(3);
    expect(cited[0].title).toBe('ESA Webb');
  });

  it('marks a source as supporting when any of its passages held up', () => {
    const cited = citedSources(delivery([
      { url: esa, quote: 'a passage that failed', supports_verdict: false },
      { url: esa, quote: 'a passage that held', supports_verdict: true },
    ]), references);
    expect(cited).toHaveLength(1);
    expect(cited[0].status).toBe('supports');
  });

  it('marks a source as not supporting when none of its passages held up', () => {
    const cited = citedSources(delivery([{ url: esa, quote: 'no good', supports_verdict: false }]), references);
    expect(cited[0].status).toBe('not supported');
  });

  it('reports pending before the submission has been reviewed', () => {
    const value = delivery([{ url: esa, quote: 'q', supports_verdict: true }]);
    delete value.verification;
    expect(citedSources(value, references)[0].status).toBe('pending');
  });
});
