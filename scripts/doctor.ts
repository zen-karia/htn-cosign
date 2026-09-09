import { existsSync } from 'node:fs';
import { loadEnv } from './env';
const env = loadEnv();
const required: Record<string, string[]> = {
  openai: ['OPENAI_API_KEY'], elasticsearch: ['ELASTICSEARCH_URL', 'ELASTICSEARCH_INDEX'],
  gptzero_optional: ['GPTZERO_API_KEY'], sentry_optional: ['SENTRY_DSN'],
};
console.log('Cosign readiness — configured is not confirmed live evidence');
let failures = 0;
for (const [service, keys] of Object.entries(required)) {
  const missing = keys.filter(k => !env[k]); const optional = service.endsWith('_optional');
  console.log(`${service.replace('_optional', '').padEnd(15)} ${missing.length ? `[${optional ? 'OPTIONAL / NOT CONFIGURED' : 'MISSING'}] · ${missing.join(', ')}` : '[CONFIGURED]'}`);
  if (!optional && missing.length) failures++;
}
const simulatedSettlement = String(env.MOCK_MODE_SOLANA ?? '').toLowerCase() === 'true' || !env.SOLANA_BUYER_SECRET_KEY || env.SOLANA_SETTLEMENT !== 'transfer';
console.log(`settlement      ${simulatedSettlement ? '[SIMULATED] · no Solana transaction is sent by Verification Desk' : '[DEVNET] · each slot settles in its own transaction carrying the verification hash'}`);
console.log(`Offline cache: ${existsSync('artifacts/demo-cache.json') ? 'present' : 'run npm run demo'}`);
console.log(`Local env: ${existsSync('.dev.vars') ? 'present; rerun npm run setup after editing .env' : 'run npm run setup'}`);
console.log('GPTZero Bibliography Scan needs real, publicly findable citations; a fictional corpus makes every citation "fake". Baseten/Browserbase are optional and not claimed.');
if (failures) process.exitCode = 1;
