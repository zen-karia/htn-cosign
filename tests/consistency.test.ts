import { describe, expect, it, vi } from 'vitest';
import { meaningfulDifference, verifiedConflicts } from '../src/core/consistency';
import { createTask, Engine } from '../src/core/engine';
import type { ConsistencyConflict, ExtractedAssertion } from '../src/core/models';

const assertions: ExtractedAssertion[] = ['a', 'b', 'c'].map(text => ({ text: `${text} assertion text`, kind: 'VERIFIABLE' as const, reason: 'measurable' }));
const conflict = (over: Partial<ConsistencyConflict> = {}): ConsistencyConflict => ({
  assertions: [0, 1], kind: 'numeric_mismatch', explanation: 'The stated percentage does not follow.',
  stated_value: 42, computed_value: 39, computation: '100000 to 61000 is a 39% decrease', ...over,
});

describe('internal consistency findings', () => {
  it('keeps a numeric mismatch whose figures really disagree', () => {
    expect(verifiedConflicts([conflict()], assertions)).toHaveLength(1);
  });

  // The model can word a mismatch confidently while its own two numbers agree.
  it('drops a numeric mismatch whose figures actually agree', () => {
    expect(verifiedConflicts([conflict({ stated_value: 42, computed_value: 42 })], assertions)).toEqual([]);
    expect(verifiedConflicts([conflict({ stated_value: 42, computed_value: 42.01 })], assertions)).toEqual([]);
  });

  it('drops a reference to an assertion the document never made', () => {
    expect(verifiedConflicts([conflict({ assertions: [0, 9] })], assertions)).toEqual([]);
    expect(verifiedConflicts([conflict({ assertions: [] })], assertions)).toEqual([]);
  });

  it('does not apply the arithmetic check to non-numeric kinds', () => {
    const textual = conflict({ kind: 'contradiction', stated_value: 0, computed_value: 0, computation: '' });
    expect(verifiedConflicts([textual], assertions)).toHaveLength(1);
  });

  it('reports one finding per pair rather than repeating it', () => {
    expect(verifiedConflicts([conflict(), conflict({ assertions: [1, 0] })], assertions)).toHaveLength(1);
  });

  it('scales the tolerance with the size of the figures', () => {
    expect(meaningfulDifference(1_000_000, 1_000_001)).toBe(false);
    expect(meaningfulDifference(1_000_000, 940_000)).toBe(true);
    expect(meaningfulDifference(42, 39)).toBe(true);
  });
});

describe('consistency inside an audit run', () => {
  const DOC = 'Northwind cut emissions by 42 percent between 2019 and 2023. Emissions fell from 100,000 tonnes in 2019 to 61,000 tonnes in 2023.';
  const extracted = [
    { text: 'Northwind cut emissions by 42 percent between 2019 and 2023.', kind: 'VERIFIABLE' as const, reason: 'measurable' },
    { text: 'Northwind emissions fell from 100,000 tonnes in 2019 to 61,000 tonnes in 2023.', kind: 'VERIFIABLE' as const, reason: 'measurable' },
  ];
  const audit = () => {
    const task = createTask({ claim: DOC, task_type: 'document_audit', scenario: 'pool' }, {});
    const engine = new Engine(task, {}, async () => {});
    vi.spyOn(engine.models, 'extractAssertions').mockResolvedValue({ assertions: extracted });
    return { task, engine };
  };

  it('records the contradiction before any research happens', async () => {
    const { task, engine } = audit();
    vi.spyOn(engine.models, 'checkConsistency').mockResolvedValue({ conflicts: [conflict()] });
    while (task.phase !== 'sellers') await engine.step();
    expect(task.audit?.conflicts).toHaveLength(1);
    expect(task.deliveries).toEqual([]);
    expect(task.activity.some(e => e.stage === 'document.consistency' && e.message.includes('1 internal inconsistency'))).toBe(true);
  });

  // The check is an enrichment, so losing it must not cost the buyer a run.
  it('continues the run when the check is unavailable', async () => {
    const { task, engine } = audit();
    vi.spyOn(engine.models, 'checkConsistency').mockRejectedValue(new Error('service down'));
    while (task.phase !== 'complete') await engine.step();
    expect(task.audit?.conflicts).toBeUndefined();
    expect(task.deliveries.length).toBeGreaterThan(0);
    expect(task.activity.some(e => e.message.includes('consistency check unavailable'))).toBe(true);
  });

  // A document contradicting itself is not the sellers' doing.
  it('does not let a contradiction change what sellers are paid', async () => {
    const clean = audit();
    vi.spyOn(clean.engine.models, 'checkConsistency').mockResolvedValue({ conflicts: [] });
    while (clean.task.phase !== 'complete') await clean.engine.step();

    const conflicted = audit();
    vi.spyOn(conflicted.engine.models, 'checkConsistency').mockResolvedValue({ conflicts: [conflict()] });
    while (conflicted.task.phase !== 'complete') await conflicted.engine.step();

    expect(conflicted.task.paid_sol).toBe(clean.task.paid_sol);
    expect(conflicted.task.refunded_sol).toBe(clean.task.refunded_sol);
  });
});
