# Scope, architecture, and contracts (phase checkpoint)

Preserve: “Agents paying other agents to verify whether agents are lying — and nobody gets paid until two independent judges cosign the work.”

Fact-checking only. Buyer posts claim + machine-checkable rubric; sellers deliver verdict + citations; independent verification uses indexed grounding before escrow settlement. Payment rails alone do not resolve valid payments for wrong/out-of-scope work. Structured disputes record authorization, delivery, and mismatch.

Worker → per-task Durable Object → concurrent sellers → blind projection → two independently prompted structured judges + Elasticsearch hybrid/ES|QL + GPTZero → resolver → Solana devnet Anchor escrow release/refund. Sentry task trace spans every stage; dashboard replay and explorer links.

Task fields: task_id, task_type (claim_verification/source_audit/citation_check), buyer_agent_id, seller_agent_id, claim, payment_amount_sol, acceptance_criteria(required_fields,min_citations,citations_must_be_grounded,must_pass_hallucination_check,verdict_enum), status(posted/submitted/verifying/paid/disputed/refunded), created_at.
VerificationResult: submission_id; judge_a/b(score,pass,reasoning); agreement; grounding_check(unsupported_claims,source); hallucination_check(flagged,source); resolver_verdict(final_pass,method,confidence).
DisputeEvidence: dispute_id,task_id,authorization_scope,action_taken,delta,resolution(auto_refund/escalated).
SubClaim: sub_claim_id,parent_task_id,text,assigned_seller_ids,verdicts,reconciled_verdict(supported/refuted/insufficient_evidence/contested).
SellerProfile behavior(reliable/fabricator/sloppy/uninstructed) is harness-only, forbidden in verification code.

No discovery, reputation, bidding, recursive seller subcontracting, production, public deployment, mainnet, real funds, remote push, or secrets committed. Pool ≤4. Sellers/judges concurrent. Disk replay mandatory. API calls independently mocked, loudly labeled. Missing credentials are a logged fallback, not evidence.

Before each phase: reread this file; verify verification/resolution remain the deepest product logic. Run happy/dispute tests before proceeding. Record durable state in PROGRESS.md, TODO.md, ASSUMPTIONS.md. Final green checklist requires real devnet transactions, real model conflict, spontaneous uninstructed failure, real sponsor receipts, real Sentry traces, and a fresh-directory README verification.
