// Every other suite runs against mocks, so a schema change can break every live
// OpenAI call while typecheck, vitest and the Worker E2E all stay green. That has
// happened twice (format: uri, then optional fields). This makes one real request
// per structured schema and fails loudly. Run it before any live demo.
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { JudgeVerdict, TieVerdict, Reconciliation, Decomposition, Submission } from '../src/core/models';
import { strictJsonSchema } from '../src/services/models';
import { loadEnv } from './env';

const env = loadEnv();
const key = env.OPENAI_API_KEY;
if (!key) { console.error('OPENAI_API_KEY is not set. Live smoke test needs real credentials.'); process.exit(1); }

const Entailment = z.object({ assessments: z.array(z.object({ citation_index: z.number().int().nonnegative(), supports_verdict: z.boolean(), reasoning: z.string().min(1).max(2000) }).strict()) }).strict();
const Verifiability = z.object({ classification: z.enum(['VERIFIABLE', 'SUBJECTIVE', 'FUTURE_PREDICTION', 'INSUFFICIENTLY_SPECIFIED']), reason: z.string().min(1).max(1000) }).strict();

const schemas: [string, z.ZodTypeAny][] = [
  ['seller_fact_check', Submission],
  ['judge_verdict', JudgeVerdict],
  ['resolver_tiebreak', TieVerdict],
  ['claim_reconciliation', Reconciliation],
  ['buyer_decomposition', Decomposition],
  ['passage_entailment', Entailment],
  ['claim_verifiability', Verifiability],
];

const model = env.OPENAI_SELLER_MODEL || 'gpt-4.1-mini';
let failures = 0;

for (const [name, schema] of schemas) {
  const jsonSchema = strictJsonSchema(zodToJsonSchema(schema, { $refStrategy: 'none' }));
  let detail = '';
  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, store: false, instructions: 'Return a syntactically valid example object. Content does not matter.', input: '{}', text: { format: { type: 'json_schema', name, strict: true, schema: jsonSchema } } }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: { message?: string } };
      detail = `HTTP ${response.status}: ${body.error?.message ?? 'no message'}`;
    }
  } catch (err) {
    detail = err instanceof Error ? err.message : 'request failed';
  }
  if (detail) { failures++; console.error(`  ${name.padEnd(22)} REJECTED  ${detail.slice(0, 180)}`); }
  else console.log(`  ${name.padEnd(22)} accepted`);
}

console.log(`\n${schemas.length - failures}/${schemas.length} schemas accepted by OpenAI strict structured outputs (model ${model}).`);
if (failures) {
  console.error('Live mode is broken. Strict mode needs every property in `required` and rejects `format`; see strictJsonSchema in src/services/models.ts.');
  process.exit(1);
}
