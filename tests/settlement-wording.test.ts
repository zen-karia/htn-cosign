import { describe, expect, it } from 'vitest';
import { createTask, Engine } from '../src/core/engine';
import { DEMO_CLAIM } from '../src/data/corpus';
import type { EscrowService } from '../src/services/escrow';

// Every receipt below is a real one as far as the engine is concerned. The activity feed used to
// announce SIMULATED regardless, which told a reader the opposite of what the signature proves.
const escrow: EscrowService = {
  initialize: async task => ({ operation: 'initialize', mocked: false, signature: 'sig-init', amount_sol: task.payment_amount_sol * task.slots.length, explorer_url: 'https://explorer.solana.com/tx/sig-init' }),
  settle: async (task, index, pass, hash) => ({ operation: pass ? 'release' : 'refund', mocked: false, signature: `sig-${index}`, amount_sol: task.payment_amount_sol, explorer_url: `https://explorer.solana.com/tx/sig-${index}`, evidence_hash: hash }),
};

async function settled(env: Record<string, string>) {
  const task = createTask({ claim: DEMO_CLAIM, scenario: 'reliable' }, env);
  task.service_modes.solana = env.MOCK_MODE_SOLANA !== 'false';
  const engine = new Engine(task, env, async () => {}, undefined, escrow);
  while (task.phase !== 'complete') await engine.step();
  return task.activity.filter(item => item.stage.startsWith('payment.') || item.stage === 'settlement.started' || item.stage === 'escrow.funded');
}

describe('settlement wording follows the settlement mode', () => {
  it('does not call a real devnet transaction simulated', async () => {
    const events = await settled({ MOCK_MODE_SOLANA: 'false' });
    expect(events.length).toBeGreaterThan(0);
    expect(events.every(item => !item.mocked)).toBe(true);
    for (const item of events) {
      expect(item.message).not.toMatch(/SIMULATED|simulated/);
      expect(item.message).not.toContain('[MOCKED]');
    }
    expect(events.some(item => /RELEASED|RETURNED/.test(item.message))).toBe(true);
  });

  it('still says simulated when settlement really is', async () => {
    const events = await settled({ MOCK_MODE_SOLANA: 'true' });
    expect(events.some(item => /SIMULATED/.test(item.message))).toBe(true);
  });
});
