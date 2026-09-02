import type { Task } from '../core/models';

// Recordings contain events rather than snapshots. Anonymous review events cannot
// safely be assigned to sellers, so reveal their results as one review batch.
// These must track the stage names src/core/engine.ts emits; a rename there silently
// froze the replay board until tests/replay.test.ts started asserting on them.
export const STAGES = {
  funded: 'escrow.funded',
  decomposed: 'claims.decomposed',
  submitted: 'submissions.completed',
  reviewStarted: 'judge.started',
  reviewDone: 'judge.completed',
  contested: 'contested',
  resolved: 'reconciliation.completed',
  released: 'payment.released',
  returned: 'payment.returned',
  completed: 'run.completed',
  error: 'error',
} as const;

export function replayFrame(full: Task, count: number): Task {
  const activity = full.activity.slice(0, count);
  if (activity.some(e => e.stage === STAGES.completed)) return { ...structuredClone(full), activity };
  const frame = structuredClone(full);
  frame.activity = activity;
  frame.phase = 'initialize'; frame.status = 'posted'; frame.running = false;
  delete frame.completed_at; delete frame.parent_verdict; delete frame.error;
  const has = (stage: string) => activity.some(e => e.stage === stage);
  const funded = has(STAGES.funded);
  const reviewed = activity.filter(e => e.stage === STAGES.reviewDone).length >= full.deliveries.length && full.deliveries.length > 0;
  const settling = has(STAGES.released) || has(STAGES.returned);
  if (funded) frame.phase = 'decompose';
  if (has(STAGES.decomposed)) frame.phase = 'sellers';
  if (has(STAGES.submitted)) { frame.phase = full.request.protected ? 'verify' : 'reconcile'; frame.status = 'submitted'; }
  if (has(STAGES.reviewStarted)) { frame.phase = 'verify'; frame.status = 'verifying'; }
  if (reviewed || has(STAGES.contested) || has(STAGES.resolved)) frame.phase = 'reconcile';
  if (settling) frame.phase = 'settle';
  const arrived = has(STAGES.submitted) ? frame.deliveries.length : 0;
  frame.deliveries = frame.deliveries.slice(0, arrived);
  for (const d of frame.deliveries) {
    delete d.error;
    if (!reviewed) { delete d.verification; delete d.dispute; }
    else if (d.dispute) { d.dispute.resolution = 'escalated'; delete d.dispute.evidence_hash; }
  }
  frame.slots = frame.slots.map(slot => {
    const event = activity.find(e => (e.stage === STAGES.released || e.stage === STAGES.returned) && e.message.endsWith(` ${slot.seller_id}.`));
    if (!event) return { ...slot, state: 'pending', receipt: undefined };
    for (const d of frame.deliveries.filter(d => d.seller_id === slot.seller_id)) {
      if (d.dispute) { d.dispute.resolution = 'auto_refund'; d.dispute.evidence_hash = slot.receipt?.evidence_hash; }
    }
    return slot;
  });
  frame.receipts = [...(funded ? full.receipts.filter(r => r.operation === 'initialize') : []), ...frame.slots.flatMap(s => s.receipt ? [s.receipt] : [])];
  // Slots can settle partially, so totals come from the amounts recorded on each slot. Older
  // recordings predate per-slot amounts and fall back to a whole-slot headcount.
  const settled = (slot: Task['slots'][number], key: 'released_sol' | 'returned_sol') =>
    slot[key] ?? (slot.state === (key === 'released_sol' ? 'paid' : 'refunded') ? frame.payment_amount_sol : 0);
  frame.paid_sol = frame.slots.reduce((sum, slot) => sum + Math.round(settled(slot, 'released_sol') * 1e9), 0) / 1e9;
  frame.refunded_sol = frame.slots.reduce((sum, slot) => sum + Math.round(settled(slot, 'returned_sol') * 1e9), 0) / 1e9;
  frame.locked_sol = funded ? frame.slots.filter(s => s.state === 'pending').length * frame.payment_amount_sol : 0;
  frame.sub_claims = has(STAGES.decomposed) ? frame.sub_claims.map(s => ({ ...s, verdicts: settling ? s.verdicts : [], reconciled_verdict: settling ? s.reconciled_verdict : 'insufficient_evidence', resolution: settling ? s.resolution : undefined })) : [];
  if (settling) frame.parent_verdict = full.parent_verdict;
  frame.evidence = frame.evidence.filter(e => activity.length && e.at <= activity[activity.length - 1].at);
  if (activity.at(-1)?.stage === STAGES.error) { frame.status = 'stalled'; frame.error = activity.at(-1)!.message; }
  return frame;
}
