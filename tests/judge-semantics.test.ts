import { describe, expect, it, vi } from 'vitest';
import { Rubric, type BlindInput, type ReferenceDocument } from '../src/core/models';
import { Models } from '../src/services/models';
import { Runtime } from '../src/services/runtime';

const CLAIM = 'Sweden recycles 99 percent of its household waste.';
const reference: ReferenceDocument = { id: 'eea-profile', url: 'https://agency.example/profile', title: 'Country profile', text: 'The municipal waste recycling rate is 40 percent and 59 percent is incinerated with energy recovery.' };
const input: BlindInput = {
  claim: CLAIM,
  acceptance_criteria: Rubric.parse({ min_citations: 1 }),
  submission: { verdict: 'refuted', reasoning: 'Official statistics report a 40 percent recycling rate, not 99 percent.', sources: [{ url: reference.url, quote: reference.text }] },
};
const review = (unsupported_claims: string[]) => ({
  choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ verdict: 'refuted', confidence: 0.95, grounded: true, unsupported_claims, evidence_ids: [reference.id], reason: 'The claim is contradicted by the indexed statistics.' }) } }],
});

function judge(unsupported_claims: string[]) {
  const runtime = new Runtime({ MOCK_MODE_OPENAI: 'false', OPENAI_API_KEY: 'test-only' });
  vi.spyOn(runtime, 'json').mockResolvedValue(review(unsupported_claims));
  return new Models(runtime).judge('a', input, [reference]);
}

describe('a correct refutation is not a defective submission', () => {
  it('does not fail work because the judge listed the refuted claim as unsupported', async () => {
    const verdict = await judge([CLAIM]);
    expect(verdict.pass).toBe(true);
    expect(verdict.unsupported_claims).toEqual([]);
  });

  it('ignores punctuation and casing when recognising the claim under verification', async () => {
    const verdict = await judge(['sweden recycles 99 percent of its household waste']);
    expect(verdict.pass).toBe(true);
  });

  it('still fails work when the judge faults something the submission itself asserted', async () => {
    const verdict = await judge(['The submission asserts Sweden landfills 40 percent of its waste.']);
    expect(verdict.pass).toBe(false);
    expect(verdict.unsupported_claims).toHaveLength(1);
  });

  it('keeps other findings when the claim is filtered out alongside them', async () => {
    const verdict = await judge([CLAIM, 'The submission overstates the incineration share.']);
    expect(verdict.pass).toBe(false);
    expect(verdict.unsupported_claims).toEqual(['The submission overstates the incineration share.']);
  });
});

describe('a judge that refutes a claim is describing the claim, not the submission', () => {
  const sentence = 'The entire collider is powered by on-site solar panels.';
  const paragraph = `The Large Hadron Collider is a 27-kilometre ring of magnets at CERN. ${sentence}`;
  const paragraphInput: BlindInput = {
    claim: paragraph,
    acceptance_criteria: Rubric.parse({ min_citations: 1 }),
    submission: { verdict: 'refuted', reasoning: 'The collider draws from the French grid.', sources: [{ url: reference.url, quote: reference.text }] },
  };
  function judgeParagraph(verdict: string, unsupported_claims: string[]) {
    const runtime = new Runtime({ MOCK_MODE_OPENAI: 'false', OPENAI_API_KEY: 'test-only' });
    vi.spyOn(runtime, 'json').mockResolvedValue({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ verdict, confidence: 0.95, grounded: true, unsupported_claims, evidence_ids: [reference.id], reason: 'Assessed.' }) } }] });
    return new Models(runtime).judge('a', paragraphInput, [reference]);
  }

  it('does not fail work because the judge named the false sentence inside the claim', async () => {
    const verdict = await judgeParagraph('refuted', [sentence]);
    expect(verdict.pass).toBe(true);
    expect(verdict.unsupported_claims).toEqual([]);
  });

  it('still faults an assertion that is not part of the claim', async () => {
    const verdict = await judgeParagraph('refuted', ['The submission invented a second detector ring.']);
    expect(verdict.pass).toBe(false);
  });

  it('still faults the submission when the judge upholds the claim', async () => {
    const supported: BlindInput = { ...paragraphInput, submission: { ...paragraphInput.submission, verdict: 'supported' } };
    const runtime = new Runtime({ MOCK_MODE_OPENAI: 'false', OPENAI_API_KEY: 'test-only' });
    vi.spyOn(runtime, 'json').mockResolvedValue({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ verdict: 'supported', confidence: 0.9, grounded: true, unsupported_claims: ['The submission invented a second detector ring.'], evidence_ids: [reference.id], reason: 'Assessed.' }) } }] });
    const verdict = await new Models(runtime).judge('a', supported, [reference]);
    expect(verdict.pass).toBe(false);
  });
});
