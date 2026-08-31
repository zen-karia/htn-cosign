import { Submission, type BlindInput, type Criteria } from './models';

// This boundary belongs to orchestration. Verification modules never see the identity map.
export function blindSubmission(claim: string, criteria: Criteria, value: unknown, identities: string[]): BlindInput {
  const raw = value as Record<string, unknown>;
  const parsed = Submission.parse({ verdict: raw.verdict, reasoning: raw.reasoning, sources: Array.isArray(raw.sources) ? raw.sources.map(s => ({ url: s.url, quote: s.quote })) : raw.sources });
  const secrets = [...identities, 'reliable', 'fabricator', 'sloppy', 'uninstructed'].filter(Boolean).sort((a, b) => b.length - a.length);
  const scrub = (text: string) => secrets.reduce((out, secret) => out.replace(new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '[redacted]'), text)
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, '[redacted]');
  return { claim: scrub(claim), acceptance_criteria: structuredClone(criteria), submission: { verdict: parsed.verdict, reasoning: scrub(parsed.reasoning), sources: parsed.sources.map(s => ({ url: scrub(s.url), quote: scrub(s.quote) })).sort((a, b) => a.url.localeCompare(b.url)) } };
}
