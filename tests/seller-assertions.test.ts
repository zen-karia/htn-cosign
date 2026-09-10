import { describe, expect, it } from 'vitest';
import type { Task } from '../src/core/models';
import { sellerAssertions } from '../src/web/view-model';

const delivery = (seller: string, sub: string, verdict: string, pass?: boolean) => ({
  submission_id: `${seller}-${sub}`, seller_id: seller, sub_claim_id: sub,
  content: { verdict, reasoning: 'r', sources: [] },
  ...(pass === undefined ? {} : { verification: { resolver_verdict: { final_pass: pass } } }),
});

const task = {
  sub_claims: [
    { sub_claim_id: 'a', text: 'First assertion about emissions.' },
    { sub_claim_id: 'b', text: 'Second assertion about fleet size.' },
  ],
  deliveries: [
    // Both agents agree on 'a' and split on 'b'.
    delivery('agent-1', 'a', 'supported', true),
    delivery('agent-2', 'a', 'supported', true),
    delivery('agent-1', 'b', 'refuted', false),
    delivery('agent-2', 'b', 'supported', true),
  ],
} as unknown as Task;

describe('per-agent assertion breakdown', () => {
  it('reports one row per assertion the agent actually researched', () => {
    const rows = sellerAssertions(task, 'agent-1');
    expect(rows.map(row => row.number)).toEqual([1, 2]);
    expect(rows.map(row => row.verdict)).toEqual(['supported', 'refuted']);
    expect(rows[0].text).toBe('First assertion about emissions.');
  });

  // Divergence is a property of the assertion, so it shows on every agent that touched it.
  it('marks only the assertion the agents disagreed on', () => {
    for (const agent of ['agent-1', 'agent-2']) {
      const rows = sellerAssertions(task, agent);
      expect(rows.find(row => row.number === 1)!.divergent).toBe(false);
      expect(rows.find(row => row.number === 2)!.divergent).toBe(true);
    }
  });

  it('separates an agent that was overruled from one that was not', () => {
    expect(sellerAssertions(task, 'agent-1').find(row => row.number === 2)!.passed).toBe(false);
    expect(sellerAssertions(task, 'agent-2').find(row => row.number === 2)!.passed).toBe(true);
  });

  it('leaves the verdict undefined while review is still pending', () => {
    const pending = { ...task, deliveries: [delivery('agent-3', 'a', 'supported')] } as unknown as Task;
    expect(sellerAssertions(pending, 'agent-3')[0].passed).toBeUndefined();
  });

  it('returns nothing for a task that has not been loaded', () => {
    expect(sellerAssertions(undefined, 'agent-1')).toEqual([]);
  });
});
