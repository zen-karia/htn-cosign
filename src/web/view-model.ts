import type { Delivery, Receipt, SellerSlot, Task, ReferenceDocument } from '../core/models';

export const protocolPhases: Task['phase'][] = ['initialize', 'decompose', 'sellers', 'verify', 'reconcile', 'settle', 'complete'];

export type StepState = 'pending' | 'active' | 'complete' | 'failed';
export interface ProtocolStep {
  id: Task['phase'];
  label: string;
  state: StepState;
  note: string;
}

const labels: Record<Task['phase'], string> = {
  classify: 'Classify',
  initialize: 'Initialize',
  decompose: 'Decompose',
  sellers: 'Sellers',
  verify: 'Verify',
  reconcile: 'Reconcile',
  settle: 'Settle',
  complete: 'Complete',
};

export function deriveProtocolSteps(task?: Task): ProtocolStep[] {
  if (!task) return protocolPhases.map(id => ({ id, label: labels[id], state: 'pending', note: 'Pending' }));
  const current = protocolPhases.indexOf(task.phase === 'classify' ? 'initialize' : task.phase);
  return protocolPhases.map((id, index) => {
    const bypassed = id === 'verify' && !task.request.protected;
    if (task.status === 'stalled' && index === current) return { id, label: labels[id], state: 'failed', note: 'Needs attention' };
    if (task.phase === 'complete' || index < current) return { id, label: labels[id], state: 'complete', note: bypassed ? 'Bypassed' : 'Done' };
    if (index === current) return { id, label: labels[id], state: 'active', note: 'In progress' };
    return { id, label: labels[id], state: 'pending', note: bypassed ? 'Will bypass' : 'Pending' };
  });
}

export interface SettlementSummary {
  total: number;
  released: number;
  protected: number;
  returned: number;
  pending: number;
  asset: 'SOL';
}

export function deriveSettlement(task?: Task): SettlementSummary {
  const total = task ? task.payment_amount_sol * task.slots.length : 0;
  const released = task?.paid_sol ?? 0;
  const returned = task?.refunded_sol ?? 0;
  const pending = Math.max(0, task?.locked_sol ?? 0);
  return { total, released, protected: returned + pending, returned, pending, asset: 'SOL' };
}

export type SellerTone = 'success' | 'danger' | 'warning' | 'neutral';
export interface SellerViewModel {
  id: string;
  name: string;
  mark: string;
  slot: SellerSlot;
  deliveries: Delivery[];
  submissionCount: number;
  verdict: string;
  paymentLabel: string;
  tone: SellerTone;
  groundingPassed?: boolean;
  hallucinationPassed?: boolean;
  verificationPassed?: boolean;
  amount: number;
  settlementNote?: string;
}

const marks = ['◆', '◇', '▧', '●', '◈', '◉'];
export function sellerName(id: string) {
  return id.replace(/^research-agent-/, 'Research Agent ').replace(/^agent-/, 'Agent ').replace(/\b\w/g, char => char.toUpperCase());
}

export function sellerViewModels(task?: Task): SellerViewModel[] {
  if (!task) return [];
  return task.slots.map((slot, index) => {
    const deliveries = task.deliveries.filter(delivery => delivery.seller_id === slot.seller_id);
    const verifications = deliveries.map(delivery => delivery.verification).filter(Boolean);
    // Blocked means nothing survived review. Marking a seller blocked because one of its sub-claims
    // failed turned every partly successful seller red mid-run, then green again at settlement.
    const reviewed = deliveries.filter(delivery => delivery.verification);
    const failed = deliveries.length > 0 && reviewed.length === deliveries.length && reviewed.every(delivery => !delivery.verification!.resolver_verdict.final_pass);
    const someVerified = reviewed.some(delivery => delivery.verification!.resolver_verdict.final_pass);
    const pending = deliveries.length === 0 || verifications.length < deliveries.length;
    // A seller paid for only some of its sub-claims is neither a clean pass nor a rejection.
    const partial = slot.state === 'paid' && slot.total_units !== undefined && slot.verified_units !== undefined && slot.verified_units < slot.total_units;
    const released = slot.released_sol ?? (slot.state === 'paid' ? task.payment_amount_sol : 0);
    const returned = slot.returned_sol ?? (slot.state === 'refunded' ? task.payment_amount_sol : 0);
    const tone: SellerTone = partial ? 'warning' : slot.state === 'paid' ? 'success' : pending ? 'neutral' : slot.state === 'refunded' || failed ? 'danger' : someVerified ? 'warning' : 'success';
    return {
      id: slot.seller_id,
      name: sellerName(slot.seller_id),
      mark: marks[index % marks.length],
      slot,
      deliveries,
      submissionCount: deliveries.length,
      verdict: deliveries[0]?.content.verdict.replaceAll('_', ' ') ?? 'Awaiting submission',
      paymentLabel: slot.state === 'paid' ? (partial ? 'Partly paid' : 'Paid') : slot.state === 'refunded' ? 'Refunded' : pending ? (deliveries.length ? `In review (${reviewed.length} of ${deliveries.length})` : 'Pending') : failed ? 'Blocked' : someVerified ? 'Partly verified' : 'Verified',
      tone,
      groundingPassed: verifications.length ? verifications.every(result => result!.grounding_check.unsupported_claims.length === 0) : undefined,
      hallucinationPassed: verifications.length ? verifications.every(result => !result!.hallucination_check.flagged) : undefined,
      verificationPassed: verifications.length ? verifications.every(result => result!.resolver_verdict.final_pass) : undefined,
      // Show what this slot actually settled, not the allocation it started with.
      amount: slot.state === 'paid' ? released : slot.state === 'refunded' ? returned : 0,
      settlementNote: partial ? `${slot.verified_units} of ${slot.total_units} sub-claims verified` : undefined,
    };
  });
}

export interface VerificationCounts {
  sellers: number;
  grounded: number;
  hallucination: number;
  verified: number;
  judgeAgreements: number;
  judged: number;
}

export function deriveVerificationCounts(task?: Task): VerificationCounts {
  const sellers = sellerViewModels(task);
  const judgedDeliveries = task?.deliveries.filter(delivery => delivery.verification) ?? [];
  return {
    sellers: sellers.length,
    grounded: sellers.filter(seller => seller.groundingPassed).length,
    hallucination: sellers.filter(seller => seller.hallucinationPassed).length,
    verified: sellers.filter(seller => seller.verificationPassed).length,
    judgeAgreements: judgedDeliveries.filter(delivery => delivery.verification?.agreement).length,
    judged: judgedDeliveries.length,
  };
}

export function finalVerdict(task?: Task) {
  if (!task) return 'pending';
  if (task.phase !== 'complete' && !task.parent_verdict) return task.status === 'stalled' ? 'stalled' : 'in progress';
  return (task.parent_verdict ?? (task.paid_sol > 0 ? 'supported' : 'insufficient_evidence')).replaceAll('_', ' ');
}

export function receiptForTask(task?: Task): Receipt | undefined {
  return task?.receipts.find(receipt => receipt.operation !== 'initialize' && !receipt.mocked)
    ?? task?.receipts.find(receipt => receipt.operation !== 'initialize')
    ?? task?.receipts.at(-1);
}

export function shortId(value?: string, lead = 8, tail = 5) {
  if (!value) return 'Not recorded';
  if (value.length <= lead + tail + 1) return value;
  return `${value.slice(0, lead)}…${value.slice(-tail)}`;
}

export function formatSol(amount = 0) {
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(amount);
}

export function formatDate(value?: string, includeTime = true) {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  return new Intl.DateTimeFormat('en-US', includeTime
    ? { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short' }
    : { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

export function receiptPayload(task: Task) {
  return {
    receipt_version: 'cosign/v1',
    task_id: task.task_id,
    claim: task.claim,
    verdict: finalVerdict(task),
    network: task.service_modes.solana ? 'Simulation only' : 'Solana Devnet',
    mocked: task.service_modes.solana,
    created_at: task.created_at,
    completed_at: task.completed_at,
    settlement: deriveSettlement(task),
    sellers: sellerViewModels(task).map(seller => ({ id: seller.id, state: seller.slot.state, amount_sol: seller.amount, receipt: seller.slot.receipt })),
    receipts: task.receipts,
  };
}

// The quota counts independent sources, so the evidence view must show the same unit. Quotes are
// still checked one by one underneath; they are grouped under the source they came from.
export interface CitedSource {
  url: string; title?: string; publisher?: string; retrieved_at?: string; content_hash?: string;
  status: 'supports' | 'not supported' | 'missing' | 'unretrievable' | 'pending';
  quotes: { quote: string; entailment?: string; supported?: boolean }[];
}
export function citedSources(delivery?: Delivery, references: ReferenceDocument[] = []): CitedSource[] {
  const sources = delivery?.content.sources ?? [];
  const citations = delivery?.verification?.grounding_check.citations ?? [];
  const grouped = new Map<string, CitedSource>();
  sources.forEach((source, index) => {
    const occurrence = sources.slice(0, index).filter(other => other.url === source.url).length;
    const citation = citations.find(c => c.url === source.url && c.quote === source.quote)
      ?? citations.filter(c => c.url === source.url)[occurrence];
    const reference = references.find(item => item.url === source.url);
    const entry = grouped.get(source.url) ?? {
      url: source.url, title: reference?.title ?? source.title, publisher: reference?.publisher,
      retrieved_at: reference?.retrieved_at, content_hash: reference?.content_hash,
      status: 'pending' as CitedSource['status'], quotes: [],
    };
    entry.quotes.push({ quote: source.quote, entailment: citation?.entailment_reasoning, supported: citation?.supports_verdict });
    // A source counts when any passage from it held up. Otherwise say which kind of failure it was:
    // a page that does not exist is fabrication, and must not read like an unhelpful citation.
    if (citation?.supports_verdict) entry.status = 'supports';
    else if (entry.status === 'supports') { /* one passage holding up settles it */ }
    else if (citation?.status === 'nonexistent') entry.status = 'missing';
    else if (citation?.status === 'unverifiable') entry.status = 'unretrievable';
    else if (citation) entry.status = 'not supported';
    grouped.set(source.url, entry);
  });
  return [...grouped.values()];
}
