import { describe, expect, it } from 'vitest';
import { createTask, Engine } from '../src/core/engine';
import { COMPLEX_CLAIM } from '../src/data/corpus';
import type { Task } from '../src/core/models';

// Drives a decomposed task to completion, then forces a known pass/fail split across one seller's
// sub-claim submissions so the settlement arithmetic is checked rather than the model's opinions.
async function settleWith(passes: boolean[], protectedRun = true) {
  const task = createTask({ claim: COMPLEX_CLAIM, scenario: 'reliable', decompose: true, seller_count: 2, payment_amount_sol: 0.03, protected: protectedRun }, {});
  const engine = new Engine(task, {}, async () => {});
  while (task.phase !== 'settle' && task.phase !== 'complete') await engine.step();
  const seller = task.slots[0].seller_id;
  const mine = task.deliveries.filter(d => d.seller_id === seller);
  mine.forEach((delivery, index) => {
    if (!delivery.verification || index >= passes.length) return;
    delivery.verification.resolver_verdict = { ...delivery.verification.resolver_verdict, final_pass: passes[index] };
  });
  while (task.phase !== 'complete') await engine.step();
  return { task, slot: task.slots.find(s => s.seller_id === seller)!, units: task.sub_claims.length };
}
const lamports = (value: number) => Math.round(value * 1e9);

describe('a decomposed task settles each sub-claim on its own merits', () => {
  it('pays the verified share and returns the rest', async () => {
    const { slot, units } = await settleWith([true, true, false]);
    expect(units).toBe(3);
    expect(slot.verified_units).toBe(2);
    expect(slot.total_units).toBe(3);
    expect(lamports(slot.released_sol!)).toBe(Math.round(lamports(0.03) * 2 / 3));
    expect(lamports(slot.released_sol! + slot.returned_sol!)).toBe(lamports(0.03));
    expect(slot.receipts?.map(r => r.operation)).toEqual(['release', 'refund']);
  });

  it('pays in full when every sub-claim survives verification', async () => {
    const { slot } = await settleWith([true, true, true]);
    expect(slot.returned_sol).toBe(0);
    expect(lamports(slot.released_sol!)).toBe(lamports(0.03));
    expect(slot.receipts?.map(r => r.operation)).toEqual(['release']);
    expect(slot.state).toBe('paid');
  });

  it('returns the whole allocation when none survive', async () => {
    const { slot } = await settleWith([false, false, false]);
    expect(slot.released_sol).toBe(0);
    expect(lamports(slot.returned_sol!)).toBe(lamports(0.03));
    expect(slot.receipts?.map(r => r.operation)).toEqual(['refund']);
    expect(slot.state).toBe('refunded');
  });

  it('never releases more than the escrow held, across every slot', async () => {
    const { task } = await settleWith([true, false, true]);
    const funded = lamports(task.payment_amount_sol) * task.slots.length;
    expect(lamports(task.paid_sol) + lamports(task.refunded_sol)).toBe(funded);
    expect(task.locked_sol).toBe(0);
  });

  it('pays an unprotected run in full regardless of the verdicts', async () => {
    const { slot } = await settleWith([false, false, false], false);
    expect(lamports(slot.released_sol!)).toBe(lamports(0.03));
  });
});
