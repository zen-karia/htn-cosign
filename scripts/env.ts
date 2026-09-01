import { config } from 'dotenv';
import { readFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import type { ServiceEvidence, Settings } from '../src/core/models';
config({ quiet: true });
export function loadEnv(): Settings {
  const env = { ...process.env };
  for (const [key, file] of [['SOLANA_BUYER_SECRET_KEY', 'buyer'], ['SOLANA_AUTHORITY_SECRET_KEY', 'authority']]) if (!env[key] && existsSync(`.keys/${file}.json`)) env[key] = readFileSync(`.keys/${file}.json`, 'utf8').trim();
  return env;
}
export function logEvidence(entry: ServiceEvidence) { mkdirSync('artifacts/live', { recursive: true }); appendFileSync('artifacts/live/service-calls.jsonl', JSON.stringify(entry) + '\n'); }
