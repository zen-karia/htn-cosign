import { describe, expect, it } from 'vitest';
import { agentFor, researchAgents } from '../src/core/agents';

describe('live research panel', () => {
  it('gives every slot a different model, strategy and search budget', () => {
    const assigned = [0, 1, 2, 3].map(index => agentFor(index));
    expect(new Set(assigned.map(a => a.model)).size).toBe(4);
    expect(new Set(assigned.map(a => a.lens)).size).toBe(4);
    expect(new Set(assigned.map(a => a.maxToolCalls)).size.valueOf()).toBeGreaterThan(1);
  });

  it('cycles the roster when more sellers are requested than agents exist', () => {
    expect(agentFor(4).model).toBe(researchAgents[0].model);
    expect(agentFor(5).lens).toBe(researchAgents[1].lens);
  });

  it('honours a deployment model override without losing the strategies', () => {
    const models = 'gpt-4.1-mini, gpt-4o-mini ,gpt-4.1';
    expect([0, 1, 2].map(i => agentFor(i, models).model)).toEqual(['gpt-4.1-mini', 'gpt-4o-mini', 'gpt-4.1']);
    expect(agentFor(3, models).model).toBe('gpt-4.1-mini');
    expect(agentFor(0, models).lens).toBe(researchAgents[0].lens);
  });

  it('ignores an empty override', () => {
    expect(agentFor(1, '').model).toBe(researchAgents[1].model);
    expect(agentFor(1, '  ,  ').model).toBe(researchAgents[1].model);
  });
});
