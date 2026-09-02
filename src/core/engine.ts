import { blindSubmission } from './blind';
import { TaskRequest, Submission, mockEnabled, type Task, type Settings, type Delivery, type SubClaim, type Receipt } from './models';
import { verify, type VerificationServices } from './verify';
import { agentFor } from './agents';
import { profiles, produce } from '../harness/sellers';
import { Runtime } from '../services/runtime';
import { Models } from '../services/models';
import { Grounding } from '../services/grounding';
import { Hallucination } from '../services/hallucination';
import { Escrow, digest, type EscrowService } from '../services/escrow';
import { EvidenceRetriever, canonicalUrl } from '../services/evidence';

export type Save = (task: Task) => Promise<void>;
export type Span = <T>(name: string, action: () => Promise<T>) => Promise<T>;
const shuffled = <T>(items: T[]) => {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) { const bytes = crypto.getRandomValues(new Uint32Array(1)); const j = bytes[0] % (i + 1); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
};
export function createTask(raw: unknown, env: Settings, id: string = crypto.randomUUID()): Task {
  const request = TaskRequest.parse(raw);
  const live = request.execution_mode === 'live';
  const selected = live
    ? Array.from({ length: request.seller_count }, (_, index) => ({ seller_id: `research-agent-${index + 1}`, behavior: 'uninstructed' as const }))
    : request.scenario === 'pool' ? profiles : profiles.filter(p => p.behavior === request.scenario);
  const addresses = JSON.parse(env.SOLANA_SELLER_ADDRESSES || '{}') as Record<string, string>;
  const serviceModes = live
    ? { openai: false, gptzero: !env.GPTZERO_API_KEY, elasticsearch: false, evidence: false, solana: true, sentry: mockEnabled(env, 'sentry') }
    : { openai: mockEnabled(env, 'openai'), gptzero: mockEnabled(env, 'gptzero'), elasticsearch: mockEnabled(env, 'elasticsearch'), evidence: true, solana: true, sentry: mockEnabled(env, 'sentry') };
  return {
    task_id: id, task_type: request.task_type, buyer_agent_id: 'buyer-agent', seller_agent_id: selected.length === 1 ? selected[0].seller_id : 'pool',
    claim: request.claim, payment_amount_sol: request.payment_amount_sol, acceptance_criteria: request.acceptance_criteria,
    status: 'posted', created_at: new Date().toISOString(), request,
    slots: selected.map(p => ({ seller_id: p.seller_id, address: addresses[p.seller_id] || `SIMULATED-${p.seller_id}`, state: 'pending' })),
    sub_claims: [], deliveries: [], receipts: [], activity: [{ id: 1, at: new Date().toISOString(), stage: 'run.created', message: `${live ? 'Live' : 'Replay'} verification run created.`, mocked: !live }], evidence: [], phase: live ? 'classify' : 'initialize', trace_id: crypto.randomUUID().replaceAll('-', ''),
    attempts: 0, running: false, refunded_sol: 0, paid_sol: 0, locked_sol: 0,
    service_modes: serviceModes, evidence_documents: [],
  };
}

export class Engine {
  readonly runtime: Runtime;
  readonly models: Models;
  readonly ground: Grounding;
  readonly evidenceRetriever: EvidenceRetriever;
  readonly verification: VerificationServices;
  readonly escrow: EscrowService;
  constructor(public task: Task, env: Settings, private save: Save, private span: Span = (_, f) => f(), escrow?: EscrowService) {
    task.evidence_documents ||= [];
    // Freeze service modes per task: a live escrow can never be marked refunded by a later mock toggle.
    const pinned = Object.fromEntries(Object.entries(task.service_modes).map(([s, mocked]) => [`MOCK_MODE_${s.toUpperCase()}`, String(mocked)]));
    const runIndex = task.request.execution_mode === 'live' ? `${env.ELASTICSEARCH_INDEX || 'cosign-evidence'}-${task.task_id.toLowerCase()}` : env.ELASTICSEARCH_INDEX;
    this.runtime = new Runtime({ ...env, ...pinned, ...(runIndex ? { ELASTICSEARCH_INDEX: runIndex } : {}) }, e => task.evidence.push(e));
    this.models = new Models(this.runtime);
    this.ground = new Grounding(this.runtime, this.models);
    // Rehydrated per alarm: the verify phase runs in a later invocation than retrieval.
    this.ground.retrievalFailures = task.retrieval_failures || {};
    this.evidenceRetriever = new EvidenceRetriever(this.runtime);
    this.escrow = escrow || new Escrow(this.runtime);
    this.verification = {
      grounding: i => this.ground.check(i),
      hallucination: i => task.request.execution_mode === 'live' && !env.GPTZERO_API_KEY
        ? Promise.resolve({ flagged: false, source: 'gptzero' as const, mocked: false, reasoning: 'GPTZero is not configured; optional bibliography scanning was skipped. Elastic retrieval and passage entailment remain binding.' })
        : new Hallucination(this.runtime).check(i),
      judge: (w, i, r) => this.models.judge(w, i, r), tiebreak: (i, j, r) => this.models.tiebreak(i, j, r), modelsMocked: this.runtime.mocked('openai'), span,
    };
  }
  async event(stage: string, message: string, mocked = false) {
    this.task.activity.push({ id: this.task.activity.length + 1, at: new Date().toISOString(), stage, message: `${mocked ? '[MOCKED] ' : ''}${message}`, mocked });
    await this.save(this.task);
  }
  private blind(delivery: Delivery) {
    const sub = this.task.sub_claims.find(s => s.sub_claim_id === delivery.sub_claim_id)!;
    return blindSubmission(sub.text, this.task.acceptance_criteria, delivery.content, [...this.task.slots.flatMap(s => [s.seller_id, s.address]), this.task.task_id, ...this.task.deliveries.map(d => d.submission_id), ...this.task.sub_claims.map(s => s.sub_claim_id)]);
  }
  async step(): Promise<void> {
    const task = this.task;
    if (task.phase === 'complete') return;
    if (task.status === 'stalled') task.status = ['classify', 'initialize', 'decompose', 'sellers'].includes(task.phase) ? 'posted' : task.phase === 'verify' ? 'verifying' : 'submitted';
    switch (task.phase) {
      case 'classify': {
        task.verifiability = await this.span('buyer.classify', () => this.models.classify(task.claim));
        if (task.verifiability.classification !== 'VERIFIABLE') {
          task.phase = 'complete'; task.status = 'refunded'; task.completed_at = new Date().toISOString();
          await this.event('run.rejected', `${task.verifiability.classification}: ${task.verifiability.reason}`);
          break;
        }
        task.phase = 'initialize';
        await this.event('claim.classified', `VERIFIABLE: ${task.verifiability.reason}`);
        break;
      }
      case 'initialize': {
        const receipt = await this.span('escrow.initialize', () => this.escrow.initialize(task));
        task.receipts.push(receipt); task.locked_sol = task.payment_amount_sol * task.slots.length;
        task.phase = 'decompose';
        await this.event('escrow.funded', `${task.locked_sol.toFixed(3)} SOL reserved across ${task.slots.length} simulated allocation(s).`, true);
        break;
      }
      case 'decompose': {
        const claims = task.request.decompose ? (await this.span('buyer.decompose', () => this.models.decompose(task.claim))).claims : [task.claim];
        task.sub_claims = claims.map(text => ({ sub_claim_id: crypto.randomUUID(), parent_task_id: task.task_id, text, assigned_seller_ids: task.slots.map(s => s.seller_id), verdicts: [], reconciled_verdict: 'insufficient_evidence' }));
        task.phase = 'sellers';
        await this.event('claims.decomposed', `${claims.length} atomic claim(s) assigned to ${task.slots.length} concurrent seller(s).`, task.request.decompose && this.runtime.mocked('openai'));
        break;
      }
      case 'sellers': {
        if (task.request.execution_mode === 'live') {
          for (const slot of task.slots) task.activity.push({ id: task.activity.length + 1, at: new Date().toISOString(), stage: 'seller.started', message: `${slot.seller_id} began independent web research.`, mocked: false });
          await this.save(task);
        }
        const references = task.request.execution_mode === 'live' ? task.sub_claims.map(() => [] as Awaited<ReturnType<Grounding['search']>>) : await Promise.all(task.sub_claims.map(s => this.ground.search(s.text)));
        const attempts = await Promise.allSettled(task.sub_claims.flatMap((sub, index) => task.slots.map(async (slot, sellerIndex) => {
          if (task.deliveries.some(d => d.sub_claim_id === sub.sub_claim_id && d.seller_id === slot.seller_id)) return;
          const profile = profiles.find(p => p.seller_id === slot.seller_id);
          const adversarial = task.request.execution_mode === 'live' && task.request.scenario === 'fabricator' && sellerIndex === 0;
          // Each slot gets a different model, research strategy and search budget; see core/agents.ts.
          const base = agentFor(sellerIndex, this.runtime.env.OPENAI_SELLER_MODELS);
          const agent = adversarial
            ? { ...base, lens: 'Act as a skeptical advocate: cherry-pick the strongest defensible counter-position, probe weaker sources, and test whether a confident conclusion overstates the evidence. Never invent a source, URL, quotation, or fact.' }
            : base;
          const content = Submission.parse(await this.span('seller.submit', () => task.request.execution_mode === 'live'
            ? this.models.researchSeller(sub.text, task.acceptance_criteria, agent)
            : produce(profile!.behavior, sub.text, task.acceptance_criteria, references[index], this.models)));
          if (task.request.execution_mode === 'live') content.sources = content.sources.map(source => ({ ...source, url: canonicalUrl(source.url) }));
          const delivery = { submission_id: crypto.randomUUID(), seller_id: slot.seller_id, sub_claim_id: sub.sub_claim_id, content };
          task.deliveries.push(delivery);
          if (task.request.execution_mode === 'live') {
            const { documents: docs, failures } = await this.evidenceRetriever.retrieve(content);
            task.retrieval_failures = { ...task.retrieval_failures, ...failures };
            this.ground.retrievalFailures = task.retrieval_failures;
            for (const doc of docs) {
              const existing = task.evidence_documents!.find(item => item.url === doc.url);
              if (existing) existing.seller_references = [...new Set([...(existing.seller_references || []), delivery.submission_id])];
              else task.evidence_documents!.push({ ...doc, seller_references: [delivery.submission_id] });
            }
          }
        })));
        attempts.forEach((result, attemptIndex) => {
          if (result.status === 'rejected') {
            const slot = task.slots[attemptIndex % task.slots.length]; slot.error = 'Seller research failed; its simulated allocation remains protected.';
            task.activity.push({ id: task.activity.length + 1, at: new Date().toISOString(), stage: 'seller.failed', message: `${slot.seller_id} did not return a valid research submission.`, mocked: false });
          }
        });
        if (task.request.execution_mode === 'live') {
          if (task.deliveries.length < 2) throw new Error('Fewer than two seller agents completed research.');
          await this.ground.indexDocuments(task.evidence_documents!);
          task.activity.push({ id: task.activity.length + 1, at: new Date().toISOString(), stage: 'source.retrieved', message: `${task.evidence_documents!.length} independently retrieved source(s) indexed for this run.${Object.keys(task.retrieval_failures || {}).length ? ` ${Object.keys(task.retrieval_failures!).length} cited source(s) could not be retrieved and are excluded rather than counted against any seller.` : ''}`, mocked: false });
          for (const delivery of task.deliveries) task.activity.push({ id: task.activity.length + 1, at: new Date().toISOString(), stage: 'seller.submitted', message: `${delivery.seller_id} submitted ${delivery.content.sources.length} citation(s); identity removed before review.`, mocked: false });
        }
        task.status = 'submitted'; task.phase = task.request.protected ? 'verify' : 'reconcile';
        await this.event('submissions.completed', `${task.deliveries.length} submissions received.${task.request.protected ? '' : ' UNPROTECTED: verification bypassed; every allocation will be paid.'}`);
        break;
      }
      case 'verify': {
        task.status = 'verifying'; await this.event('judge.started', 'Blind reviews started. Each submission is evaluated by two fresh independent judges.');
        // Four blind submissions per alarm bounds external subrequests even for 4 × 4 decomposition.
        const results = await Promise.allSettled(shuffled(task.deliveries.filter(d => !d.verification)).slice(0, 4).map(async delivery => {
          const input = this.blind(delivery);
          try {
            const result = await verify(input, this.verification);
            delivery.verification = { submission_id: delivery.submission_id, ...result }; delete delivery.error;
            if (!result.resolver_verdict.final_pass) delivery.dispute = {
              dispute_id: crypto.randomUUID(), task_id: task.task_id, submission_id: delivery.submission_id,
              authorization_scope: `Verify “${input.claim}” with rubric ${JSON.stringify(task.acceptance_criteria)}`,
              action_taken: `Submitted ${input.submission.verdict} with ${input.submission.sources.length} citation(s): ${input.submission.reasoning}`,
              delta: result.failed_criteria.join('; '), failed_criteria: result.failed_criteria, resolution: 'escalated',
            };
            await this.event('judge.completed', result.resolver_verdict.final_pass ? 'Both reviews and hard gates resolved to approval.' : `PAYMENT BLOCKED: ${result.failed_criteria.join('; ')}`, result.mocked);
          } catch (err) { delivery.error = 'Verification service unavailable; payment remains locked.'; await this.save(task); throw err; }
        }));
        const failed = results.find(r => r.status === 'rejected'); if (failed?.status === 'rejected') throw failed.reason;
        task.phase = task.deliveries.every(d => d.verification) ? 'reconcile' : 'verify'; await this.save(task); break;
      }
      case 'reconcile': {
        for (const sub of task.sub_claims) {
          const deliveries = task.deliveries.filter(d => d.sub_claim_id === sub.sub_claim_id);
          sub.verdicts = deliveries.map(d => ({ submission_id: d.submission_id, verdict: d.content.verdict, accepted: !!d.verification?.resolver_verdict.final_pass }));
          const distinct = new Set(sub.verdicts.map(v => v.verdict));
          if (distinct.size > 1) {
            sub.reconciled_verdict = 'contested';
            await this.event('contested', `Conflicting conclusions on “${sub.text}”. Resolver will inspect the reference documents.`);
            if (task.request.protected) {
              const payload = shuffled(deliveries).map(d => ({ verdict: d.content.verdict, reasoning: this.blind(d).submission.reasoning, accepted: !!d.verification?.resolver_verdict.final_pass }));
              const blindClaim = this.blind(deliveries[0]).claim;
              sub.resolution = await this.span('resolver.reconcile', async () => this.models.reconcile(blindClaim, payload, await this.ground.search(blindClaim)));
              await this.event('reconciliation.completed', `Contested claim resolved to ${sub.resolution.verdict}: ${sub.resolution.reasoning}`, this.runtime.mocked('openai'));
            }
          } else {
            const accepted = sub.verdicts.filter(v => v.accepted); sub.reconciled_verdict = accepted.length ? accepted[0].verdict : 'insufficient_evidence';
          }
        }
        task.parent_verdict = parentVerdict(task.sub_claims);
        task.phase = 'settle'; await this.save(task); break;
      }
      case 'settle': {
        await this.event('settlement.started', 'Calculating simulated settlement from completed verification results.', true);
        // Transactions touch the same escrow account, so settle slots sequentially. Model work above is concurrent.
        for (const [index, slot] of task.slots.entries()) {
          if (slot.state !== 'pending') continue;
          const deliveries = task.deliveries.filter(d => d.seller_id === slot.seller_id);
          // A decomposed task commissions one verification per sub-claim. Paying only a seller that
          // cleared every one of them makes the payout probability decay with claim complexity, so
          // each sub-claim is settled on its own merits and the buyer keeps the unearned remainder.
          const units = Math.max(1, task.sub_claims.length);
          const verified = deliveries.filter(d => d.verification?.resolver_verdict.final_pass).length;
          const lamports = Math.round(task.payment_amount_sol * 1e9);
          const earned = task.request.protected ? Math.round(lamports * verified / units) : lamports;
          const released_sol = earned / 1e9, returned_sol = (lamports - earned) / 1e9;
          const pass = earned > 0;
          const commitment = { task_id: task.task_id, slot: index, pass, verified, units, submissions: deliveries.map(d => ({ submission_id: d.submission_id, content: d.content, verification: d.verification })) };
          const hash = await digest(commitment);
          const receipts: Receipt[] = [];
          if (earned > 0) receipts.push(await this.span('escrow.release', () => this.escrow.settle(task, index, true, hash, earned / lamports)));
          if (earned < lamports) receipts.push(await this.span('escrow.refund', () => this.escrow.settle(task, index, false, hash, (lamports - earned) / lamports)));
          slot.receipts = receipts; slot.receipt = receipts[0]; slot.state = pass ? 'paid' : 'refunded';
          slot.released_sol = released_sol; slot.returned_sol = returned_sol; slot.verified_units = verified; slot.total_units = units;
          task.receipts.push(...receipts);
          // Derive totals from immutable completed slots, avoiding floating-point accumulation and retry drift.
          task.paid_sol = task.slots.reduce((sum, s) => sum + Math.round((s.released_sol || 0) * 1e9), 0) / 1e9;
          task.refunded_sol = task.slots.reduce((sum, s) => sum + Math.round((s.returned_sol || 0) * 1e9), 0) / 1e9;
          task.locked_sol = task.slots.filter(s => s.state === 'pending').length * task.payment_amount_sol;
          for (const delivery of deliveries) if (delivery.dispute) { delivery.dispute.resolution = 'auto_refund'; delivery.dispute.evidence_hash = hash; }
          const scope = units > 1 ? ` (${verified} of ${units} verifications)` : '';
          if (earned > 0) await this.event('payment.released', `SIMULATED RELEASE ${released_sol.toFixed(3)} SOL to ${slot.seller_id}${scope}.`, true);
          if (earned < lamports) await this.event('payment.returned', `PAYMENT BLOCKED · SIMULATED RETURN ${returned_sol.toFixed(3)} SOL for ${slot.seller_id}${scope}.`, true);
        }
        task.status = task.paid_sol > 0 ? 'paid' : 'refunded'; task.phase = 'complete'; task.completed_at = new Date().toISOString(); delete task.error;
        await this.event('run.completed', `Simulated settlement: ${task.paid_sol.toFixed(3)} SOL releasable, ${task.refunded_sol.toFixed(3)} SOL protected and returnable.`, true); break;
      }
    }
  }
}

export function parentVerdict(claims: SubClaim[]): Task['parent_verdict'] {
  const values = claims.map(c => c.resolution?.verdict || c.reconciled_verdict);
  if (values.includes('contested')) return 'contested';
  if (values.includes('refuted')) return 'refuted';
  if (values.includes('insufficient_evidence')) return 'insufficient_evidence';
  return values.length ? 'supported' : 'insufficient_evidence';
}
