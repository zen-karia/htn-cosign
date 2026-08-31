import type { ReferenceDocument } from '../core/models';

export const CLAIMS = {
  launch: 'Meridian launched its electric ferry service on May 14, 2024.',
  fleet: 'Meridian operates 12 electric ferries.',
  emissions: 'Meridian electric ferries reduced annual operating emissions by 80 percent.',
  reduction: 'Meridian electric ferries reduced annual operating emissions by 18 percent.',
};
export const DEMO_CLAIM = CLAIMS.emissions;
export const COMPLEX_CLAIM = `${CLAIMS.launch} ${CLAIMS.fleet} ${CLAIMS.emissions}`;
const records = [
  ['launch-notice', 'Port authority launch notice', 'Meridian launched its electric ferry service on May 14, 2024. The first scheduled public sailing departed at 07:30.', [{ claim: CLAIMS.launch, verdict: 'supported' }]],
  ['operations-report', 'Annual operations report', 'Meridian launched its electric ferry service on May 14, 2024. Passenger operations have continued since that date.', [{ claim: CLAIMS.launch, verdict: 'supported' }]],
  ['council-minutes', 'Transport committee minutes', 'Meridian launched its electric ferry service on May 14, 2024. The committee confirmed the completed launch at its June meeting.', [{ claim: CLAIMS.launch, verdict: 'supported' }]],
  ['fleet-register', 'Vessel register', 'Meridian operates 12 electric ferries. Each vessel is registered for 120 passengers; no fleet expansion is recorded.', [{ claim: CLAIMS.fleet, verdict: 'supported' }]],
  ['maintenance-ledger', 'Maintenance ledger', 'Meridian operates 12 electric ferries. All twelve vessels completed the annual electrical safety inspection.', [{ claim: CLAIMS.fleet, verdict: 'supported' }]],
  ['service-plan', 'Approved service plan', 'Meridian operates 12 electric ferries. The fleet serves three routes under the approved service plan.', [{ claim: CLAIMS.fleet, verdict: 'supported' }]],
  ['emissions-audit', 'Independent emissions audit', 'Meridian electric ferries reduced annual operating emissions by 18 percent. The comparison includes grid electricity and backup generation. An 80 percent reduction is not supported by the audit.', [{ claim: CLAIMS.emissions, verdict: 'refuted' }, { claim: CLAIMS.reduction, verdict: 'supported' }]],
  ['energy-ledger', 'Energy accounting ledger', 'Meridian electric ferries reduced annual operating emissions by 18 percent. Recorded emissions were 820 tonnes compared with a 1000 tonne baseline. The reported reduction is not 80 percent.', [{ claim: CLAIMS.emissions, verdict: 'refuted' }, { claim: CLAIMS.reduction, verdict: 'supported' }]],
  ['review-panel', 'Public review panel findings', 'Meridian electric ferries reduced annual operating emissions by 18 percent. The panel rejected the promotional 80 percent figure because it excluded grid emissions.', [{ claim: CLAIMS.emissions, verdict: 'refuted' }, { claim: CLAIMS.reduction, verdict: 'supported' }]],
] as const;
export const corpus: ReferenceDocument[] = records.map(([id, title, text, assertions]) => ({ id, title, text, url: `https://reference.cosign.example/${id}`, assertions: assertions.map(x => ({ ...x })) }));
