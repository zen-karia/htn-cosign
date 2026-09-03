import { describe, expect, it } from 'vitest';
import { createTask, Engine } from '../src/core/engine';
import { COMPLEX_CLAIM } from '../src/data/corpus';

// A Durable Object persists the whole task under one key, and SQLite refuses a value over 2 MB.
// A decomposed run once crossed that by storing a copy of every retrieved page on every delivery,
// which stalled the pipeline with an error no activity message explained.
const LIMIT_BYTES = 2 * 1024 * 1024;

describe('a completed task stays small enough to persist', () => {
  it('does not keep a copy of the retrieved pages on every delivery', async () => {
    const task = createTask({ claim: COMPLEX_CLAIM, scenario: 'pool', decompose: true, seller_count: 4 }, {});
    const engine = new Engine(task, {}, async () => {});
    while (task.phase !== 'complete') await engine.step();

    expect(task.deliveries.length).toBeGreaterThan(1);
    const references = task.deliveries.flatMap(d => d.verification?.grounding_check.references ?? []);
    expect(references.length).toBeGreaterThan(0);
    expect(references.every(reference => reference.text === '')).toBe(true);
    // The metadata the evidence view renders must survive the trim.
    expect(references.every(reference => typeof reference.url === 'string' && reference.url.length > 0)).toBe(true);
  });

  it('serialises well inside the Durable Object value limit', async () => {
    const task = createTask({ claim: COMPLEX_CLAIM, scenario: 'pool', decompose: true, seller_count: 4 }, {});
    const engine = new Engine(task, {}, async () => {});
    while (task.phase !== 'complete') await engine.step();
    const bytes = Buffer.byteLength(JSON.stringify(task));
    expect(bytes).toBeLessThan(LIMIT_BYTES);
    // Deliveries must not dominate the payload the way duplicated page bodies did.
    const deliveryBytes = Buffer.byteLength(JSON.stringify(task.deliveries));
    expect(deliveryBytes).toBeLessThan(LIMIT_BYTES / 2);
  });
});
