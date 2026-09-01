import { describe, expect, it, vi } from 'vitest';
import { ReferenceDocumentSchema, Rubric, type BlindInput, type ReferenceDocument } from '../src/core/models';
import { corpus, DEMO_CLAIM } from '../src/data/corpus';
import { Grounding, GROUNDING_THRESHOLD, groundingRatio } from '../src/services/grounding';
import { Models } from '../src/services/models';
import { Runtime } from '../src/services/runtime';

const document: ReferenceDocument = { id: 'unseen-report', url: 'https://reports.example/2025', title: '2025 operations report', text: 'Harbor Transit operated 24 electric buses throughout 2025.' };
const input = (doc = document): BlindInput => ({ claim: 'The Harbor Transit electric bus fleet numbered 24 in 2025.', acceptance_criteria: Rubric.parse({ min_citations: 1 }), submission: { verdict: 'supported', reasoning: 'The annual report states the fleet size and reporting period.', sources: [{ url: doc.url, quote: doc.text }] } });
const response = (assessments: unknown) => ({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ assessments }) } }] });
const assessment = { citation_index: 0, supports_verdict: true, reasoning: 'The passage establishes the same fleet, quantity and period.' };

function adapter(documents = [document]) {
  const runtime = new Runtime({ MOCK_MODE_OPENAI: 'false', OPENAI_API_KEY: 'test-only' });
  const models = new Models(runtime);
  // Exercise the real adapter/parser with a stubbed transport, never a paid API call.
  const transport = vi.spyOn(runtime, 'json').mockResolvedValue(response([assessment]));
  return { runtime, models, transport, ground: new Grounding(runtime, models, documents) };
}

describe('passage entailment grounding', () => {
  it('ingests unlabeled documents and verifies a paraphrase through the entailment adapter', async () => {
    expect(ReferenceDocumentSchema.parse(document)).toEqual(document);
    const { ground, transport } = adapter();
    const result = await ground.check(input());
    expect(result.unsupported_claims).toEqual([]);
    expect(result.citations[0]).toMatchObject({ exists: true, quote_matches: true, supports_verdict: true, entailment_mocked: false });
    const body = JSON.parse(transport.mock.calls[0][1].body as string);
    expect(body.text.format.strict).toBe(true);
    const payload = JSON.parse(body.input);
    expect(payload).toMatchObject({ claim: input().claim, submitted_verdict: 'supported', passages: [{ document_id: document.id, quote: document.text, passage: document.text }] });
    expect(payload).not.toHaveProperty('submission');
  });

  it('does not let a forged answer label approve a passage the model rejects', async () => {
    const poisoned = { ...document, assertions: [{ claim: input().claim, verdict: 'supported' as const }] };
    const { ground, transport } = adapter([poisoned]);
    transport.mockResolvedValue(response([{ ...assessment, supports_verdict: false, reasoning: 'The cited passage does not establish the claim.' }]));
    const result = await ground.check(input());
    expect(result.citations[0].supports_verdict).toBe(false);
    expect(result.unsupported_claims).toHaveLength(1);
    expect(JSON.stringify(transport.mock.calls)).not.toContain('assertions');
    expect(result.references[0]).not.toHaveProperty('assertions');
  });

  it('skips entailment for nonexistent URLs and invalid quotes', async () => {
    const { ground, transport } = adapter();
    const value = input();
    value.submission.sources = [{ url: 'https://missing.example/report', quote: document.text }, { url: document.url, quote: 'Harbor Transit operated 42 electric buses throughout 2025.' }];
    const result = await ground.check(value);
    expect(result.unsupported_claims).toHaveLength(2);
    expect(result.citations.every(c => !c.supports_verdict)).toBe(true);
    expect(transport).not.toHaveBeenCalled();
  });

  it('does not normalize away a negative sign in a quote', async () => {
    const doc = { ...document, text: 'Operating profit was -18 million dollars during 2025.' };
    const { ground, transport } = adapter([doc]);
    const value = input(doc); value.submission.sources[0].quote = doc.text.replace('-18', '18');
    const result = await ground.check(value);
    expect(result.citations[0].quote_matches).toBe(false);
    expect(transport).not.toHaveBeenCalled();
  });

  it('cannot pass with no citations', async () => {
    const { ground, transport } = adapter();
    const value = input(); value.submission.sources = [];
    expect((await ground.check(value)).unsupported_claims).toEqual(['No citations supplied.']);
    expect(transport).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', []],
    ['duplicate', [assessment, assessment]],
    ['unknown index', [{ ...assessment, citation_index: 99 }]],
    ['invalid boolean', [{ ...assessment, supports_verdict: 'true' }]],
  ])('fails closed on a %s entailment assessment', async (_, assessments) => {
    const { ground, transport } = adapter(); transport.mockResolvedValue(response(assessments));
    await expect(ground.check(input())).rejects.toThrow();
  });

  it('fails closed on provider failure and refusal', async () => {
    const { ground, transport } = adapter();
    transport.mockRejectedValueOnce(new Error('provider unavailable'));
    await expect(ground.check(input())).rejects.toThrow();
    transport.mockResolvedValueOnce({ choices: [{ finish_reason: 'stop', message: { content: null, refusal: 'Declined' } }] });
    await expect(ground.check(input())).rejects.toThrow('Incomplete or refused');
  });

  it('maps out-of-order assessments back to the correct citations', async () => {
    const second = { ...document, id: 'second', url: 'https://reports.example/second', text: 'Harbor Transit operated 42 electric buses throughout 2025.' };
    const { ground, transport } = adapter([document, second]);
    transport.mockResolvedValue(response([{ ...assessment, citation_index: 1, supports_verdict: false }, assessment]));
    const value = input(); value.submission.sources.push({ url: second.url, quote: second.text });
    const result = await ground.check(value);
    expect(result.citations.map(c => c.supports_verdict)).toEqual([true, false]);
  });

  it('keeps offline percentage variants working without answer annotations', async () => {
    const runtime = new Runtime({});
    const docs = corpus.map(({ assertions: _, ...doc }) => doc);
    const models = new Models(runtime);
    const claim = DEMO_CLAIM.replace('80 percent', '80%');
    const submission = await models.seller(claim, Rubric.parse({}), docs);
    const result = await new Grounding(runtime, models, docs).check({ claim, acceptance_criteria: Rubric.parse({}), submission });
    expect(submission.verdict).toBe('refuted');
    expect(result.unsupported_claims).toEqual([]);
    expect(result.citations).toHaveLength(3);
    expect(result.citations.every(c => c.entailment_mocked)).toBe(true);
  });

  it('labels grounding as mocked when only entailment is mocked', async () => {
    const runtime = new Runtime({ MOCK_MODE_ELASTICSEARCH: 'false', ELASTICSEARCH_URL: 'https://index.example' });
    const ground = new Grounding(runtime, new Models(runtime));
    vi.spyOn(ground, 'search').mockResolvedValue([document]);
    vi.spyOn(ground, 'request').mockResolvedValue({ columns: ['id', 'url', 'title', 'text'].map(name => ({ name })), values: [[document.id, document.url, document.title, document.text]] });
    const value = input(); value.claim = document.text;
    const result = await ground.check(value);
    expect(result.unsupported_claims).toEqual([]);
    expect(result.mocked).toBe(true);
    expect(result.citations[0].entailment_mocked).toBe(true);
  });

  it('gives both judges independently indexed evidence and strips annotations from both views', async () => {
    const { models, transport } = adapter();
    transport.mockResolvedValue({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ verdict: 'supported', confidence: 0.9, grounded: true, unsupported_claims: [], evidence_ids: [document.id], reason: 'Review complete.' }) } }] });
    const other = { ...document, id: 'unrelated', url: 'https://reports.example/other' };
    const docs = [document, other].map(d => ({ ...d, assertions: [{ claim: 'answer-key-secret', verdict: 'supported' as const }] }));
    await models.judge('a', input(), docs);
    await models.judge('b', input(), docs);
    const views = transport.mock.calls.map(([, init]) => JSON.parse(JSON.parse(init.body as string).input).reference_documents);
    expect(views[0]).toHaveLength(2);
    expect(views[1]).toHaveLength(2);
    expect(JSON.stringify(transport.mock.calls)).not.toContain('answer-key-secret');
  });
  it('accepts an honest quote that the fetched page renders with one word dropped', async () => {
    const doc = { ...document, text: 'Harbor Transit operated 24 electric buses throughout 2025 across twelve routes, replacing an ageing diesel fleet and cutting annual operating emissions measured by the independent transport authority.' };
    const { ground } = adapter([doc]);
    const value = input(doc);
    value.submission.sources[0].quote = doc.text.replace(' ageing', '');
    const result = await ground.check(value);
    expect(result.citations[0].quote_matches).toBe(true);
    expect(result.citations[0].quote_match_ratio).toBeGreaterThan(GROUNDING_THRESHOLD);
    expect(result.unsupported_claims).toEqual([]);
  });

  it('still rejects a fabricated quote that shares no wording with the fetched page', async () => {
    const { ground, transport } = adapter();
    const value = input();
    value.submission.sources[0].quote = 'Independent analysts corroborate the reported result across every audited quarter of the program.';
    const result = await ground.check(value);
    expect(result.citations[0].quote_matches).toBe(false);
    expect(result.citations[0].quote_match_ratio).toBe(0);
    expect(result.unsupported_claims[0]).toContain('Quote not grounded');
    expect(transport).not.toHaveBeenCalled();
  });

  it('separates extraction noise from fabrication by score', () => {
    const page = 'harbor transit operated 24 electric buses throughout 2025 across twelve routes replacing an ageing diesel fleet';
    expect(groundingRatio('harbor transit operated 24 electric buses throughout 2025 across twelve routes', page)).toBe(1);
    expect(groundingRatio('harbor transit operated 24 electric buses throughout 2025 across routes', page)).toBeGreaterThan(GROUNDING_THRESHOLD);
    expect(groundingRatio('analysts corroborate the reported result in the annual review', page)).toBe(0);
  });
});
