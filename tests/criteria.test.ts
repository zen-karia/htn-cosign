import { describe, expect, it } from 'vitest';
import { describeCriterion } from '../src/core/criteria';

describe('failure reasons read as sentences without losing the stored form', () => {
  it.each([
    ['min_citations: required 3 independent sources, verified 3 citation(s) across 2 source(s); 2 earned no credit', 'Needs 3 independent sources, has 2 (3 verified citations)'],
    ['citations_must_be_grounded: Citation does not exist in the reference index: https://www.esa.int/a/b', 'Cited source does not exist (esa.int)'],
    ['citations_must_be_grounded: Quote not grounded (0.00 of word sequences matched): https://science.nasa.gov/mission/webb/x', 'Quote not found in its source (science.nasa.gov)'],
    ['citations_must_be_grounded: Indexed passage does not establish the submitted supported verdict for this claim: https://jwst-docs.stsci.edu/y', 'Source does not establish the verdict (jwst-docs.stsci.edu)'],
    ['must_pass_hallucination_check: none of the 2 cited source(s) are referenced by any claim in the submission', 'No cited source backs any claim in the submission'],
    ['must_pass_hallucination_check: Bibliography scan could not find 1 of 2 cited source(s)', 'Bibliography scan could not confirm a cited source'],
    ['judge_verdict: Independent judges agree.', 'Independent judges rejected the submission'],
    ['verdict_enum: submitted verdict is not authorized', 'Verdict is not one the rubric allows'],
    ['required_fields: missing sources', 'Submission is missing sources'],
  ])('renders %s', (raw, expected) => {
    expect(describeCriterion(raw)).toBe(expected);
  });

  it('passes through anything it does not recognise', () => {
    expect(describeCriterion('some_future_gate: went wrong')).toBe('some_future_gate: went wrong');
  });

  it('never leaks a full URL into the rendered text', () => {
    const rendered = describeCriterion('citations_must_be_grounded: Quote not grounded (0.00 of word sequences matched): https://example.com/a/very/long/path?query=1');
    expect(rendered).not.toContain('https://');
    expect(rendered).not.toContain('/very/long/path');
  });
});
