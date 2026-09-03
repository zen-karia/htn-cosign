import type { ReferenceDocument, RetrievalFailure, RetrievalOutcome, Submission } from '../core/models';
import { digest } from './escrow';
import { Runtime, ServiceUnavailable } from './runtime';

const MAX_SOURCE_BYTES = 2_000_000;
// Authoritative statistics (national agencies, OECD, EEA) are published as large PDFs; a 2 MB cap
// excluded precisely the sources worth citing. Parsing costs Worker CPU, so the allowance is raised
// only for PDFs, where the extra bytes buy real evidence, and not for HTML.
const MAX_PDF_BYTES = 8_000_000;
// Institutional pages run long, and a citation from the back half of one is not a worse citation.
// Truncating at 30k silently made every such quote unverifiable; the embedding is capped separately.
const MAX_INDEXED_CHARS = 120_000;
const blockedHost = (hostname: string) => {
  const host = hostname.toLowerCase();
  return host === 'localhost' || host.endsWith('.localhost') || host === '0.0.0.0' || host === '::1'
    || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)
    || /^169\.254\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
};

export function canonicalUrl(raw: string): string {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || blockedHost(url.hostname)) throw new ServiceUnavailable('evidence', 'Only public HTTPS sources can be retrieved');
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid|gclid)/i.test(key)) url.searchParams.delete(key);
  return url.href;
}

function decodeEntities(value: string) {
  return value.replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

function htmlText(html: string) {
  return decodeEntities(html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

// unpdf ships a serverless pdf.js build with no DOM or canvas dependency, so it runs inside workerd.
async function pdfText(bytes: Uint8Array) {
  const { extractText, getDocumentProxy } = await import('unpdf');
  const { text } = await extractText(await getDocumentProxy(bytes), { mergePages: true });
  return String(text).replace(/\s+/g, ' ').trim();
}

function pageTitle(html: string, fallback: string) {
  const match = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  return decodeEntities(match?.[1] || fallback).replace(/\s+/g, ' ').trim().slice(0, 500) || fallback;
}

// A source we could not read is not a source the seller invented. Only an authoritative
// "this page is not there" (404/410) is evidence against the citation; being blocked, rate
// limited, served a PDF, or timing out is a limitation of our retrieval, and must never be
// charged to the seller. Callers keep the distinction via RetrievalFailure.status.
export function classifyRetrievalFailure(reason: string): RetrievalFailure['status'] {
  const status = Number(reason.match(/HTTP (\d{3})/)?.[1]);
  return status === 404 || status === 410 ? 'nonexistent' : 'unverifiable';
}

export class EvidenceRetriever {
  constructor(private runtime: Runtime) {}
  async retrieve(submission: Submission): Promise<RetrievalOutcome> {
    const unique = new Map<string, Submission['sources'][number]>();
    for (const source of submission.sources) unique.set(canonicalUrl(source.url), source);
    const entries = [...unique];
    const results = await Promise.allSettled(entries.map(([url, source]) => this.retrieveOne(url, source.title)));
    const failures: RetrievalOutcome['failures'] = {};
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') return;
      const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
      failures[entries[index][0]] = { reason, status: classifyRetrievalFailure(reason) };
    });
    return { documents: results.flatMap(result => result.status === 'fulfilled' ? [result.value] : []), failures };
  }
  private async retrieveOne(url: string, suppliedTitle?: string): Promise<ReferenceDocument> {
    return this.runtime.call('evidence', 'source_retrieved', () => {
      throw new ServiceUnavailable('evidence', 'Live source retrieval has no fixture fallback');
    }, async () => {
      let current = url;
      let response: Response | undefined;
      for (let redirects = 0; redirects <= 4; redirects++) {
        response = await fetch(current, {
          headers: { accept: 'text/html, application/pdf;q=0.9, text/plain;q=0.8, application/xhtml+xml;q=0.8', 'user-agent': 'CosignEvidenceBot/1.0' },
          redirect: 'manual', signal: AbortSignal.timeout(25_000),
        });
        if (![301, 302, 303, 307, 308].includes(response.status)) break;
        const location = response.headers.get('location');
        if (!location || redirects === 4) throw new ServiceUnavailable('evidence', 'Source redirect could not be resolved safely');
        current = canonicalUrl(new URL(location, current).href);
      }
      if (!response) throw new ServiceUnavailable('evidence', 'Source could not be retrieved');
      if (!response.ok) throw new ServiceUnavailable('evidence', `Source returned HTTP ${response.status}`);
      const finalUrl = canonicalUrl(response.url || url);
      const type = response.headers.get('content-type') || '';
      const isPdf = /application\/pdf/i.test(type) || (/octet-stream/i.test(type) && /\.pdf(?:$|\?)/i.test(finalUrl));
      if (!isPdf && !/text\/(html|plain)|application\/xhtml\+xml/i.test(type)) throw new ServiceUnavailable('evidence', 'Source is not extractable HTML, PDF, or plain text');
      const limit = isPdf ? MAX_PDF_BYTES : MAX_SOURCE_BYTES;
      const length = Number(response.headers.get('content-length') || 0);
      if (length > limit) throw new ServiceUnavailable('evidence', 'Source exceeds retrieval size limit');
      let raw = '';
      let text: string;
      if (isPdf) {
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.byteLength > limit) throw new ServiceUnavailable('evidence', 'Source exceeds retrieval size limit');
        text = await pdfText(bytes);
      } else {
        raw = (await response.text()).slice(0, MAX_SOURCE_BYTES);
        text = /html|xhtml/i.test(type) ? htmlText(raw) : raw.replace(/\s+/g, ' ').trim();
      }
      if (text.length < 10) throw new ServiceUnavailable('evidence', 'Source contained no extractable text');
      const host = new URL(finalUrl).hostname.replace(/^www\./, '');
      const hash = await digest(text);
      const identity = await digest(`${url}\n${hash}`);
      return {
        id: `src_${identity.slice(0, 24)}`, url, canonical_url: finalUrl,
        title: suppliedTitle || (isPdf ? host : pageTitle(raw, host)), publisher: host,
        retrieved_at: new Date().toISOString(), content_hash: hash,
        snippet: text.slice(0, 1000), text: text.slice(0, MAX_INDEXED_CHARS),
      };
    });
  }
}
