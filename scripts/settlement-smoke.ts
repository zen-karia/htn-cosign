// Proves the devnet settlement path end to end without spending a bounty: one release that moves
// lamports and one refusal that moves none, both carrying the evidence hash in a memo.
import { Escrow } from '../src/services/escrow';
import { Runtime } from '../src/services/runtime';
import type { Task } from '../src/core/models';
import { loadEnv } from './env';

const env = loadEnv();
const runtime = new Runtime({ ...env, MOCK_MODE_SOLANA: 'false' });
const addresses = JSON.parse(env.SOLANA_SELLER_ADDRESSES || '{}') as Record<string, string>;
const task = {
  task_id: `smoke-${Date.now()}`,
  payment_amount_sol: 0.002,
  request: { protected: true },
  slots: [
    { seller_id: 'research-agent-1', address: addresses['research-agent-1'], state: 'pending' },
    { seller_id: 'research-agent-2', address: addresses['research-agent-2'], state: 'pending' },
  ],
  deliveries: [],
} as unknown as Task;

const escrow = new Escrow(runtime);
const hash = 'a'.repeat(64);
console.log('paying   ', task.slots[0].address);
const released = await escrow.settle(task, 0, true, hash);
console.log('  release:', released.signature);
console.log('  explorer:', released.explorer_url);
console.log('refusing ', task.slots[1].address);
const refunded = await escrow.settle(task, 1, false, hash);
console.log('  refund :', refunded.signature);
console.log('  explorer:', refunded.explorer_url);
