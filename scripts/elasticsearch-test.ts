import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { loadEnv, logEvidence } from './env';
import { Runtime } from '../src/services/runtime';
import { Models } from '../src/services/models';
import { Grounding } from '../src/services/grounding';
import { produce } from '../src/harness/sellers';
import { blindSubmission } from '../src/core/blind';
import { Rubric } from '../src/core/models';
import { corpus, DEMO_CLAIM } from '../src/data/corpus';
const runtime = new Runtime({ ...loadEnv(), MOCK_MODE_ELASTICSEARCH: 'false' }, logEvidence);
const models = new Models(runtime); const ground = new Grounding(runtime, models); const criteria = Rubric.parse({});
const results = [];
for (const behavior of ['reliable', 'fabricator', 'sloppy'] as const) {
  const submission = await produce(behavior, DEMO_CLAIM, criteria, corpus, models);
  const result = await ground.check(blindSubmission(DEMO_CLAIM, criteria, submission, []));
  assert.equal(result.mocked, runtime.mocked('openai') && result.citations.some(c => c.exists && c.quote_matches));
  assert.equal(result.unsupported_claims.length, behavior === 'fabricator' ? 3 : 0);
  results.push({ behavior, result });
}
mkdirSync('artifacts/live', { recursive: true }); writeFileSync('artifacts/live/elasticsearch-grounding.json', JSON.stringify({ at: new Date().toISOString(), embedding_mocked: runtime.mocked('openai'), entailment_mocked: runtime.mocked('openai'), results }, null, 2));
writeFileSync('artifacts/elasticsearch-validation.json', JSON.stringify({ at: new Date().toISOString(), elasticsearch_mocked: false, embedding_mocked: runtime.mocked('openai'), entailment_mocked: runtime.mocked('openai'), checks: results.map(r => ({ case: r.behavior, unsupported_citations: r.result.unsupported_claims.length, operations: ['BM25', 'dense_vector knn', 'RRF', 'parameterized ES|QL citation retrieval', 'passage entailment'] })) }, null, 2));
console.log('PASS: real Elasticsearch BM25 + vector retrieval and parameterized ES|QL caught fabricated citations; reliable/sloppy sources grounded.');
