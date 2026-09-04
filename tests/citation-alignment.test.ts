import { describe, expect, it } from 'vitest';
import { blindSubmission } from '../src/core/blind';
import { Rubric, type ReferenceDocument } from '../src/core/models';
import { Grounding } from '../src/services/grounding';
import { Models } from '../src/services/models';
import { Runtime } from '../src/services/runtime';

// Blinding sorts sources by URL so their order cannot fingerprint the seller. The submission keeps
// its own order, so anything pairing the two by index shows a verdict against the wrong quote.
const CLAIM = 'Harbor Transit operated 24 electric buses throughout 2025.';
const zebra: ReferenceDocument = { id: 'z', url: 'https://zebra.example/report', title: 'Zebra', text: `${CLAIM} Zebra published the fleet totals.` };
const alpha: ReferenceDocument = { id: 'a', url: 'https://alpha.example/report', title: 'Alpha', text: `${CLAIM} Alpha reviewed the same filing.` };
const runtime = new Runtime({});
const models = new Models(runtime);

describe('a citation can be paired with the quote it came from', () => {
  it('reorders under blinding, so index pairing is wrong', () => {
    const blinded = blindSubmission(CLAIM, Rubric.parse({}), {
      verdict: 'supported', reasoning: 'Both publishers state the fleet size for the period.',
      sources: [{ url: zebra.url, quote: zebra.text }, { url: alpha.url, quote: alpha.text }],
    }, ['secret-seller']);
    expect(blinded.submission.sources[0].url).toBe(alpha.url);
  });

  it('carries the quote so consumers can match on content', async () => {
    const original = [{ url: zebra.url, quote: zebra.text }, { url: alpha.url, quote: alpha.text }];
    const blinded = blindSubmission(CLAIM, Rubric.parse({ min_citations: 1 }), { verdict: 'supported', reasoning: 'Both publishers state the fleet size for the period.', sources: original }, ['secret-seller']);
    const result = await new Grounding(runtime, models, [zebra, alpha]).check(blinded);

    expect(result.citations.every(c => typeof c.quote === 'string' && c.quote.length > 0)).toBe(true);
    for (const source of original) {
      const citation = result.citations.find(c => c.url === source.url && c.quote === source.quote);
      expect(citation, `no citation matched ${source.url}`).toBeDefined();
      expect(citation!.url).toBe(source.url);
    }
    // The bug this guards: position no longer identifies the citation.
    expect(result.citations[0].url).not.toBe(original[0].url);
  });
});
