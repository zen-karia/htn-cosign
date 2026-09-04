import { describe, expect, it } from 'vitest';
import { verdictTone } from '../src/web/components';

describe('a badge colour never contradicts its own text', () => {
  it.each([
    ['not supported', 'danger'], ['not verified', 'danger'], ['unsupported', 'danger'],
    ['refuted', 'danger'], ['refunded', 'danger'], ['blocked', 'danger'],
    ['supported', 'success'], ['verified', 'success'], ['paid', 'success'], ['complete', 'success'],
    ['partly paid', 'warning'], ['partly verified', 'warning'], ['contested', 'warning'],
    ['insufficient evidence', 'warning'], ['insufficient_evidence', 'warning'],
    ['pending', 'neutral'], ['in review (2 of 4)', 'neutral'],
  ])('%s renders as %s', (verdict, tone) => {
    expect(verdictTone(verdict)).toBe(tone);
  });

  it('defaults to neutral when nothing is known yet', () => {
    expect(verdictTone(undefined)).toBe('neutral');
  });
});
