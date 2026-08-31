import { z } from 'zod';

export const Verdict = z.enum(['supported', 'refuted', 'insufficient_evidence']);
export type Verdict = z.infer<typeof Verdict>;
export const Rubric = z.object({
  required_fields: z.array(z.enum(['verdict', 'reasoning', 'sources'])).min(1).default(['verdict', 'reasoning', 'sources']),
  min_citations: z.number().int().min(1).max(10).default(3),
  citations_must_be_grounded: z.literal(true).default(true),
  must_pass_hallucination_check: z.literal(true).default(true),
  verdict_enum: z.array(Verdict).min(1).default(['supported', 'refuted', 'insufficient_evidence']),
}).strict();
// OpenAI strict structured outputs reject JSON Schema `format`, which .url() emits; refine validates without it.
export const Source = z.object({
  url: z.string().max(1000).refine(value => { try { return new URL(value).protocol === 'https:'; } catch { return false; } }, 'Must be an absolute HTTPS URL'),
  quote: z.string().min(10).max(4000),
  title: z.string().min(1).max(500).optional(),
}).strict();
export const Submission = z.object({
  verdict: Verdict,
  reasoning: z.string().min(10).max(8000),
  sources: z.array(Source).max(10),
  confidence: z.number().min(0).max(1).optional(),
  summary: z.string().min(10).max(3000).optional(),
  atomic_claims: z.array(z.string().min(5).max(1500)).max(12).optional(),
}).strict();
export type Submission = z.infer<typeof Submission>;
export const JudgeVerdict = z.object({
  score: z.number().min(0).max(1), pass: z.boolean(), reasoning: z.string().min(1).max(6000),
  verdict: Verdict.optional(), confidence: z.number().min(0).max(1).optional(), grounded: z.boolean().optional(),
  unsupported_claims: z.array(z.string().min(1).max(1000)).max(20).optional(), evidence_ids: z.array(z.string().min(1).max(200)).max(30).optional(),
}).strict();
export type JudgeVerdict = z.infer<typeof JudgeVerdict>;
export const TieVerdict = z.object({ final_pass: z.boolean(), confidence: z.number().min(0).max(1), reasoning: z.string().min(1).max(6000) }).strict();
export const Reconciliation = z.object({ verdict: Verdict, confidence: z.number().min(0).max(1), reasoning: z.string().min(1).max(6000) }).strict();
export const Decomposition = z.object({ claims: z.array(z.string().min(10).max(1500)).min(1).max(4) }).strict();
export const TaskRequest = z.object({
  claim: z.string().trim().min(10).max(4000),
  task_type: z.enum(['claim_verification', 'source_audit', 'citation_check']).default('claim_verification'),
  payment_amount_sol: z.number().min(0.001).max(0.1).default(0.05).refine(x => Math.abs(x * 1e9 - Math.round(x * 1e9)) < 0.001, 'Use whole lamports'),
  acceptance_criteria: Rubric.default({}),
  scenario: z.enum(['pool', 'reliable', 'fabricator', 'sloppy', 'uninstructed']).default('pool'),
  execution_mode: z.enum(['live', 'replay']).default('replay'),
  seller_count: z.number().int().min(2).max(4).default(4),
  decompose: z.boolean().default(false),
  protected: z.boolean().default(true),
}).strict();
export type TaskRequest = z.infer<typeof TaskRequest>;
export type StoredTaskRequest = Omit<TaskRequest, 'execution_mode' | 'seller_count'> & Partial<Pick<TaskRequest, 'execution_mode' | 'seller_count'>>;
export type Criteria = z.infer<typeof Rubric>;
export const ReferenceDocumentSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]+$/), url: z.string().url(), title: z.string().min(1), text: z.string().min(10),
  canonical_url: z.string().url().optional(), publisher: z.string().min(1).optional(), retrieved_at: z.string().datetime().optional(),
  content_hash: z.string().regex(/^[a-f0-9]{64}$/).optional(), snippet: z.string().min(1).max(4000).optional(),
  seller_references: z.array(z.string().min(1).max(200)).max(20).optional(),
  // Legacy demo annotations are optional and never verification evidence.
  assertions: z.array(z.object({ claim: z.string().min(10), verdict: Verdict })).optional(),
});
export type ReferenceDocument = z.infer<typeof ReferenceDocumentSchema>;
export interface BlindInput { claim: string; acceptance_criteria: Criteria; submission: Submission; }
export const BlindInputSchema = z.object({ claim: z.string(), acceptance_criteria: Rubric, submission: Submission }).strict();
// grounded: we fetched the page and the quote is in it. contradicted: we fetched it and the quote
// is not. nonexistent: the page is authoritatively absent. unverifiable: our retrieval failed, which
// says nothing about the seller and must never block payment on its own.
export type CitationStatus = 'grounded' | 'contradicted' | 'nonexistent' | 'unverifiable';
export interface RetrievalFailure { reason: string; status: 'nonexistent' | 'unverifiable'; }
export interface RetrievalOutcome { documents: ReferenceDocument[]; failures: Record<string, RetrievalFailure>; }
export interface GroundingResult {
  unsupported_claims: string[]; source: 'elasticsearch'; mocked: boolean;
  citations: { url: string; exists: boolean; quote_matches: boolean; quote_match_ratio?: number; status?: CitationStatus; unverifiable_reason?: string; supports_verdict: boolean; document_id?: string; entailment_reasoning?: string; entailment_mocked?: boolean }[];
  references: ReferenceDocument[];
}
export interface HallucinationResult { flagged: boolean; source: 'gptzero'; mocked: boolean; reasoning: string; }
export interface VerificationResult {
  submission_id: string; judge_a: JudgeVerdict; judge_b: JudgeVerdict; agreement: boolean;
  grounding_check: GroundingResult; hallucination_check: HallucinationResult;
  resolver_verdict: { final_pass: boolean; method: 'consensus' | 'tiebreak'; confidence: number; reasoning: string };
  failed_criteria: string[]; mocked: boolean;
}
export interface DisputeEvidence { dispute_id: string; task_id: string; submission_id: string; authorization_scope: string; action_taken: string; delta: string; failed_criteria: string[]; resolution: 'auto_refund' | 'escalated'; evidence_hash?: string; }
export interface SubClaim { sub_claim_id: string; parent_task_id: string; text: string; assigned_seller_ids: string[]; verdicts: { submission_id: string; verdict: Verdict; accepted: boolean }[]; reconciled_verdict: Verdict | 'contested'; resolution?: { verdict: Verdict; confidence: number; reasoning: string }; }
export interface Receipt { operation: 'initialize' | 'release' | 'refund'; mocked: boolean; signature: string; explorer_url: string | null; slot?: number; amount_sol: number; evidence_hash?: string; }
export interface Delivery { submission_id: string; seller_id: string; sub_claim_id: string; content: Submission; verification?: VerificationResult; dispute?: DisputeEvidence; error?: string; }
export interface Activity { id: number; at: string; stage: string; message: string; mocked: boolean; }
export interface ServiceEvidence { service: string; operation: string; mocked: boolean; ok: boolean; at: string; duration_ms: number; request_id?: string; error?: string; }
export interface SellerSlot { seller_id: string; address: string; state: 'pending' | 'paid' | 'refunded'; receipt?: Receipt; error?: string; }
export interface Task {
  task_id: string; task_type: TaskRequest['task_type']; buyer_agent_id: string; seller_agent_id: string;
  claim: string; payment_amount_sol: number; acceptance_criteria: Criteria;
  status: 'posted' | 'submitted' | 'verifying' | 'paid' | 'disputed' | 'refunded' | 'stalled'; created_at: string;
  request: StoredTaskRequest; slots: SellerSlot[]; sub_claims: SubClaim[]; deliveries: Delivery[];
  receipts: Receipt[]; activity: Activity[]; evidence: ServiceEvidence[];
  phase: 'classify' | 'initialize' | 'decompose' | 'sellers' | 'verify' | 'reconcile' | 'settle' | 'complete';
  trace_id: string; trace_parent_span_id?: string; completed_at?: string; error?: string; attempts: number; running: boolean;
  service_modes: Record<string, boolean>;
  parent_verdict?: Verdict | 'contested'; refunded_sol: number; paid_sol: number; locked_sol: number;
  evidence_documents?: ReferenceDocument[];
  retrieval_failures?: Record<string, RetrievalFailure>;
  verifiability?: { classification: 'VERIFIABLE' | 'SUBJECTIVE' | 'FUTURE_PREDICTION' | 'INSUFFICIENTLY_SPECIFIED'; reason: string };
}
export type Settings = Record<string, string | undefined>;
// text-embedding-3-small natively produces 1536 dims. The earlier hard-coded 64
// exercised the Elasticsearch query path cheaply but is far too lossy for real
// retrieval. Changing this requires a fresh index: the value is stamped into the
// index _meta and grounding refuses a mismatch.
export const embeddingDimensions = (env: Settings) => {
  const raw = Number(env.OPENAI_EMBEDDING_DIMENSIONS ?? 1536);
  return Number.isInteger(raw) && raw >= 8 && raw <= 3072 ? raw : 1536;
};
export const embeddingTag = (env: Settings) => mockEnabled(env, 'openai')
  ? `mock-feature-vector-${embeddingDimensions(env)}`
  : `${env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small'}:${embeddingDimensions(env)}`;
export const mockEnabled = (env: Settings, service: string) => env[`MOCK_MODE_${service.toUpperCase()}`] !== 'false';
export const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
