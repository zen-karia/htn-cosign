import { z } from 'zod';
import type { BlindInput, HallucinationResult } from '../core/models';
import { Runtime, ServiceUnavailable } from './runtime';

// GPTZero Bibliography Scan: POST /v2/bibliography-scan/text with {document}.
// It parses citations out of the prose, then checks each against GPTZero's source
// index and the public web. NOT the AI-authorship /predict/text endpoint, whose
// output says only "an LLM wrote this" — true of every submission here by design.
export const BIBLIOGRAPHY_SCAN_URL = 'https://api.gptzero.me/v2/bibliography-scan/text';

// A live scan searches the web per citation and measured ~59s for three citations,
// well past Runtime's 45s default. Budget generously; the alarm retries on timeout.
const SCAN_TIMEOUT_MS = 180_000;

const Scan = z.object({
  bibliographic_citations: z.array(z.object({
    text: z.string().optional(),
    citation_exists: z.object({
      status: z.string().optional(),
      hallucination_explanation: z.string().nullish(),
      justification: z.string().nullish(),
    }).nullish(),
  })).default([]),
});

// Renders the blinded submission as prose plus a Works Cited block, which is the
// shape the scanner parses. Identity is already stripped upstream by blindSubmission.
export function scanDocument(input: BlindInput): string {
  const entries = input.submission.sources.map((source, i) => `[${i + 1}] "${source.quote}" ${source.url}`);
  const body = `${input.claim}\nVerdict: ${input.submission.verdict}\n${input.submission.reasoning} ${input.submission.sources.map((_, i) => `[${i + 1}]`).join(' ')}`;
  return `${body}\n\nWorks Cited\n${entries.join('\n')}`;
}

export class Hallucination {
  constructor(private runtime: Runtime) {}
  check(input: BlindInput): Promise<HallucinationResult> {
    return this.runtime.call<HallucinationResult>('gptzero', 'hallucination_check', () => ({ flagged: false, source: 'gptzero', mocked: true, reasoning: '[MOCKED] Hallucination fixture; source integrity is independently enforced by grounding.' }), async () => {
      const endpoint = this.runtime.env.GPTZERO_HALLUCINATION_URL || BIBLIOGRAPHY_SCAN_URL;
      const url = new URL(endpoint);
      if (url.protocol !== 'https:' || !(url.hostname === 'api.gptzero.me' || url.hostname.endsWith('.gptzero.me'))) throw new ServiceUnavailable('gptzero', 'Use an official GPTZero HTTPS endpoint');
      const result = await this.runtime.json<unknown>(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': this.runtime.require('GPTZERO_API_KEY') },
        body: JSON.stringify({ document: scanDocument(input) }),
      }, SCAN_TIMEOUT_MS);
      const scan = Scan.parse(result);
      const citations = scan.bibliographic_citations;
      // A submission that cites sources the scanner cannot find any trace of is
      // flagged. `unsure` is reported but does not veto on its own: grounding already
      // proves index membership, and one vendor's uncertainty is not evidence of a lie.
      const fake = citations.filter(c => c.citation_exists?.status === 'fake');
      const unsure = citations.filter(c => c.citation_exists?.status === 'unsure');
      if (!citations.length) return { flagged: false, source: 'gptzero', mocked: false, reasoning: 'Bibliography scan parsed no citations from the submission; grounding remains the binding source check.' };
      const detail = fake.map(c => c.citation_exists?.hallucination_explanation || c.citation_exists?.justification || c.text || 'unnamed citation').join('; ');
      return {
        flagged: fake.length > 0,
        source: 'gptzero',
        mocked: false,
        reasoning: fake.length
          ? `Bibliography scan could not find ${fake.length} of ${citations.length} cited source(s) in GPTZero's index or on the public web: ${detail}`
          : `Bibliography scan located all ${citations.length} cited source(s)${unsure.length ? `; ${unsure.length} matched with low confidence` : ''}.`,
      };
    });
  }
}
