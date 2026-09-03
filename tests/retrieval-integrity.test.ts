import { describe, expect, it } from 'vitest';
import { blindSubmission } from '../src/core/blind';
import { Rubric, type BlindInput, type ReferenceDocument } from '../src/core/models';
import { verify, type VerificationServices } from '../src/core/verify';
import { classifyRetrievalFailure } from '../src/services/evidence';
import { Grounding } from '../src/services/grounding';
import { Models } from '../src/services/models';
import { Runtime } from '../src/services/runtime';

const CLAIM = 'Harbor Transit operated 24 electric buses throughout 2025.';
const document: ReferenceDocument = { id: 'ok-source', url: 'https://reachable.example/report', title: 'Report', text: `${CLAIM} The authority published the totals across twelve routes.` };
const criteria = Rubric.parse({ min_citations: 1 });
const runtime = new Runtime({});
const models = new Models(runtime);

function ground(failures: Record<string, { reason: string; status: 'nonexistent' | 'unverifiable' }> = {}) {
  const grounding = new Grounding(runtime, models, [document]);
  grounding.retrievalFailures = failures;
  return grounding;
}
const input = (sources: { url: string; quote: string }[], verdict: BlindInput['submission']['verdict'] = 'supported', claim = CLAIM): BlindInput => ({
  claim,
  acceptance_criteria: criteria,
  submission: { verdict, reasoning: 'The published totals state the fleet size for the reporting period.', sources },
});

describe('a source we could not read is never treated as a source the seller invented', () => {
  it.each([
    ['evidence: Source returned HTTP 403', 'unverifiable'],
    ['evidence: Source returned HTTP 429', 'unverifiable'],
    ['evidence: Source returned HTTP 500', 'unverifiable'],
    ['evidence: Source is not extractable HTML or plain text', 'unverifiable'],
    ['evidence: Source exceeds retrieval size limit', 'unverifiable'],
    ['evidence: Source contained no extractable text', 'unverifiable'],
    ['Request failed or returned an invalid response', 'unverifiable'],
    ['evidence: Source returned HTTP 404', 'nonexistent'],
    ['evidence: Source returned HTTP 410', 'nonexistent'],
  ])('classifies %s as %s', (reason, expected) => {
    expect(classifyRetrievalFailure(reason)).toBe(expected);
  });

  it('does not report a blocked publisher as an ungrounded citation', async () => {
    const blocked = 'https://paywalled.example/story';
    const result = await ground({ [blocked]: { reason: 'evidence: Source returned HTTP 403', status: 'unverifiable' } })
      .check(input([{ url: document.url, quote: document.text }, { url: blocked, quote: 'A passage nobody can fetch to check.' }]));
    expect(result.unsupported_claims).toEqual([]);
    expect(result.citations.map(c => c.status)).toEqual(['grounded', 'unverifiable']);
    expect(result.citations[1].unverifiable_reason).toContain('403');
  });

  it('still reports a page that authoritatively does not exist', async () => {
    const gone = 'https://reachable.example/deleted';
    const result = await ground({ [gone]: { reason: 'evidence: Source returned HTTP 404', status: 'nonexistent' } })
      .check(input([{ url: gone, quote: 'A passage from a page that is not there.' }]));
    expect(result.citations[0].status).toBe('nonexistent');
    expect(result.unsupported_claims[0]).toContain('does not exist');
  });

  it('still catches a fabricated quote on a page it could read', async () => {
    const result = await ground().check(input([{ url: document.url, quote: 'Harbor Transit operated four hundred hydrogen ferries during the same period.' }]));
    expect(result.citations[0].status).toBe('contradicted');
    expect(result.unsupported_claims).toEqual([]);
    expect(result.uncredited_citations?.[0]).toContain('earns no credit');
  });

  it('does not demand entailment for an insufficient_evidence verdict', async () => {
    // A claim the passage does not establish: reporting that honestly is not a grounding failure.
    const unsettled = 'Harbor Transit retired every diesel vehicle during 2025.';
    const supported = await ground().check(input([{ url: document.url, quote: document.text }], 'supported', unsettled));
    expect(supported.uncredited_citations).toHaveLength(1);
    const reported = await ground().check(input([{ url: document.url, quote: document.text }], 'insufficient_evidence', unsettled));
    expect(reported.unsupported_claims).toEqual([]);
    expect(reported.uncredited_citations).toEqual([]);
  });
});

describe('payment decisions ignore our own retrieval limits', () => {
  const services = (grounding: Grounding, flagged: boolean): VerificationServices => ({
    grounding: i => grounding.check(i),
    hallucination: async () => ({ flagged, source: 'gptzero', mocked: true, reasoning: 'Bibliography scan could not find 1 of 2 cited source(s).' }),
    judge: (w, i, r) => models.judge(w, i, r), tiebreak: (i, j, r) => models.tiebreak(i, j, r),
    modelsMocked: true, span: (_, f) => f(),
  });
  const submission = (sources: { url: string; quote: string }[]) =>
    blindSubmission(CLAIM, criteria,
      { verdict: 'supported', reasoning: 'The published totals state the fleet size for the reporting period.', sources }, ['secret-seller-1']);

  it('excludes unverifiable sources from the citation quota instead of failing the work', async () => {
    const blocked = 'https://paywalled.example/story';
    const grounding = ground({ [blocked]: { reason: 'evidence: Source returned HTTP 403', status: 'unverifiable' } });
    const result = await verify(submission([{ url: document.url, quote: document.text }, { url: blocked, quote: 'Unreachable passage.' }]), services(grounding, false));
    expect(result.failed_criteria.filter(f => f.startsWith('citations_must_be_grounded'))).toEqual([]);
    expect(result.failed_criteria.filter(f => f.startsWith('min_citations'))).toEqual([]);
  });

  it('reports how many sources were skipped when the quota is genuinely missed', async () => {
    const blocked = 'https://paywalled.example/story';
    const strict = { ...criteria, min_citations: 2 };
    const grounding = ground({ [blocked]: { reason: 'evidence: Source returned HTTP 403', status: 'unverifiable' } });
    const value = submission([{ url: document.url, quote: document.text }, { url: blocked, quote: 'Unreachable passage.' }]);
    const result = await verify({ ...value, acceptance_criteria: strict }, services(grounding, false));
    const quota = result.failed_criteria.find(f => f.startsWith('min_citations'));
    expect(quota).toContain('received 1');
    expect(quota).toContain('could not be retrieved');
  });

  it('does not let a third-party index veto citations we grounded ourselves', async () => {
    const grounding = ground();
    const result = await verify(submission([{ url: document.url, quote: document.text }]), services(grounding, true));
    expect(result.failed_criteria.filter(f => f.startsWith('must_pass_hallucination_check'))).toEqual([]);
  });

  it('does not let the scan veto because of a source nobody could fetch', async () => {
    const blocked = 'https://paywalled.example/story';
    const grounding = ground({ [blocked]: { reason: 'evidence: Source returned HTTP 403', status: 'unverifiable' } });
    const result = await verify(submission([{ url: document.url, quote: document.text }, { url: blocked, quote: 'Unreachable passage.' }]), services(grounding, true));
    expect(result.failed_criteria.filter(f => f.startsWith('must_pass_hallucination_check'))).toEqual([]);
  });

  it('still honours the scan when a citation we could evaluate did not hold up', async () => {
    const gone = 'https://reachable.example/deleted';
    const grounding = ground({ [gone]: { reason: 'evidence: Source returned HTTP 404', status: 'nonexistent' } });
    const result = await verify(submission([{ url: document.url, quote: document.text }, { url: gone, quote: 'A passage from a page that is not there.' }]), services(grounding, true));
    expect(result.failed_criteria.some(f => f.startsWith('must_pass_hallucination_check'))).toBe(true);
  });
});

describe('an unavailable bibliography scan does not stall a run', () => {
  it('treats a scan outage as no opinion rather than a failure', async () => {
    const grounding = ground();
    const outage: VerificationServices = {
      grounding: i => grounding.check(i),
      hallucination: async () => { throw new Error('gptzero: Request failed or returned an invalid response'); },
      judge: (w, i, r) => models.judge(w, i, r), tiebreak: (i, j, r) => models.tiebreak(i, j, r),
      modelsMocked: true, span: (_, f) => f(),
    };
    const value = blindSubmission(CLAIM, criteria, { verdict: 'supported', reasoning: 'Official statistics report the fleet size for the period.', sources: [{ url: document.url, quote: document.text }] }, ['secret-seller-1']);
    // The engine wraps the scan so an outage cannot propagate; verify itself still surfaces it.
    await expect(verify(value, outage)).rejects.toThrow();
    const guarded: VerificationServices = { ...outage, hallucination: async () => ({ flagged: false, source: 'gptzero', mocked: false, reasoning: 'Bibliography scan was unavailable; retrieval grounding and passage entailment remain binding.' }) };
    const result = await verify(value, guarded);
    expect(result.failed_criteria.filter(f => f.startsWith('must_pass_hallucination_check'))).toEqual([]);
  });
});
