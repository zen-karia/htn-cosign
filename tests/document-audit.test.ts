import { describe, expect, it, vi } from 'vitest';
import { createTask, Engine } from '../src/core/engine';
import { COMPLEX_CLAIM } from '../src/data/corpus';
import type { ExtractedAssertion } from '../src/core/models';

const LIVE_ENV = { OPENAI_API_KEY: 'configured', ELASTICSEARCH_URL: 'https://index.example' };

const DOCUMENT = [
  'Meridian Ferries cut annual operating emissions by 80 percent after electrifying its fleet.',
  'We believe this makes us the most forward-thinking operator on the west coast.',
  'The company will expand to twelve additional routes next year.',
  'Our performance has been strong across the board.',
].join(' ');

const extraction = (assertions: ExtractedAssertion[]) => ({ assertions });

function audit(extra: Record<string, unknown> = {}, env: Record<string, string> = {}) {
  const task = createTask({ claim: DOCUMENT, task_type: 'document_audit', scenario: 'pool', ...extra }, env);
  return { task, engine: new Engine(task, env, async () => {}) };
}

describe('document audit', () => {
  it('skips whole-document verifiability, because a document is not one claim', async () => {
    const { task, engine } = audit({ execution_mode: 'live' }, LIVE_ENV);
    expect(task.phase).toBe('classify');
    const classify = vi.spyOn(engine.models, 'classify');
    await engine.step();
    expect(classify).not.toHaveBeenCalled();
    expect(task.verifiability).toBeUndefined();
    expect(task.phase).toBe('initialize');
  });

  it('keeps every assertion it found but researches only the checkable ones', async () => {
    const { task, engine } = audit();
    vi.spyOn(engine.models, 'extractAssertions').mockResolvedValue(extraction([
      { text: 'Meridian Ferries cut annual operating emissions by 80 percent.', kind: 'VERIFIABLE', reason: 'A measurable published figure.' },
      { text: 'Meridian is the most forward-thinking operator on the west coast.', kind: 'SUBJECTIVE', reason: 'A value judgement.' },
      { text: 'Meridian will expand to twelve additional routes next year.', kind: 'FUTURE_PREDICTION', reason: 'Has not happened yet.' },
      { text: 'Meridian performance has been strong across the board.', kind: 'INSUFFICIENTLY_SPECIFIED', reason: 'No metric or period given.' },
    ]));
    while (task.phase !== 'sellers') await engine.step();

    // The unresearchable three are the audit's finding, not discarded noise.
    expect(task.audit?.assertions).toHaveLength(4);
    expect(task.audit?.assertions.map(a => a.kind)).toEqual(['VERIFIABLE', 'SUBJECTIVE', 'FUTURE_PREDICTION', 'INSUFFICIENTLY_SPECIFIED']);
    expect(task.sub_claims.map(s => s.text)).toEqual(['Meridian Ferries cut annual operating emissions by 80 percent.']);
    expect(task.activity.some(e => e.stage === 'document.extracted' && e.message.includes('1 checkable, 3 not researchable'))).toBe(true);
  });

  it('refunds without researching when the document asserts nothing checkable', async () => {
    const { task, engine } = audit();
    vi.spyOn(engine.models, 'extractAssertions').mockResolvedValue(extraction([
      { text: 'We are the most trusted name in the industry.', kind: 'SUBJECTIVE', reason: 'Marketing language.' },
      { text: 'Next year will be our strongest yet.', kind: 'FUTURE_PREDICTION', reason: 'Has not happened yet.' },
    ]));
    while (task.phase !== 'complete') await engine.step();
    expect(task.status).toBe('refunded');
    expect(task.deliveries).toEqual([]);
    expect(task.activity.some(e => e.stage === 'run.rejected')).toBe(true);
  });

  it('bounds research to four assertion/seller pairs per alarm', async () => {
    const { task, engine } = audit();
    vi.spyOn(engine.models, 'extractAssertions').mockResolvedValue(extraction(
      ['First checkable assertion about emissions.', 'Second checkable assertion about routes.', 'Third checkable assertion about vessels.']
        .map(text => ({ text, kind: 'VERIFIABLE' as const, reason: 'Measurable.' }))));
    while (task.phase !== 'sellers') await engine.step();

    const pairs = task.sub_claims.length * task.slots.length;
    expect(pairs).toBeGreaterThan(4);

    await engine.step();
    expect(task.deliveries).toHaveLength(4);
    expect(task.phase).toBe('sellers');

    while (task.phase === 'sellers') await engine.step();
    expect(task.deliveries).toHaveLength(pairs);
  });

  // The panel decides "pending" from this, because reconciled_verdict is seeded to
  // insufficient_evidence at creation and would otherwise read as a finished finding.
  it('leaves a sub-claim without verdicts until reconcile has run', async () => {
    const { task, engine } = audit();
    vi.spyOn(engine.models, 'extractAssertions').mockResolvedValue(extraction([
      { text: 'A checkable assertion about emissions.', kind: 'VERIFIABLE', reason: 'measurable' },
    ]));
    while (task.phase !== 'sellers') await engine.step();
    expect(task.sub_claims[0].reconciled_verdict).toBe('insufficient_evidence');
    expect(task.sub_claims[0].verdicts).toEqual([]);

    while (task.phase !== 'complete') await engine.step();
    expect(task.sub_claims[0].verdicts.length).toBeGreaterThan(0);
  });

  it('leaves ordinary claim runs unbatched', async () => {
    const env = {};
    const task = createTask({ claim: COMPLEX_CLAIM, scenario: 'pool', decompose: true }, env);
    const engine = new Engine(task, env, async () => {});
    while (task.phase !== 'sellers') await engine.step();
    expect(task.sub_claims.length * task.slots.length).toBeGreaterThan(4);
    await engine.step();
    // One pass fills every slot, so the phase advances instead of re-entering.
    expect(task.deliveries).toHaveLength(task.sub_claims.length * task.slots.length);
    expect(task.phase).not.toBe('sellers');
  });
});
