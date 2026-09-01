import { describe, expect, it } from 'vitest';
import cached from '../public/demo-cache.json';
import type { Task } from '../src/core/models';
import { STAGES, replayFrame } from '../src/web/replay';

const full = cached.task as Task;
const through = (stage: string) => full.activity.findIndex(e => e.stage === stage) + 1;
describe('offline board replay', () => {
  // A stage rename in engine.ts silently froze the replay board once already: the
  // committed fixture still had the old names, so every assertion below kept passing.
  it('keys off stages the recording actually contains', () => {
    const recorded = new Set(full.activity.map(e => e.stage));
    const required = [STAGES.funded, STAGES.decomposed, STAGES.submitted, STAGES.reviewStarted, STAGES.reviewDone, STAGES.released, STAGES.returned, STAGES.completed];
    expect(required.filter(s => !recorded.has(s))).toEqual([]);
  });
  it('starts empty and funds escrow only when initialization is recorded', () => {
    const start = replayFrame(full, 0);
    expect(start.locked_sol).toBe(0);
    expect(start.deliveries).toEqual([]);
    expect(start.receipts).toEqual([]);
    expect(start.slots.every(s => s.state === 'pending' && !s.receipt)).toBe(true);
    const funded = replayFrame(full, through(STAGES.funded));
    expect(funded.locked_sol).toBe(full.payment_amount_sol * full.slots.length);
    expect(funded.receipts.map(r => r.operation)).toEqual(['initialize']);
  });
  it('reveals arrivals without leaking final verification or reconciliation', () => {
    const frame = replayFrame(full, through(STAGES.submitted));
    expect(frame.deliveries).toHaveLength(full.deliveries.length);
    expect(frame.deliveries[0].verification).toBeUndefined();
    expect(frame.deliveries[0].dispute).toBeUndefined();
    expect(frame.sub_claims.every(s => !s.resolution && !s.verdicts.length)).toBe(true);
    expect(frame.parent_verdict).toBeUndefined();
    expect(replayFrame(full, through(STAGES.reviewDone) - 1).deliveries.every(d => !d.verification)).toBe(true);
  });
  it('reveals reviews as a batch and settles each allocation only on its event', () => {
    const frame = replayFrame(full, through(STAGES.released));
    expect(frame.deliveries.every(d => d.verification)).toBe(true);
    expect(frame.slots.filter(s => s.state === 'paid')).toHaveLength(1);
    expect(frame.refunded_sol).toBe(0);
    expect(frame.paid_sol).toBe(full.payment_amount_sol);
    expect(frame.deliveries.filter(d => d.dispute).every(d => d.dispute?.resolution === 'escalated' && !d.dispute.evidence_hash)).toBe(true);
    const refunded = replayFrame(full, through(STAGES.returned));
    expect(refunded.refunded_sol).toBe(full.payment_amount_sol);
    expect(refunded.receipts.filter(r => r.operation === 'refund')).toHaveLength(1);
  });
  it('conserves allocations at every funded frame and restores the full final recording', () => {
    const before = JSON.stringify(full);
    for (let i = through(STAGES.funded); i <= full.activity.length; i++) {
      const frame = replayFrame(full, i);
      expect(frame.paid_sol + frame.refunded_sol + frame.locked_sol).toBeCloseTo(full.slots.length * full.payment_amount_sol);
    }
    expect(replayFrame(full, full.activity.length)).toEqual(full);
    expect(JSON.stringify(full)).toBe(before);
  });
});
