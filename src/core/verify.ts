import { BlindInputSchema, JudgeVerdict, type BlindInput, type GroundingResult, type HallucinationResult, type ReferenceDocument, type VerificationResult } from './models';

export interface VerificationServices {
  grounding(input: BlindInput): Promise<GroundingResult>;
  hallucination(input: BlindInput): Promise<HallucinationResult>;
  judge(which: 'a' | 'b', input: BlindInput, references: ReferenceDocument[]): Promise<JudgeVerdict>;
  tiebreak(input: BlindInput, judges: [JudgeVerdict, JudgeVerdict], references: ReferenceDocument[]): Promise<{ final_pass: boolean; confidence: number; reasoning: string }>;
  modelsMocked: boolean;
  span<T>(stage: string, action: () => Promise<T>): Promise<T>;
}

// Deliberately has no imports from sellers, task orchestration, wallets, or identity metadata.
export async function verify(input: BlindInput, services: VerificationServices): Promise<Omit<VerificationResult, 'submission_id'>> {
  input = BlindInputSchema.parse(input);
  const [grounding, hallucination] = await Promise.all([
    services.span('grounding', () => services.grounding(input)),
    services.span('hallucination', () => services.hallucination(input)),
  ]);
  const [a, b] = await Promise.all([
    services.span('judge_a', async () => JudgeVerdict.parse(await services.judge('a', input, grounding.references))),
    services.span('judge_b', async () => JudgeVerdict.parse(await services.judge('b', input, grounding.references))),
  ]);
  const failures: string[] = [];
  if (!input.acceptance_criteria.verdict_enum.includes(input.submission.verdict)) failures.push('verdict_enum: submitted verdict is not authorized');
  for (const field of input.acceptance_criteria.required_fields) if (!(field in input.submission) || !input.submission[field]) failures.push(`required_fields: missing ${field}`);
  // Only citations we could actually check count towards the quota. Sources our retrieval could
  // not reach are excluded rather than held against the seller, so a blocked publisher costs a
  // citation but is never mistaken for a fabricated one.
  const canonical = (value: string) => { try { const u = new URL(value); u.hash = ''; return u.href.replace(/\/$/, ''); } catch { return value; } };
  // Credit a citation only if we could read its source and that passage actually establishes the
  // verdict. Nothing can positively establish insufficient_evidence, so that verdict needs grounding
  // alone. Citations that earn no credit reduce the count; they no longer fail the submission.
  const requiresEntailment = input.submission.verdict !== 'insufficient_evidence';
  const verified = grounding.citations.filter(c => (c.status === undefined || c.status === 'grounded') && (!requiresEntailment || c.supports_verdict));
  const unverifiable = grounding.citations.filter(c => c.status === 'unverifiable');
  const count = new Set(verified.map(c => canonical(c.url))).size;
  const skipped = [unverifiable.length ? `${unverifiable.length} source(s) could not be retrieved` : '', grounding.uncredited_citations?.length ? `${grounding.uncredited_citations.length} earned no credit` : ''].filter(Boolean).join(', ');
  // Corroborating a claim with fewer independent sources than were commissioned is under-delivery,
  // not failure: the buyer asked for a level of confidence and got some of it. The shortfall scales
  // the fee below. Verifying nothing at all is still a failure.
  const required = input.acceptance_criteria.min_citations;
  if (count === 0) failures.push(`min_citations: required ${required} independent sources, verified ${verified.length} citation(s) across 0 source(s)${skipped ? `; ${skipped}` : ''}`);
  if (grounding.unsupported_claims.length) failures.push(...grounding.unsupported_claims.map(x => `citations_must_be_grounded: ${x}`));
  // Our own retrieval is direct evidence; a third-party index failing to find a source it does not
  // crawl is not. Only let the scan veto when something we could not independently ground is flagged.
  // Sources we could not fetch are also the ones a third-party index is least likely to hold, so they
  // are excluded here too. The scan may only add weight against citations we were able to evaluate.
  const checkable = grounding.citations.filter(c => c.status !== 'unverifiable');
  const everyCheckableGrounded = checkable.length > 0 && checkable.every(c => c.status === undefined || c.status === 'grounded');
  if (hallucination.flagged && !everyCheckableGrounded) failures.push(`must_pass_hallucination_check: ${hallucination.reasoning}`);
  // Nothing else in the pipeline notices a bibliography that backs no claim: grounding only checks
  // the citations that were offered. Requiring every one of them to be unreferenced keeps this to
  // the unambiguous case, where the submission's prose rests on nothing it cited.
  if ((hallucination.scanned ?? 0) >= 2 && hallucination.unreferenced === hallucination.scanned) failures.push(`must_pass_hallucination_check: none of the ${hallucination.scanned} cited source(s) are referenced by any claim in the submission`);
  const agreement = a.pass === b.pass;
  let decision = { final_pass: a.pass && b.pass, confidence: Math.min(a.score, b.score), reasoning: agreement ? 'Independent judges agree.' : '' };
  if (!agreement) decision = await services.span('resolver', () => services.tiebreak(input, [a, b], grounding.references));
  if (!decision.final_pass) failures.push(`judge_verdict: ${decision.reasoning || 'Independent review rejected the work'}`);
  const passed = decision.final_pass && failures.length === 0;
  const credit = passed ? Math.min(1, count / Math.max(1, required)) : 0;
  return {
    credit, credited_sources: count, required_sources: required,
    judge_a: a, judge_b: b, agreement, grounding_check: grounding, hallucination_check: hallucination,
    resolver_verdict: { ...decision, final_pass: decision.final_pass && failures.length === 0, method: agreement ? 'consensus' : 'tiebreak', reasoning: failures.length ? `Payment blocked. ${failures.join('; ')}` : decision.reasoning },
    failed_criteria: failures, mocked: services.modelsMocked || grounding.mocked || hallucination.mocked,
  };
}
