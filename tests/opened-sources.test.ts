import { describe, expect, it, vi } from 'vitest';
import { Models } from '../src/services/models';
import { Runtime } from '../src/services/runtime';
import { researchAgents } from '../src/core/agents';

const submission = (urls: string[]) => JSON.stringify({
  verdict: 'supported', confidence: 0.9,
  summary: 'The official pages state the figure for the reporting period.',
  reasoning: 'The official pages state the figure for the reporting period.',
  atomic_claims: ['The official page states the figure.'],
  sources: urls.map(url => ({ url, title: 'Official page', quote: 'A verbatim passage copied from the page.' })),
});
const response = (visited: string[], cited: string[]) => ({
  status: 'completed',
  output: [
    { type: 'web_search_call', action: { sources: visited.map(url => ({ url })) } },
    { type: 'message', content: [{ type: 'output_text', text: submission(cited) }] },
  ],
});
function seller(responses: ReturnType<typeof response>[]) {
  const runtime = new Runtime({ MOCK_MODE_OPENAI: 'false', OPENAI_API_KEY: 'test-only' });
  const transport = vi.spyOn(runtime, 'json');
  responses.forEach(value => transport.mockResolvedValueOnce(value));
  return { models: new Models(runtime), transport };
}
const real = 'https://home.cern/science/accelerators/large-hadron-collider';
const invented = 'https://home.cern/energy/energy/';

describe('a seller may only cite pages it actually opened', () => {
  it('accepts a submission whose citations all came from its own searches', async () => {
    const { models, transport } = seller([response([real], [real])]);
    const result = await models.researchSeller('claim text', {}, researchAgents[0]);
    expect(result.sources.map(s => s.url)).toEqual([real]);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('ignores tracking parameters and a trailing slash when comparing', async () => {
    const { models, transport } = seller([response([`${real}/?utm_source=openai`], [real])]);
    await models.researchSeller('claim text', {}, researchAgents[0]);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('asks again when a citation was never opened, and takes the better answer', async () => {
    const { models, transport } = seller([
      response([real], [real, invented]),
      response([real], [real]),
    ]);
    const result = await models.researchSeller('claim text', {}, researchAgents[0]);
    expect(transport).toHaveBeenCalledTimes(2);
    expect(result.sources.map(s => s.url)).toEqual([real]);
  });

  it('keeps the first answer when the retry is no better', async () => {
    const { models } = seller([
      response([real], [real, invented]),
      response([real], [invented, invented]),
    ]);
    const result = await models.researchSeller('claim text', {}, researchAgents[0]);
    expect(result.sources).toHaveLength(2);
  });

  it('fails open when the search tool reported no sources at all', async () => {
    const { models, transport } = seller([response([], [invented])]);
    const result = await models.researchSeller('claim text', {}, researchAgents[0]);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(result.sources.map(s => s.url)).toEqual([invented]);
  });
});
