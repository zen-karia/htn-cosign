import { embeddingDimensions, embeddingTag, normalize, type BlindInput, type CitationStatus, type GroundingResult, type ReferenceDocument, type RetrievalFailure } from '../core/models';
import { corpus } from '../data/corpus';
import { Models, type EntailmentPassage } from './models';
import { evidenceDocuments } from './mock-evidence';
import { Runtime, ServiceUnavailable } from './runtime';

export class Grounding {
  // Set from the task before verification so a blocked fetch is not read as a bad citation.
  retrievalFailures: Record<string, RetrievalFailure> = {};
  constructor(private runtime: Runtime, private models: Models, private referenceCorpus: ReferenceDocument[] = corpus) {}
  private get index() { const index = this.runtime.env.ELASTICSEARCH_INDEX || 'cosign-references'; if (!/^[a-z][a-z0-9_-]{0,100}$/.test(index)) throw new ServiceUnavailable('elasticsearch', 'Invalid index name'); return index; }
  async request<T>(path: string, body: unknown, method = 'POST'): Promise<T> {
    const base = this.runtime.require('ELASTICSEARCH_URL').replace(/\/$/, '');
    const key = this.runtime.env.ELASTICSEARCH_API_KEY;
    return this.runtime.json<T>(`${base}/${path}`, { method, headers: { 'content-type': 'application/json', ...(key ? { authorization: `ApiKey ${key}` } : {}) }, body: JSON.stringify(body) });
  }
  async indexDocuments(documents: ReferenceDocument[]): Promise<void> {
    await this.runtime.call('elasticsearch', 'index_evidence', async () => undefined, async () => {
      const base = this.runtime.require('ELASTICSEARCH_URL').replace(/\/$/, '');
      const headers = { 'content-type': 'application/json', ...(this.runtime.env.ELASTICSEARCH_API_KEY ? { authorization: `ApiKey ${this.runtime.env.ELASTICSEARCH_API_KEY}` } : {}) };
      const exists = await fetch(`${base}/${this.index}`, { method: 'HEAD', headers, signal: AbortSignal.timeout(15_000) });
      if (!exists.ok && exists.status !== 404) throw new ServiceUnavailable('elasticsearch', `Index check failed with HTTP ${exists.status}`);
      if (exists.status === 404) {
        const created = await fetch(`${base}/${this.index}`, { method: 'PUT', headers, signal: AbortSignal.timeout(30_000), body: JSON.stringify({
          mappings: { _meta: { embedding: embeddingTag(this.runtime.env) }, properties: {
            id: { type: 'keyword' }, url: { type: 'keyword' }, canonical_url: { type: 'keyword' }, title: { type: 'text' }, publisher: { type: 'keyword' },
            retrieved_at: { type: 'date' }, content_hash: { type: 'keyword' }, snippet: { type: 'text' }, text: { type: 'text' },
            embedding: { type: 'dense_vector', dims: embeddingDimensions(this.runtime.env), index: true, similarity: 'cosine' },
          } },
        }) });
        if (!created.ok) throw new ServiceUnavailable('elasticsearch', `Index creation failed with HTTP ${created.status}`);
      }
      await Promise.all(documents.map(async document => {
        const embedding = await this.models.embedding(`${document.title}\n${document.text.slice(0, 20_000)}`);
        await this.request(`${this.index}/_doc/${encodeURIComponent(document.id)}?refresh=wait_for`, { ...document, embedding }, 'PUT');
      }));
    });
  }
  async search(claim: string): Promise<ReferenceDocument[]> {
    return this.runtime.call('elasticsearch', 'hybrid_search', () => {
      const tokens = new Set(normalize(claim).split(' '));
      const score = (doc: ReferenceDocument) => normalize(doc.text).split(' ').filter(t => tokens.has(t)).length;
      return evidenceDocuments([...this.referenceCorpus].sort((a, b) => score(b) - score(a)).slice(0, 12));
    }, async () => {
      const mapping = await this.runtime.json<Record<string, { mappings: { _meta?: { embedding?: string } } }>>(`${this.runtime.require('ELASTICSEARCH_URL').replace(/\/$/, '')}/${this.index}/_mapping`, { headers: this.runtime.env.ELASTICSEARCH_API_KEY ? { authorization: `ApiKey ${this.runtime.env.ELASTICSEARCH_API_KEY}` } : {} });
      const expected = embeddingTag(this.runtime.env);
      if (mapping[this.index]?.mappings._meta?.embedding !== expected) throw new ServiceUnavailable('elasticsearch', 'Embedding model differs from index; seed a fresh index before changing model mode');
      const vector = await this.models.embedding(claim);
      // BM25 + approximate dense-vector search, fused in the application.
      const [lexical, dense] = await Promise.all([
        this.request<{ hits: { hits: { _id: string; _source: ReferenceDocument }[] } }>(`${this.index}/_search`, { size: 12, query: { match: { text: claim } }, _source: { excludes: ['embedding'] } }),
        this.request<{ hits: { hits: { _id: string; _source: ReferenceDocument }[] } }>(`${this.index}/_search`, { size: 12, knn: { field: 'embedding', query_vector: vector, k: 12, num_candidates: 50 }, _source: { excludes: ['embedding'] } }),
      ]);
      const fused = new Map<string, { doc: ReferenceDocument; score: number }>();
      for (const list of [lexical.hits.hits, dense.hits.hits]) list.forEach((hit, rank) => { const item = fused.get(hit._id) || { doc: hit._source, score: 0 }; item.score += 1 / (60 + rank + 1); fused.set(hit._id, item); });
      return evidenceDocuments([...fused.values()].sort((a, b) => b.score - a.score).slice(0, 12).map(x => x.doc));
    });
  }
  async check(input: BlindInput): Promise<GroundingResult> {
    const references = await this.search(input.claim);
    const docs = await this.runtime.call('elasticsearch', 'citation_esql', () => this.referenceCorpus, async () => {
      const urls = [...new Set(input.submission.sources.map(s => s.url))];
      if (!urls.length) return [];
      const conditions = urls.map((_, i) => `url == ?p${i}`).join(' OR ');
      const response = await this.request<{ columns: { name: string }[]; values: unknown[][] }>('_query', {
        query: `FROM ${this.index} | WHERE ${conditions} | KEEP id, url, title, text, canonical_url, publisher, retrieved_at, content_hash, snippet | LIMIT 100`,
        params: urls.map((url, i) => ({ [`p${i}`]: url })),
      });
      if (!response.columns || !response.values) throw new ServiceUnavailable('elasticsearch', 'Invalid ES|QL response');
      const names = ['id', 'url', 'title', 'text'];
      const columns = names.map(name => response.columns.findIndex(c => c.name === name));
      if (columns.some(i => i < 0)) throw new ServiceUnavailable('elasticsearch', 'Missing citation document columns');
      return response.values.map(row => {
        const values = columns.map(i => row[i]);
        if (!values.every(v => typeof v === 'string')) throw new ServiceUnavailable('elasticsearch', 'Invalid citation document fields');
        const [id, url, title, text] = values as string[];
        const optional = Object.fromEntries(['canonical_url', 'publisher', 'retrieved_at', 'content_hash', 'snippet'].flatMap(name => {
          const index = response.columns.findIndex(c => c.name === name), value = index >= 0 ? row[index] : undefined;
          return typeof value === 'string' && value ? [[name, value]] : [];
        }));
        return { id, url, title, text, ...optional };
      });
    });
    return this.evaluate(input, references, docs);
  }
  private async evaluate(input: BlindInput, references: ReferenceDocument[], docs: ReferenceDocument[]): Promise<GroundingResult> {
    const unsupported: string[] = [];
    const passages: EntailmentPassage[] = [];
    const citations: GroundingResult['citations'] = input.submission.sources.map((source, citation_index) => {
      const sourceUrl = (() => { try { const u = new URL(source.url); u.hash = ''; return u.href.replace(/\/$/, ''); } catch { return source.url; } })();
      const candidates = docs.filter(d => [d.url, d.canonical_url].filter(Boolean).some(value => value === sourceUrl || value === source.url));
      const normalizedQuote = normalizeEvidence(source.quote);
      const scored = candidates.map(candidate => ({ candidate, ratio: groundingRatio(normalizedQuote, normalizeEvidence(candidate.text)) })).sort((a, b) => b.ratio - a.ratio);
      const doc = scored[0]?.candidate;
      const quote_match_ratio = scored[0]?.ratio ?? 0;
      const quoteMatches = !!doc && quote_match_ratio >= GROUNDING_THRESHOLD;
      // A citation we could not retrieve is held apart from one we retrieved and disproved.
      const failure = this.retrievalFailures[sourceUrl] || this.retrievalFailures[source.url];
      const status: CitationStatus = doc ? (quoteMatches ? 'grounded' : 'contradicted') : failure ? failure.status : 'nonexistent';
      if (status === 'nonexistent') unsupported.push(`Citation does not exist in the reference index: ${source.url}`);
      else if (status === 'contradicted') unsupported.push(`Quote not grounded (${quote_match_ratio.toFixed(2)} of word sequences matched): ${source.url}`);
      else if (status === 'grounded') passages.push({ citation_index, document_id: doc!.id, url: doc!.url, quote: source.quote, passage: doc!.text });
      return { url: source.url, exists: !!doc, quote_matches: quoteMatches, quote_match_ratio, status, ...(failure ? { unverifiable_reason: failure.reason } : {}), supports_verdict: false, ...(doc ? { document_id: doc.id } : {}) };
    });
    if (passages.length) {
      const assessments = await this.models.entailment(input.claim, input.submission.verdict, passages);
      for (const assessment of assessments) {
        const citation = citations[assessment.citation_index];
        citation.supports_verdict = assessment.supports_verdict;
        citation.entailment_reasoning = assessment.reasoning;
        citation.entailment_mocked = this.runtime.mocked('openai');
        // A passage can support 'supported' or 'refuted'. Nothing can positively establish
        // 'insufficient_evidence', so requiring entailment for it would reject every honest
        // report that the public record does not settle the claim.
        if (!assessment.supports_verdict && input.submission.verdict !== 'insufficient_evidence') unsupported.push(`Indexed passage does not establish the submitted ${input.submission.verdict} verdict for this claim: ${citation.url}`);
      }
    }
    if (!citations.length) unsupported.push('No citations supplied.');
    const combined = new Map(references.map(d => [d.id, d]));
    for (const doc of docs) if (input.submission.sources.some(s => s.url === doc.url) && !combined.has(doc.id)) combined.set(doc.id, doc);
    return { unsupported_claims: unsupported, source: 'elasticsearch', mocked: this.runtime.mocked('elasticsearch') || (passages.length > 0 && this.runtime.mocked('openai')), citations, references: evidenceDocuments([...combined.values()]) };
  }
}

const SHINGLE_SIZE = 3;
export const GROUNDING_THRESHOLD = 0.75;
const shingles = (tokens: string[]) => Array.from({ length: Math.max(0, tokens.length - SHINGLE_SIZE + 1) }, (_, i) => tokens.slice(i, i + SHINGLE_SIZE).join(' '));
// A quote is grounded when most of its short word sequences appear verbatim in the document we
// fetched ourselves. Exact containment cannot survive two independent extractions of one page, so
// it rejects honest citations; fabricated text shares almost no ordered sequences with a real source.
export function groundingRatio(normalizedQuote: string, normalizedText: string): number {
  if (!normalizedQuote) return 0;
  const quoteTokens = normalizedQuote.split(' ').filter(Boolean);
  if (quoteTokens.length < SHINGLE_SIZE) return normalizedText.includes(normalizedQuote) ? 1 : 0;
  const indexed = new Set(shingles(normalizedText.split(' ').filter(Boolean)));
  const quoted = shingles(quoteTokens);
  return quoted.filter(shingle => indexed.has(shingle)).length / quoted.length;
}
const normalizeEvidence = (value: string) => value.normalize('NFKC').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();
