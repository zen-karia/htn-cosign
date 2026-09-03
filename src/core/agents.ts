// Live research agents are deliberately heterogeneous. Four calls to one model with one prompt and
// one search budget return four identical submissions, which is not independent verification: the
// panel agrees because it is the same agent, not because the evidence converged. Varying the model
// family, the research strategy and the search depth decorrelates their failure modes, so agreement
// between them carries information.
export interface ResearchAgent {
  model: string;
  lens: string;
  maxToolCalls: number;
  temperature?: number;
}
export const researchAgents: ResearchAgent[] = [
  { model: 'gpt-4.1-mini', maxToolCalls: 6, temperature: 0.2, lens: 'Restrict yourself to primary and official sources: the originating organisation, regulator, or official record. Quote the document that first established the fact, not coverage of it.' },
  { model: 'gpt-4o-mini', maxToolCalls: 8, temperature: 0.8, lens: 'Audit every number, date, unit and scope boundary in the claim separately. A claim is only supported if each figure matches its source exactly; report any rounding, restatement or changed baseline.' },
  { model: 'gpt-5-mini', maxToolCalls: 8, lens: 'Require independent corroboration from unaffiliated publishers. Treat sources that republish one original as a single source, and say so explicitly when the claim rests on one origin.' },
  // gpt-4.1 under this lens reliably cited plausible URLs recalled from training rather than pages
  // it had opened, scoring 0 grounded citations across 16 submissions; instructing it not to did not
  // help, so the counter-evidence strategy runs on a different model.
  { model: 'gpt-4o', maxToolCalls: 10, temperature: 0.6, lens: 'Search first for evidence that the claim is wrong: corrections, retractions, later revisions, and contradictory reporting. Cite only pages you actually opened in this search session and can quote from; never cite a URL you recall from training, however plausible it looks. Conclude supported only if the counter-evidence search comes back empty.' },
];
// Per-deployment override, e.g. OPENAI_SELLER_MODELS='gpt-4.1-mini,gpt-4o-mini,gpt-4.1,gpt-5-mini'.
export function agentFor(index: number, models?: string): ResearchAgent {
  const agent = researchAgents[index % researchAgents.length];
  const overrides = (models || '').split(',').map(value => value.trim()).filter(Boolean);
  return overrides.length ? { ...agent, model: overrides[index % overrides.length] } : agent;
}
