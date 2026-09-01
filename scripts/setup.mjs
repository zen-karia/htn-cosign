import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { parse } from 'dotenv';
import { Keypair } from '@solana/web3.js';

if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Node 22 or newer is required.');
for (const dir of ['.cache', '.keys', 'artifacts', 'public']) mkdirSync(dir, { recursive: true, mode: 0o700 });
if (!existsSync('.env')) writeFileSync('.env', readFileSync('.env.example'), { mode: 0o600 });
const env = parse(readFileSync('.env'));
for (const [key, file] of [['SOLANA_BUYER_SECRET_KEY', 'buyer'], ['SOLANA_AUTHORITY_SECRET_KEY', 'authority']]) if (!env[key] && existsSync(`.keys/${file}.json`)) env[key] = readFileSync(`.keys/${file}.json`, 'utf8').trim();
if (!env.SOLANA_SELLER_ADDRESSES && existsSync('.keys/agent-cedar.json')) env.SOLANA_SELLER_ADDRESSES = JSON.stringify(Object.fromEntries(['agent-cedar', 'agent-flint', 'agent-moss', 'agent-iris'].map(id => [id, Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(`.keys/${id}.json`, 'utf8')))).publicKey.toBase58()])));
// Dotenv does not unescape JSON's escaped double quotes. Quote JSON values with single quotes.
const quote = value => { const delimiter = value.includes("'") ? '"' : "'"; if (value.includes(delimiter)) throw new Error('Unsupported mixed quotes in environment value'); return delimiter + value + delimiter; };
writeFileSync('.dev.vars', Object.entries(env).filter(([key, value]) => value && key !== 'SENTRY_AUTH_TOKEN' && !key.startsWith('CLOUDFLARE_')).map(([key, value]) => `${key}=${quote(value)}`).join('\n') + '\n', { mode: 0o600 });
console.log('Local setup ready. .env and .dev.vars are ignored. Verification Desk uses configured live OpenAI/Elastic credentials; Demo Replay stays fixture-backed; settlement stays simulated.');
