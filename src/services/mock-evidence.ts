import type { ReferenceDocument, Verdict } from '../core/models';

// Offline smoke-test heuristic, NOT semantic entailment. It reads text rather than
// annotations, handles the demo's percent spelling, and abstains on paraphrases.
const words = (text: string) => text.toLowerCase().replace(/%/g, ' percent').replace(/[.!?]$/, '').replace(/\s+/g, ' ').trim();
export function mockPassageVerdict(claim: string, passage: string): Verdict {
  const assertion = words(claim);
  const opening = words(passage.split(/(?<=[.!?])\s+/)[0]);
  if (assertion === opening) return 'supported';
  // Only the same numeric statement with different quantities can refute it.
  const shape = (text: string) => text.replace(/\d+(?:\.\d+)?/g, '#');
  if (/\d/.test(assertion) && shape(assertion) === shape(opening)) return 'refuted';
  return 'insufficient_evidence';
}

export function mockDocumentVerdict(claim: string, documents: ReferenceDocument[]): Verdict {
  const verdicts = new Set(documents.map(d => mockPassageVerdict(claim, d.text)).filter(v => v !== 'insufficient_evidence'));
  return verdicts.size === 1 ? [...verdicts][0] : 'insufficient_evidence';
}

// Explicit projection keeps legacy labels and arbitrary index metadata out of prompts.
export const evidenceDocuments = (documents: ReferenceDocument[]) => documents.map(({ id, url, title, text }) => ({ id, url, title, text }));
