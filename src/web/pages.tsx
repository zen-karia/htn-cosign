import React, { useMemo, useState, type ReactNode } from 'react';
import { describeCriterion } from '../core/criteria';
import type { Delivery, Task } from '../core/models';
import { blindSubmission } from '../core/blind';
import {
  ActivityFeed,
  Card,
  CopyableHash,
  EmptyState,
  GateRow,
  LoadingState,
  Modal,
  MoneyDisplay,
  MountainHero,
  ProtocolPillars,
  SectionHeader,
  SegmentedTabs,
  SolanaLink,
  StatusBadge,
  StepProgress,
  VerdictBadge,
  type AppRoute,
} from './components';
import {
  deriveSettlement,
  deriveVerificationCounts,
  finalVerdict,
  formatDate,
  formatSol,
  receiptForTask,
  receiptPayload,
  sellerName,
  sellerViewModels,
  shortId,
  type SellerViewModel,
} from './view-model';

export type Config = {
  mode?: 'LIVE'; settlement?: 'SIMULATED';
  services: Record<string, { mocked: boolean; optional: boolean; configured?: boolean }>;
  demo_claim: string;
  complex_claim: string;
  sentry_dsn?: string;
  sentry_org?: string;
};
export type TaskSummary = Pick<Task, 'task_id' | 'claim' | 'status' | 'phase' | 'paid_sol' | 'refunded_sol' | 'created_at'>;

type Navigate = (route: AppRoute) => void;

function DownloadButton({ filename, data, children }: { filename: string; data: unknown; children: ReactNode }) {
  const download = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url; link.download = filename; link.click();
    URL.revokeObjectURL(url);
  };
  return <button type="button" className="button primary-button" onClick={download}>{children}<span aria-hidden="true">↓</span></button>;
}

function ModeNotice({ task, config, onIntegrations }: { task?: Task; config?: Config; onIntegrations: () => void }) {
  const missing = config ? Object.entries(config.services).filter(([, value]) => !value.optional && !value.configured && !value.mocked).map(([name]) => name) : [];
  const replay = !!task && task.request.execution_mode !== 'live';
  return <div className="mode-notice"><StatusBadge tone={replay ? 'warning' : missing.length ? 'warning' : 'success'}>{replay ? 'Replay' : 'Live agents'}</StatusBadge><p>{missing.length ? `${missing.join(', ')} not configured.` : 'OpenAI research and Elastic evidence are configured.'} Settlement is simulated.</p><button type="button" onClick={onIntegrations}>Environment ↗</button></div>;
}

function SellerCard({ seller, onInspect }: { seller: SellerViewModel; onInspect?: () => void }) {
  return <article className={`seller-card ${seller.tone}`}>
    <div className="seller-card-top"><span className="agent-mark" aria-hidden="true">{seller.mark}</span><StatusBadge tone={seller.tone}>{seller.paymentLabel}</StatusBadge></div>
    <button type="button" className="seller-title" disabled={!seller.deliveries.length || !onInspect} onClick={onInspect}>
      <strong>{seller.name}</strong><small>{seller.submissionCount ? `${seller.submissionCount} submission${seller.submissionCount > 1 ? 's' : ''}` : 'Awaiting submission'}</small>
    </button>
    <div className="seller-gates">
      <GateRow label="Source grounding" state={seller.groundingPassed}/>
      <GateRow label="Hallucination gate" state={seller.hallucinationPassed}/>
      <GateRow label="Final verification" state={seller.verificationPassed}/>
    </div>
    <footer><span>{seller.slot.state === 'paid' ? `${formatSol(seller.amount)} SOL released${seller.settlementNote ? ` · ${seller.settlementNote}` : ''}` : seller.slot.state === 'refunded' ? `${formatSol(seller.amount)} SOL returned` : seller.verdict}</span>{seller.deliveries.length > 0 && onInspect && <button type="button" onClick={onInspect} aria-label={`Inspect ${seller.name}`}>↗</button>}</footer>
  </article>;
}

function SettlementCard({ task }: { task?: Task }) {
  const settlement = deriveSettlement(task);
  const released = settlement.total ? settlement.released / settlement.total * 100 : 0;
  const returned = settlement.total ? settlement.returned / settlement.total * 100 : 0;
  return <Card className="settlement-card">
    <SectionHeader icon="▤" title="Verify, then settle" subtitle="Escrow moves only after verification" aside={<VerdictBadge verdict={task?.phase === 'complete' ? 'settled' : task ? task.status : 'ready'}/>}/>
    {task ? <>
      <MoneyDisplay amount={settlement.total} asset={settlement.asset} label={task.phase === 'complete' ? 'total escrowed' : 'in escrow'} large/>
      <div className="settlement-bar" aria-label={`${released.toFixed(0)} percent released, ${returned.toFixed(0)} percent returned`}><i style={{ width: `${released}%` }}/><b style={{ width: `${returned}%` }}/></div>
      <div className="settlement-legend"><div><span className="legend-dot success"/><small>Released</small><strong>{formatSol(settlement.released)} SOL</strong></div><div><span className="legend-dot primary"/><small>Pending verification</small><strong>{formatSol(settlement.pending)} SOL</strong></div><div><span className="legend-dot danger"/><small>Protected / returned</small><strong>{formatSol(settlement.protected)} SOL</strong></div></div>
      <div className="trust-note"><span aria-hidden="true">▣</span><p><strong>No payment on a promise.</strong><small>Funds release only after independent verification.</small></p></div>
    </> : <EmptyState icon="▤" title="No escrow yet" description="Create a verification run to see protected funds and settlement progress."/>}
  </Card>;
}

export function DeskPage({ config, task, posting, claim, minCitations, decompose, onClaim, onCitations, onDecompose, onStart, onNavigate, onInspect, replaying }: {
  config?: Config; task?: Task; posting: boolean; claim: string; minCitations: number; decompose: boolean;
  onClaim: (value: string) => void; onCitations: (value: number) => void; onDecompose: (value: boolean) => void;
  onStart: (scenario: string, protectedFlow?: boolean) => void; onNavigate: Navigate; onInspect: (id: string) => void; replaying: boolean;
}) {
  const [tab, setTab] = useState<'sellers' | 'verdicts' | 'disputes' | 'integrations'>('sellers');
  const sellers = sellerViewModels(task);
  const disputes = task?.deliveries.filter(delivery => delivery.dispute) ?? [];
  const escrow = task ? task.payment_amount_sol * task.slots.length : 0;
  return <>
    <MountainHero eyebrow="VERIFY → SETTLE → ADVANCE AI" title="Good work gets" accent="paid." subtitle="Two independent judges. Grounded evidence. No payment on a promise."><ProtocolPillars/></MountainHero>
    <ModeNotice task={task} config={config} onIntegrations={() => setTab('integrations')}/>
    {replaying && <div className="replay-notice"><strong>Offline replay</strong><span>Recorded fixture · no payments are being made.</span></div>}
    <div className="desk-top-grid">
      <Card className="claim-card">
        <SectionHeader icon="▤" title="The claim" subtitle="Define the work and its verification policy" aside={<StatusBadge tone="primary">Fact-checking</StatusBadge>}/>
        <label className="field-label" htmlFor="claim">What should the agents verify?</label>
        <textarea id="claim" value={claim} onChange={event => onClaim(event.target.value)} rows={4}/>
        <div className="policy-grid">
          <label><span>Distinct citations</span><select value={minCitations} onChange={event => onCitations(Number(event.target.value))} aria-label="Minimum distinct citations">{Array.from({ length: 10 }, (_, index) => index + 1).map(value => <option key={value} value={value}>{value}</option>)}</select></label>
          <div><span>Grounded sources</span><StatusBadge tone="success">Required</StatusBadge></div>
          <div><span>Hallucination gate</span><StatusBadge tone="success">Required</StatusBadge></div>
        </div>
        <label className="switch-row"><span><strong>Atomic claim decomposition</strong><small>Split complex work into independently verifiable assertions.</small></span><input type="checkbox" checked={decompose} onChange={event => onDecompose(event.target.checked)}/><i/></label>
        <div className="form-actions">
          <button type="button" className="button primary-button" disabled={posting || !config || claim.trim().length < 10} onClick={() => onStart('pool')}>{posting ? 'Starting…' : 'Start verification'}<span aria-hidden="true">↗</span></button>
          <div className="action-meta">{task ? `${task.slots.length} sellers · 2 judges each · ${formatSol(escrow)} SOL simulated` : '4 independent web researchers · 2 judges each · simulated settlement'}</div>
          <div className="secondary-actions"><button type="button" className="button secondary-button" disabled={posting || !config} onClick={() => onStart('fabricator')} title="Run an intentionally adversarial seller to test the verification gates.">Fabricator test</button><button type="button" className="button ghost-button" disabled={posting || !config} onClick={() => onStart('fabricator', false)} title="Run work without Cosign-controlled verification settlement for comparison.">Run unprotected ↗</button></div>
        </div>
      </Card>
      <SettlementCard task={task}/>
    </div>
    <Card className="pipeline-card"><SectionHeader icon="⌁" title="Protocol pipeline" subtitle="Workers produce. Judges verify. Cosign reconciles. Solana settles." aside={task && <button type="button" className="text-link" onClick={() => onNavigate('live')}>Open live run ↗</button>}/><StepProgress task={task}/></Card>
    <Card className="results-card">
      <div className="results-toolbar"><SegmentedTabs label="Run results" value={tab} onChange={setTab} items={[{ value: 'sellers', label: 'Seller pool', count: sellers.length }, { value: 'verdicts', label: 'Verdicts', count: task?.deliveries.filter(d => d.verification).length ?? 0 }, { value: 'disputes', label: 'Disputes', count: disputes.length }, { value: 'integrations', label: 'Integrations' }]}/>{task && <CopyableHash value={task.task_id} label="run ID"/>}</div>
      {tab === 'sellers' && (sellers.length ? <div className="seller-grid">{sellers.map(seller => <SellerCard key={seller.id} seller={seller} onInspect={() => onInspect(seller.deliveries[0]?.submission_id)}/>)}</div> : <EmptyState title="Ready for the first run" description="Set a claim and verification policy, then start verification."/>)}
      {tab === 'verdicts' && (task?.deliveries.some(d => d.verification) ? <div className="table-wrap"><table><thead><tr><th>Seller</th><th>Submitted verdict</th><th>Judge A</th><th>Judge B</th><th>Final</th><th/></tr></thead><tbody>{task.deliveries.map(delivery => <tr key={delivery.submission_id}><td>{sellerName(delivery.seller_id)}</td><td><VerdictBadge verdict={delivery.content.verdict}/></td><td>{delivery.verification ? delivery.verification.judge_a.pass ? 'Pass' : 'Fail' : 'Pending'}</td><td>{delivery.verification ? delivery.verification.judge_b.pass ? 'Pass' : 'Fail' : 'Pending'}</td><td><VerdictBadge verdict={delivery.verification ? delivery.verification.resolver_verdict.final_pass ? 'verified' : 'refuted' : 'pending'}/></td><td><button className="text-link" type="button" onClick={() => onInspect(delivery.submission_id)}>Inspect ↗</button></td></tr>)}</tbody></table></div> : <EmptyState title="No verdicts yet" description="Independent judge results appear after submissions pass the evidence gates."/>)}
      {tab === 'disputes' && (disputes.length ? <div className="dispute-grid">{disputes.map(delivery => <article key={delivery.submission_id}><VerdictBadge verdict="payment blocked"/><h3>{sellerName(delivery.seller_id)}</h3><p>{delivery.dispute?.delta}</p><button type="button" className="text-link" onClick={() => onInspect(delivery.submission_id)}>Inspect evidence ↗</button></article>)}</div> : <EmptyState title="No active disputes" description="Failed criteria and refund evidence will appear here."/>)}
      {tab === 'integrations' && <IntegrationsPanel config={config} task={task}/>} 
    </Card>
    <div className="bottom-grid"><Card><SectionHeader icon="≋" title="Claim reconciliation" subtitle="Resolved from accepted evidence, not majority voting"/>{task?.sub_claims.length ? <div className="claim-list">{task.sub_claims.map((subClaim, index) => <div key={subClaim.sub_claim_id}><span>{String(index + 1).padStart(2, '0')}</span><p>{subClaim.text}</p><VerdictBadge verdict={subClaim.resolution?.verdict ?? subClaim.reconciled_verdict}/></div>)}</div> : <EmptyState title="No atomic claims yet" description="Reconciliation starts after seller submissions are independently reviewed."/>}</Card><Card><SectionHeader icon="◌" title="Live activity" subtitle={`${task?.activity.length ?? 0} recorded events`}/><ActivityFeed events={task?.activity} limit={7}/></Card></div>
  </>;
}

function IntegrationsPanel({ config, task }: { config?: Config; task?: Task }) {
  if (!config) return <LoadingState/>;
  return <div className="integrations-grid">{Object.entries(config.services).map(([name, state]) => {
    const receipts = task?.evidence.filter(item => item.service === name) ?? [];
    const live = state.configured && !state.mocked;
    return <article key={name}><div><strong>{name}</strong><StatusBadge tone={state.mocked ? 'warning' : live ? 'success' : 'neutral'}>{state.mocked ? 'Simulated' : live ? 'Configured' : 'Not configured'}</StatusBadge></div><p>{state.mocked ? 'Settlement calculation only; no network transaction.' : live ? 'Configured for server-side runtime calls.' : state.optional ? 'Optional for this verification path.' : 'Required before a live run can start.'}</p><small>{receipts.filter(item => item.ok && !item.mocked).length} confirmed live calls</small></article>;
  })}<div className="integration-footnote">Live agents never fall back to fixtures. Demo Replay is the only fixture-backed mode.</div></div>;
}

export function LiveRunPage({ task, onNavigate, onInspect }: { task?: Task; onNavigate: Navigate; onInspect: (id: string) => void }) {
  const [mode, setMode] = useState<'graph' | 'list'>('graph');
  const sellers = sellerViewModels(task);
  const settlement = deriveSettlement(task);
  return <>
    <MountainHero eyebrow="VERIFICATION RUN" title={task?.phase === 'complete' ? 'Verification' : 'Verification in'} accent={task?.phase === 'complete' ? 'complete.' : 'progress.'} subtitle="Two independent judges are evaluating seller submissions. Grounded evidence. No payment on a promise." status={<StatusBadge tone={task?.phase === 'complete' ? 'success' : 'primary'}>{task?.phase === 'complete' ? 'Complete' : 'In progress'}</StatusBadge>}><ProtocolPillars/></MountainHero>
    <Card className="pipeline-card"><StepProgress task={task}/></Card>
    {!task ? <Card><EmptyState title="No active verification" description="Start a run from the Verification Desk or load a recorded replay." action={<button type="button" className="button primary-button" onClick={() => onNavigate('desk')}>Go to Verification Desk</button>}/></Card> : <div className="live-layout">
      <div className="live-main">
        <Card><SectionHeader icon="▤" title="Run overview" aside={<CopyableHash value={task.task_id} label="run ID"/>}/><p className="run-claim">{task.claim}</p><div className="meta-chips"><span>{task.acceptance_criteria.min_citations} citations</span><span>✓ Grounded sources</span><span>✓ Hallucination check</span><span>{task.deliveries.length} seller submissions</span></div><dl className="overview-meta"><dt>Started</dt><dd>{formatDate(task.created_at)}</dd><dt>Execution</dt><dd>{task.request.execution_mode === 'live' ? 'Live agents' : 'Demo replay'}</dd><dt>Settlement</dt><dd>Simulated · no chain transaction</dd></dl></Card>
        <Card className="flow-card"><SectionHeader icon="⌁" title="Verification flow" subtitle="Every submission is evaluated independently by two judges" aside={<SegmentedTabs label="Flow view" value={mode} onChange={setMode} items={[{ value: 'graph', label: 'Graph view' }, { value: 'list', label: 'List view' }]}/>}/>
          {mode === 'graph' ? <VerificationFlow task={task} sellers={sellers} onInspect={onInspect}/> : <div className="flow-list">{sellers.map(seller => <SellerCard key={seller.id} seller={seller} onInspect={() => onInspect(seller.deliveries[0]?.submission_id)}/>)}</div>}
        </Card>
      </div>
      <aside className="live-aside"><Card className="sticky-card"><SectionHeader icon="▤" title="Settlement summary" aside={<VerdictBadge verdict={task.phase === 'complete' ? 'settled' : task.status}/>}/><MoneyDisplay amount={settlement.total} asset="SOL" label="in escrow" large/><div className="settlement-bar"><i style={{ width: `${settlement.total ? settlement.released / settlement.total * 100 : 0}%` }}/><b style={{ width: `${settlement.total ? settlement.returned / settlement.total * 100 : 0}%` }}/></div><div className="aside-stat"><span><i className="legend-dot success"/>Releasable</span><strong>{formatSol(settlement.released)} SOL</strong></div><div className="aside-stat"><span><i className="legend-dot primary"/>Protected & returnable</span><strong>{formatSol(settlement.protected)} SOL</strong></div><div className="aside-stat"><span><i className="legend-dot danger"/>Returned</span><strong>{formatSol(settlement.returned)} SOL</strong></div><div className="trust-note"><span>▣</span><p><strong>Payment stays protected</strong><small>Release requires independently verified work.</small></p></div></Card><Card><SectionHeader icon="◌" title="Live activity" aside={<span className="muted-label">{task.activity.length} events</span>}/><ActivityFeed events={task.activity} limit={10}/></Card></aside>
    </div>}
  </>;
}

function VerificationFlow({ task, sellers, onInspect }: { task: Task; sellers: SellerViewModel[]; onInspect: (id: string) => void }) {
  const active = task.phase !== 'complete';
  return <div className="flow-graph">
    <div className="flow-column claim-node"><small>Claim</small><article><span>▤</span><strong>The claim</strong><p>{task.claim}</p><StatusBadge tone="primary">{task.acceptance_criteria.min_citations} citations</StatusBadge></article></div>
    <div className="flow-arrow" aria-hidden="true">→</div>
    <div className="flow-column sellers-node"><small>Seller submissions</small>{sellers.map(seller => <button type="button" key={seller.id} onClick={() => seller.deliveries[0] && onInspect(seller.deliveries[0].submission_id)} disabled={!seller.deliveries.length} className={seller.tone}><span className="agent-mark">{seller.mark}</span><p><strong>{seller.name}</strong><small>{seller.submissionCount} submission{seller.submissionCount === 1 ? '' : 's'}</small></p><VerdictBadge verdict={seller.paymentLabel}/></button>)}</div>
    <div className="flow-arrow" aria-hidden="true">→</div>
    <div className="flow-column judges-node"><small>Independent judges</small>{['A', 'B'].map(which => <article key={which} className={task.phase === 'verify' ? 'active-node' : ''}><span>♙</span><p><strong>Judge {which}</strong><small>{task.deliveries.some(d => d.verification) ? 'Evidence evaluated' : active ? 'Awaiting evidence' : 'Complete'}</small></p></article>)}</div>
    <div className="flow-arrow" aria-hidden="true">→</div>
    <div className="flow-column final-nodes"><small>Resolve & settle</small><article className={task.phase === 'reconcile' ? 'active-node' : ''}><span>≋</span><strong>Reconcile</strong><small>{task.parent_verdict ? finalVerdict(task) : 'Aggregate judgments'}</small></article><article className={task.phase === 'settle' ? 'active-node' : ''}><span>▤</span><strong>Settle</strong><small>{task.phase === 'complete' ? 'Complete' : 'Awaiting outcome'}</small></article></div>
  </div>;
}

export function EvidencePage({ task, activeDeliveryId, onDelivery, onNavigate }: { task?: Task; activeDeliveryId?: string; onDelivery: (id: string) => void; onNavigate: Navigate }) {
  const [rawOpen, setRawOpen] = useState(false);
  const delivery = task?.deliveries.find(item => item.submission_id === activeDeliveryId) ?? task?.deliveries[0];
  const verification = delivery?.verification;
  const references = verification?.grounding_check.references ?? [];
  const sources = delivery?.content.sources ?? [];
  const seller = delivery ? sellerName(delivery.seller_id) : 'No seller selected';
  if (!task || !delivery) return <><MountainHero eyebrow="EVIDENCE INSPECTOR" title="Inspect the" accent="evidence." subtitle="See exactly why a submission passed or failed. Grounded evidence. Independent judging. Verifiable outcomes."/><Card><EmptyState title="No evidence to inspect" description="Open a seller submission from a verification run." action={<button className="button primary-button" type="button" onClick={() => onNavigate('desk')}>Go to Verification Desk</button>}/></Card></>;
  return <>
    <MountainHero eyebrow="EVIDENCE INSPECTOR" title="Inspect the" accent="evidence." subtitle="See exactly why a submission passed or failed. Grounded evidence. Independent judging. Verifiable outcomes."><ProtocolPillars/></MountainHero>
    <Card className="claim-summary"><span className="summary-index">01</span><div><small>Seller claim</small><h2>{task.claim}</h2><p><label className="submission-picker">Submission <select value={delivery.submission_id} onChange={event => onDelivery(event.target.value)}>{task.deliveries.map(item => <option key={item.submission_id} value={item.submission_id}>{sellerName(item.seller_id)}</option>)}</select></label><span>Submitted {formatDate(task.created_at)}</span><CopyableHash value={delivery.submission_id} label="submission ID"/></p></div><div className="claim-verdict"><VerdictBadge verdict={verification ? verification.resolver_verdict.final_pass ? 'verified' : 'refuted' : 'pending'}/><small>{verification?.resolver_verdict.reasoning ?? 'Independent review has not completed.'}</small></div></Card>
    <div className="evidence-layout">
      <Card className="submission-panel"><SectionHeader icon="▤" title="Seller submission" subtitle="What the worker provided" aside={<button type="button" className="text-link" onClick={() => setRawOpen(true)}>View raw ↗</button>}/><label className="field-label">Claim statement</label><blockquote>{task.sub_claims.find(item => item.sub_claim_id === delivery.sub_claim_id)?.text ?? task.claim}</blockquote><p>{delivery.content.summary ?? delivery.content.reasoning}</p><dl className="details-list"><dt>Submitter</dt><dd>{seller}</dd><dt>Submitted</dt><dd>{formatDate(task.created_at)}</dd><dt>Execution</dt><dd>{task.request.execution_mode === 'live' ? 'Live web research' : 'Demo replay'}</dd><dt>Submission</dt><dd><CopyableHash value={delivery.submission_id} label="submission ID"/></dd></dl><div className="materials"><h3>Supporting sources <span>{sources.length}</span></h3>{sources.length ? sources.map((source, index) => <a key={`${source.url}-${index}`} href={source.url} target="_blank" rel="noreferrer"><span>▤</span><p><strong>{references.find(ref => ref.url === source.url)?.title ?? source.title ?? new URL(source.url).hostname}</strong><small>{shortId(source.url, 30, 10)}</small></p><b>↗</b></a>) : <EmptyState title="No supporting sources" description="This submission did not include evidence."/>}</div></Card>
      <Card className="atomic-panel"><SectionHeader icon="◎" title="Atomic claim and evidence" subtitle="This submission's claim is evaluated independently" aside={<span className="muted-label">1 claim</span>}/>{(task.sub_claims.filter(claim => claim.sub_claim_id === delivery.sub_claim_id).length ? task.sub_claims.filter(claim => claim.sub_claim_id === delivery.sub_claim_id) : [{ sub_claim_id: task.task_id, text: task.claim }]).map((claim, index) => <details key={claim.sub_claim_id} open><summary><span>{String(index + 1).padStart(2, '0')}</span><strong>{claim.text}</strong><VerdictBadge verdict={verification ? verification.resolver_verdict.final_pass ? 'supported' : 'not supported' : 'pending'}/><i>⌄</i></summary><div className="atomic-body">{verification?.failed_criteria.length ? <div className="reason-box danger">{verification.failed_criteria.map(describeCriterion).join(' · ')}</div> : <div className="reason-box success">{verification?.resolver_verdict.reasoning ?? 'Review is still pending.'}</div>}<h3>Cited sources ({sources.length})</h3>{sources.map((source, sourceIndex) => {
          const citations = verification?.grounding_check.citations ?? [];
          const occurrence = sources.slice(0, sourceIndex).filter(s => s.url === source.url).length;
          const citation = citations.find(c => c.url === source.url && c.quote === source.quote)
            ?? citations.filter(c => c.url === source.url)[occurrence];
          const reference = references.find(ref => ref.url === source.url);
          return <article className="evidence-source" key={`${source.url}-${sourceIndex}`}><span>▤</span><div><div><strong>{reference?.title ?? source.title ?? new URL(source.url).hostname}</strong><StatusBadge tone={citation?.supports_verdict ? 'success' : citation ? 'danger' : 'neutral'}>{citation?.supports_verdict ? 'Supports' : citation ? 'Not supported' : 'Pending'}</StatusBadge></div><blockquote>“{source.quote}”</blockquote>{reference && <small>{reference.publisher ?? new URL(source.url).hostname} · retrieved {formatDate(reference.retrieved_at)} · {reference.content_hash ? `SHA-256 ${shortId(reference.content_hash, 12, 8)}` : 'hash pending'}</small>}{citation?.entailment_reasoning && <p>{citation.entailment_reasoning}</p>}</div><a href={source.url} target="_blank" rel="noreferrer" aria-label="Open source">↗</a></article>;
        })}</div></details>)}</Card>
      <Card className="judge-panel"><SectionHeader icon="◎" title="Judge opinions" subtitle="Independent evaluation from two agents"/>{verification ? <>{([['A', verification.judge_a], ['B', verification.judge_b]] as const).map(([name, judge]) => <article className="judge-card" key={name}><div><span className="agent-mark">{name === 'A' ? '◆' : '●'}</span><p><strong>Judge {name}</strong><small>{name === 'A' ? 'Factual accuracy' : 'Evidence audit'}</small></p><VerdictBadge verdict={judge.pass ? 'verified' : 'refuted'}/></div><blockquote>“{judge.reasoning}”</blockquote><footer><StatusBadge tone="success">Grounded</StatusBadge><span>{sources.length} citations</span><span>{Math.round(judge.score * 100)}% confidence</span></footer></article>)}<article className="reconciliation-card"><div><span>≋</span><p><strong>Reconciliation</strong><small>Evidence + judge policy</small></p><VerdictBadge verdict={verification.resolver_verdict.final_pass ? 'verified' : 'refuted'}/></div><p>{verification.resolver_verdict.reasoning}</p></article></> : <EmptyState title="Judges are evaluating" description="Independent opinions will appear together when the review batch completes."/>}</Card>
    </div>
    <Card className="outcome-bar"><SectionHeader icon="▤" title="Settlement outcome" subtitle={verification?.resolver_verdict.final_pass ? 'Payment eligible for release.' : verification ? 'Payment blocked by failed verification.' : 'Settlement waits for verification.'}/><div><VerdictBadge verdict={task.slots.find(slot => slot.seller_id === delivery.seller_id)?.state ?? 'pending'}/><MoneyDisplay amount={task.payment_amount_sol} asset="SOL"/></div><SolanaLink href={task.slots.find(slot => slot.seller_id === delivery.seller_id)?.receipt?.explorer_url}/></Card>
    <Modal title="Raw blinded submission" open={rawOpen} onClose={() => setRawOpen(false)}><pre>{JSON.stringify(blindSubmission(task.sub_claims.find(claim => claim.sub_claim_id === delivery.sub_claim_id)?.text ?? task.claim, task.acceptance_criteria, delivery.content, task.slots.flatMap(slot => [slot.seller_id, slot.address])), null, 2)}</pre></Modal>
  </>;
}

export function ReceiptPage({ task, onNavigate }: { task?: Task; onNavigate: Navigate }) {
  if (!task || task.phase !== 'complete') return <><MountainHero eyebrow="SETTLEMENT RECEIPT" title="Good work gets" accent="paid." subtitle="Final, auditable, reproducible. Completed verification becomes a settlement artifact."/><Card><EmptyState title="No completed receipt yet" description={task ? 'This run is still in progress. Its receipt will appear after settlement.' : 'Complete a verification run or load the recorded replay.'} action={<button type="button" className="button primary-button" onClick={() => onNavigate(task ? 'live' : 'desk')}>{task ? 'View live run' : 'Start verification'}</button>}/></Card></>;
  const settlement = deriveSettlement(task);
  const sellers = sellerViewModels(task);
  const counts = deriveVerificationCounts(task);
  const receipt = receiptForTask(task);
  const evidenceHash = task.receipts.find(item => item.evidence_hash)?.evidence_hash;
  return <>
    <MountainHero eyebrow="SETTLEMENT RECEIPT" title="Good work gets" accent="paid." subtitle="Final, auditable, reproducible. This verification is complete and settled."/>
    <div className="receipt-layout"><div className="receipt-main">
      <Card className="receipt-heading"><div><h2>{task.claim}</h2><p>Run ID <CopyableHash value={task.task_id} label="run ID"/> · Completed {formatDate(task.completed_at)} · <StatusBadge tone={task.service_modes.solana ? 'warning' : 'primary'}>{task.service_modes.solana ? 'Mock devnet' : 'Devnet'}</StatusBadge></p></div><VerdictBadge verdict={finalVerdict(task)}/><div className="receipt-stats"><article><span>▤</span><div className="stat-copy"><small>Total escrowed</small><MoneyDisplay amount={settlement.total}/></div></article><article><span>◎</span><div className="stat-copy"><small>Released to agents</small><MoneyDisplay amount={settlement.released}/></div></article><article><span>↺</span><div className="stat-copy"><small>Returned to buyer</small><MoneyDisplay amount={settlement.returned}/></div></article><article><span>✓</span><div className="stat-copy"><small>Final verdict</small><strong>{finalVerdict(task)}</strong></div></article></div></Card>
      <Card><SectionHeader title="Agent settlements" subtitle={`${sellers.length} agents participated · ${sellers.filter(s => s.slot.state === 'paid').length} paid · ${sellers.filter(s => s.slot.state === 'refunded').length} refunded`}/><div className="seller-grid receipt-sellers">{sellers.map(seller => <SellerCard key={seller.id} seller={seller}/>)}</div></Card>
      <Card><SectionHeader title="Verification summary"/><div className="verification-summary"><article><span>▤</span><p><strong>Source grounding</strong><small>{counts.grounded} / {counts.sellers} agents passed</small></p></article><article><span>▣</span><p><strong>Hallucination gate</strong><small>{counts.hallucination} / {counts.sellers} agents passed</small></p></article><article><span>◎</span><p><strong>Final verification</strong><small>{counts.verified} / {counts.sellers} agents passed</small></p></article><article><span>✓</span><p><strong>Judge agreements</strong><small>{counts.judgeAgreements} / {counts.judged} submissions</small></p></article></div></Card>
      <Card><SectionHeader title="Verification timeline" subtitle={`Completed ${formatDate(task.completed_at)}`}/><StepProgress task={task} compact/></Card>
    </div><aside className="receipt-aside"><Card className="sticky-card onchain-card"><SectionHeader title="Verification receipt" subtitle="Final, auditable, reproducible" aside={<StatusBadge tone="warning">Simulated settlement</StatusBadge>}/><dl className="receipt-fields"><dt>Receipt ID</dt><dd><CopyableHash value={receipt?.signature} label="receipt ID"/></dd><dt>Run ID</dt><dd><CopyableHash value={task.task_id} label="run ID"/></dd><dt>Settlement record</dt><dd><CopyableHash value={receipt?.signature} label="settlement record"/></dd><dt>Evidence commitment</dt><dd><CopyableHash value={evidenceHash} label="evidence commitment"/></dd><dt>Timestamp</dt><dd>{formatDate(task.completed_at)}</dd><dt>Network</dt><dd>None · simulated locally</dd></dl><div className="immutable-note"><span>▣</span><p><strong>Reproducible verification receipt</strong><small>This audit artifact records a simulated settlement and never claims an on-chain transfer.</small></p></div><DownloadButton filename={`cosign-receipt-${task.task_id}.json`} data={receiptPayload(task)}>Download receipt</DownloadButton></Card></aside></div>
  </>;
}

export function ReplayPage({ cached, task, tasks, onReplay, onSelect }: { cached?: Task; task?: Task; tasks: TaskSummary[]; onReplay: () => void; onSelect: (id: string) => void }) {
  const featured = cached;
  const settlement = deriveSettlement(featured);
  const outcome = finalVerdict(featured);
  return <>
    <MountainHero eyebrow="DEMO REPLAY" title="Replay the" accent="protocol." subtitle="Explore recorded verification scenarios. Replay real runs, inspect how agents reason, and see how Cosign handles adversarial work."><ProtocolPillars/></MountainHero>
    {featured ? <Card className="featured-replay"><div className="featured-copy"><StatusBadge tone="primary">★ Featured replay</StatusBadge><h2>Fabricator caught</h2><p>Watch independent agents detect fabricated sources, fail verification, and block payment to unsupported work.</p><div className="replay-tags"><StatusBadge tone="danger">{outcome}</StatusBadge><span>Source fraud</span><span>Hallucination gate</span><span>Payment protected</span></div><div className="replay-meta"><div><span>▤</span><p><strong>{formatSol(settlement.total)} SOL</strong><small>In escrow</small></p></div><div><span>◎</span><p><strong>{featured.slots.length} agents</strong><small>{featured.slots.map(slot => sellerName(slot.seller_id).replace('Agent ', '')).join(', ')}</small></p></div><div><span>◌</span><p><strong>{featured.activity.length} events</strong><small>Recorded protocol run</small></p></div></div><button type="button" className="button primary-button" onClick={onReplay}>Replay run <span>↗</span></button></div><div className="replay-visual"><div className="mini-window"><header><span/><span/><span/></header><div><aside/><main><i/><i/><i/><section/><footer/></main></div></div><button type="button" onClick={onReplay} aria-label="Replay featured run">▶</button><time>{featured.completed_at ? 'Recorded' : 'Fixture'}</time></div></Card> : <Card><LoadingState/></Card>}
    <Card className="replay-library"><SectionHeader title="Recorded runs" subtitle="Only real local task history and isolated demo fixtures are shown"/><div className="replay-cards">{tasks.length ? tasks.map(summary => <article key={summary.task_id} className={summary.status === 'paid' ? 'success' : summary.status === 'refunded' ? 'danger' : 'neutral'}><VerdictBadge verdict={summary.status}/><h3>{summary.claim}</h3><p>{shortId(summary.task_id)} · {formatDate(summary.created_at, false)}</p><div><span>{formatSol(summary.paid_sol + summary.refunded_sol)} SOL settled</span><button type="button" onClick={() => onSelect(summary.task_id)}>Open run ↗</button></div></article>) : <EmptyState title="No local runs yet" description="Use the featured fixture or start a new verification from the desk."/>}</div></Card>
    {task && <div className="replay-now"><span className="status-dot"/><p><strong>Now replaying:</strong> {task.claim}</p><VerdictBadge verdict={task.phase}/></div>}
  </>;
}
