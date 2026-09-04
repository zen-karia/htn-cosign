// failed_criteria are machine-readable and are matched on by tests, receipts and disputes. People
// still have to read them in the activity feed and the evidence view, where a raw rubric key and a
// full URL is noise. This renders one for display without changing what is stored.
const host = (value: string) => { try { return new URL(value).hostname.replace(/^www\./, ''); } catch { return value; } };
const trailingUrl = (value: string) => value.match(/https?:\/\/\S+$/)?.[0];

export function describeCriterion(raw: string): string {
  const [key, ...rest] = raw.split(': ');
  const detail = rest.join(': ');
  const url = trailingUrl(detail);
  const where = url ? ` (${host(url)})` : '';
  switch (key) {
    case 'min_citations': {
      const [, need, cites, got] = detail.match(/required (\d+) independent sources, verified (\d+) citation\(s\) across (\d+) source/) ?? [];
      return need ? `Needs ${need} independent sources, has ${got} (${cites} verified citation${cites === '1' ? '' : 's'})` : 'Not enough independent sources';
    }
    case 'citations_must_be_grounded': {
      if (detail.startsWith('Citation does not exist')) return `Cited source does not exist${where}`;
      const [, ratio] = detail.match(/\(([\d.]+) of word sequences matched\)/) ?? [];
      if (ratio) return `Quote not found in its source${where}`;
      if (detail.includes('does not establish')) return `Source does not establish the verdict${where}`;
      return `Citation could not be grounded${where}`;
    }
    case 'must_pass_hallucination_check':
      return detail.includes('referenced by any claim')
        ? 'No cited source backs any claim in the submission'
        : 'Bibliography scan could not confirm a cited source';
    case 'judge_verdict':
      return 'Independent judges rejected the submission';
    case 'verdict_enum':
      return 'Verdict is not one the rubric allows';
    case 'required_fields':
      return `Submission is missing ${detail.replace('missing ', '')}`;
    default:
      return raw;
  }
}
