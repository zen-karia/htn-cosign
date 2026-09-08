import type { ConsistencyConflict, ExtractedAssertion } from './models';

// A numeric mismatch is the one conflict kind the model has to do arithmetic for, so it is the
// one kind that can be checked rather than trusted. The model reports the figure the document
// states and the figure its other numbers imply; if those two agree, there was no mismatch and
// the finding is dropped however confidently it was worded.
export const NUMERIC_TOLERANCE = 0.005;

export function meaningfulDifference(stated: number, computed: number): boolean {
  if (!Number.isFinite(stated) || !Number.isFinite(computed)) return false;
  const scale = Math.max(Math.abs(stated), Math.abs(computed));
  return Math.abs(stated - computed) > Math.max(0.05, NUMERIC_TOLERANCE * scale);
}

// An index outside the assertion list is a reference to something the document never said.
export function verifiedConflicts(conflicts: ConsistencyConflict[], assertions: ExtractedAssertion[]): ConsistencyConflict[] {
  const seen = new Set<string>();
  return conflicts.filter(conflict => {
    if (!conflict.assertions.length) return false;
    if (conflict.assertions.some(index => !Number.isInteger(index) || index < 0 || index >= assertions.length)) return false;
    if (conflict.kind === 'numeric_mismatch' && !meaningfulDifference(conflict.stated_value, conflict.computed_value)) return false;
    const key = `${conflict.kind}\u0000${[...conflict.assertions].sort((a, b) => a - b).join(',')}`;
    return seen.has(key) ? false : (seen.add(key), true);
  });
}

export function describeConflict(kind: ConsistencyConflict['kind']): string {
  return { numeric_mismatch: 'Figures disagree', contradiction: 'Cannot both be true', date_conflict: 'Dates disagree', scope_undefined: 'Basis undefined' }[kind];
}
