import { Models } from '../src/services/models';
import { Runtime } from '../src/services/runtime';
import { researchAgents } from '../src/core/agents';
import { loadEnv } from './env';

const runtime = new Runtime({ ...loadEnv(), MOCK_MODE_OPENAI: 'false' });
const models = new Models(runtime);
const claim = 'The James Webb Space Telescope launched on December 25, 2021.';
for (const [index, agent] of researchAgents.entries()) {
  try {
    const submission = await models.researchSeller(claim, { min_citations: 1 }, agent);
    console.log(`agent ${index + 1} (${agent.model}): OK — ${submission.verdict}, ${submission.sources.length} sources`);
  } catch (error) {
    console.log(`agent ${index + 1} (${agent.model}): FAILED — ${error instanceof Error ? error.message : String(error)}`);
  }
}
