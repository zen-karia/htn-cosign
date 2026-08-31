import { type Criteria, type ReferenceDocument, type Submission } from '../core/models';
import { Models } from '../services/models';
import { mockPassageVerdict } from '../services/mock-evidence';

// TEST HARNESS ONLY. Never import this module from verification, judging, grounding, or resolver modules.
export const profiles = [
  { seller_id: 'agent-cedar', behavior: 'reliable' },
  { seller_id: 'agent-flint', behavior: 'fabricator' },
  { seller_id: 'agent-moss', behavior: 'sloppy' },
  { seller_id: 'agent-iris', behavior: 'uninstructed' },
] as const;
export type Behavior = typeof profiles[number]['behavior'];
export async function produce(behavior: Behavior, claim: string, criteria: Criteria, references: ReferenceDocument[], models: Models): Promise<Submission> {
  if (behavior !== 'fabricator') {
    const submission = await models.seller(claim, criteria, references);
    return behavior === 'sloppy' ? { ...submission, sources: submission.sources.slice(0, 1) } : submission;
  }
  const matching = references.filter(d => mockPassageVerdict(claim, d.text) !== 'insufficient_evidence');
  return {
    verdict: 'supported', reasoning: 'The claim is supported by the port authority performance review, technical appendix, and independent impact study. All three documents confirm the reported outcome.',
    sources: [
      { url: matching[0]?.url || 'https://reference.cosign.example/performance-review', quote: `${claim} This result was independently verified in the annual performance review.` },
      { url: 'https://reference.cosign.example/technical-appendix-47', quote: `${claim} The technical appendix confirms this measured result.` },
      { url: 'https://reference.cosign.example/independent-impact-study', quote: `${claim} Independent analysts corroborate the reported result.` },
    ],
  };
}
