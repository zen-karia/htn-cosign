import { describe, expect, it } from 'vitest';
import cached from '../public/demo-cache.json';
import type { Task } from '../src/core/models';
import { deriveProtocolSteps, deriveSettlement, deriveVerificationCounts, finalVerdict, receiptPayload, sellerViewModels } from '../src/web/view-model';

const task = cached.task as Task;

describe('web view-model', () => {
  it('maps runtime phases to the seven protocol stages', () => {
    const active = structuredClone(task);
    active.phase = 'verify'; active.status = 'verifying';
    const steps = deriveProtocolSteps(active);
    expect(steps).toHaveLength(7);
    expect(steps.find(step => step.id === 'verify')?.state).toBe('active');
    expect(steps.find(step => step.id === 'sellers')?.state).toBe('complete');
    expect(steps.find(step => step.id === 'settle')?.state).toBe('pending');
  });

  it('derives settlement amounts without inventing balances', () => {
    const settlement = deriveSettlement(task);
    expect(settlement.total).toBeCloseTo(task.payment_amount_sol * task.slots.length);
    expect(settlement.released).toBe(task.paid_sol);
    expect(settlement.returned).toBe(task.refunded_sol);
    expect(settlement.released + settlement.returned + settlement.pending).toBeCloseTo(settlement.total);
  });

  it('adapts variable seller arrays and verification gates', () => {
    const three = structuredClone(task);
    three.slots = three.slots.slice(0, 3);
    three.deliveries = three.deliveries.filter(delivery => three.slots.some(slot => slot.seller_id === delivery.seller_id));
    const sellers = sellerViewModels(three);
    expect(sellers).toHaveLength(3);
    expect(sellers.map(seller => seller.name).every(Boolean)).toBe(true);
    expect(sellers.every(seller => seller.deliveries.length > 0)).toBe(true);
  });

  it('derives pass counts and final verdict from task data', () => {
    const counts = deriveVerificationCounts(task);
    expect(counts.sellers).toBe(task.slots.length);
    expect(counts.verified).toBe(task.slots.filter(slot => slot.state === 'paid').length);
    expect(finalVerdict(task)).toBe((task.parent_verdict ?? '').replaceAll('_', ' '));
  });

  it('keeps mocked receipts honest in downloadable artifacts', () => {
    const receipt = receiptPayload(task);
    expect(receipt.mocked).toBe(task.service_modes.solana);
    expect(receipt.receipts).toEqual(task.receipts);
    expect(receipt.sellers).toHaveLength(task.slots.length);
    if (task.service_modes.solana) expect(receipt.receipts.every(item => item.explorer_url === null)).toBe(true);
  });
});
