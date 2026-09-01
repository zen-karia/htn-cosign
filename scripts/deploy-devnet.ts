import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { Escrow } from '../src/services/escrow';
import { Runtime } from '../src/services/runtime';
import { loadEnv, logEvidence } from './env';
const env = loadEnv();
if (env.MOCK_MODE_SOLANA !== 'false') throw new Error('Devnet deployment is deferred until MOCK_MODE_SOLANA=false.');
if (!existsSync('target/deploy/cosign_escrow.so') || !existsSync('.keys/program.json')) throw new Error('Build the Anchor program and prepare .keys/program.json first.');
const runtime = new Runtime(env, logEvidence);
await runtime.call('solana', 'deploy_devnet', () => { throw new Error('Deployment cannot be mocked'); }, async () => {
  await new Escrow(runtime).connection();
  const result = spawnSync('.tools/solana-release/bin/solana', ['program', 'deploy', '--url', env.SOLANA_RPC_URL || 'https://api.devnet.solana.com', '--keypair', '.keys/buyer.json', '--program-id', '.keys/program.json', '--max-len', String(statSync('target/deploy/cosign_escrow.so').size), 'target/deploy/cosign_escrow.so'], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error('Devnet deployment failed; no production/mainnet fallback allowed');
  return true;
});
