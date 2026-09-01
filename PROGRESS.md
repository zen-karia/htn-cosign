# Build state

## LIVE VERIFICATION DESK — 2026-09-19

- Main Verification Desk now submits `execution_mode: live`; Demo Replay remains the only UI fixture path. Live tasks force OpenAI, source retrieval and Elasticsearch to real calls even when legacy mock flags remain enabled, while Solana is force-pinned to simulation per the latest user instruction.
- Added a live verifiability classifier, four independent Responses API web-search sellers, public-HTTPS redirect-safe retrieval, HTML/text extraction, source metadata/SHA-256, run-scoped Elastic indexing, two structured blind judges per submission, and live conflict reconciliation.
- Judge outputs now include reconstructed verdict, confidence, grounding state, unsupported claims, evidence IDs and reason. Server-side pass/fail derivation prevents contradictory free-form reasoning from authorizing settlement.
- Unseen-claim Worker/SQLite Durable Object run `3da29332-fd5f-4fbd-a67f-e8c403b20bb5` completed and reopened with 4 live seller calls, 4 successful source retrievals, live embeddings/index/search/ES|QL, 4 entailment calls, 4 GPTZero scans, 8 judge calls and 1 live reconciliation. All four simulated allocations were returned because hard evidence gates rejected the submitted work. No Solana transaction occurred or was claimed.
- Post-hardening run `44f096fe-24a6-42e7-b3fe-779727ffdda2` also completed and reopened: 2 independent sellers, 3 retrieved source records with submission references, 4 rich structured judge outputs, and 0.100 simulated SOL returned after exact-quote/entailment/GPTZero gates rejected otherwise-correct conclusions.
- Latest local validation: TypeScript and all 55 Vitest tests pass; the actual Wrangler Worker/Durable Object HTTP suite, production UI build, and Cloudflare dry-run pass. Production deployment was not performed. Interactive browser QA was attempted but no browser runtime was available.

## CURRENT HANDOFF — 2026-09-19

Project: `/Users/derrickratnaharan/CoSign/CoSign`. Local dashboard: `http://127.0.0.1:8787` (retained Wrangler server). No commits, pushes, public endpoint or production deployment were made.

**User memory:** credentials are added at the very end. Do not repeatedly ask during implementation. The credential-free build is now ready for that final step; do not call the full Definition of Done green.

Verified:
- 26 Vitest regression tests pass (3 files, restricted to tests/; no duplicate clean-copy tests counted).
- Actual Wrangler Worker/SQLite Durable Objects E2E passes happy payout, disputed refund, pool, decomposition/contested resolution, naive flow, input/origin checks, idempotency and no repeated settlement.
- TypeScript, React build and Cloudflare deployment dry-run pass. No production deployment occurred.
- 5 native Rust tests pass; SBF build succeeds; Anchor compiler-generated IDL and generated TS types are used by the client. Retained deployable binary: `target/deploy/cosign_escrow.so`. Evidence: `artifacts/escrow-build.json`.
- Real native Elasticsearch BM25/vector/RRF/ES|QL accepted proper citations and rejected three fabricated/unsupported citations. Embeddings were mocked and disclosed. Evidence: `artifacts/elasticsearch-validation.json`. Native ES was stopped and removed to free disk; use Docker or supplied cloud endpoint later.
- Complete protected 3-claim/4-seller run cached and replayable. Result: 0.100 simulated SOL paid, 0.100 refunded, parent refuted; no real uninstructed failure claimed. `artifacts/demo-cache.json`, `public/demo-cache.json`.
- Fresh-directory README setup passed twice. Latest report: `artifacts/clean-verification.json`; original dependency-free copies/logs remain in `.verify/`, duplicate installed packages were removed afterward.
- Secret-pattern scan of all tracked/unignored files passed; keys and dotenv files are ignored. High npm advisory findings fixed; six moderate transitive findings remain.

Mocked/pending:
- Default application flags remain true for every sponsor. OpenAI, GPTZero and Sentry credentials absent by user choice. Optional Baseten/Browserbase are not implemented or claimed.
- GPTZero adapter is provisional: sponsor hallucination endpoint/schema must be confirmed; AI-authorship detection is not a substitute. Public-web-only citation verification requires swapping the fictional corpus for real sources.
- Public devnet genesis successfully verified; airdrop/funding hit HTTP 429 after bounded retries. No devnet deployment/release/refund exists yet. Use the full genesis hash, not the truncated CAIP-2 identifier.
- Real judge disagreement, spontaneous uninstructed failure, and Sentry trace ingestion cannot be claimed yet. `npm run evidence` honestly reports these false.
- Browser skill/runtime reported zero available browsers. Build/HTTP QA passed; interactive visual QA remains unverified.

Exact next action when credentials are ready:
1. Edit `.env`; confirm/adapt GPTZero contract in `src/services/hallucination.ts`; set verified services to live. Use a NEW Elasticsearch index for neural embeddings.
2. `npm run doctor`, `npm run seed` (buyer target 4 devnet SOL for deployment rent; verifier 0.1 SOL; faucet rate limits must clear).
3. `npm run deploy:devnet` and `npm run test:devnet`. The SBF artifact is already built. Do not regenerate the existing `.keys/program.json`.
4. `npm run setup`, restart Wrangler, run `npm run demo -- --scenario reliable`, `npm run demo:bad`, and `npm run demo -- --decompose` with live flags. Protected live payouts reject mocked verification.
5. Observe genuine model disagreements/natural uninstructed failures without rigging. `npm run test:sentry` checks ingested spans with a read-only token; open both traces and actual Explorer receipts.
6. `npm run evidence -- --require-live`, update TODO/README only for evidence actually observed. Full Definition of Done remains open until then.

Toolchain/resources: Anchor CLI 0.31.1, Agave 2.3.13, SBF Rust 1.84 in project-local `.tools/`. Cargo.lock pins compatible dependencies including blake3 1.5.5. `npm run build:escrow` handles SDK provision markers, explicit accounts, and compiler IDL. Host/SBF intermediate build caches were cleared after successful validation to conserve disk; deploy binary and keys retained. Do not delete outside-project files to gain space.

User steering (persist across context resets): credentials will be added at the very end. Do not request them again mid-build. Complete the credential-free implementation and validation first; keep live checklist items pending.

## September 19 track review — verification and demo reliability
- Replaced assertion-key grounding with a schema-validated passage-entailment adapter. Indexed URL existence, verbatim quotes, and distinct citation counts remain separate vetoes. Invalid/refused/incomplete entailment fails closed; explanations and mock flags are stored per citation.
- Optional legacy assertions are excluded from retrieval results and every model prompt. Seed accepts unlabeled `{id,url,title,text}` records. Offline seller/reconciliation/entailment uses a disclosed narrow text heuristic; semantic quality requires live model evaluation.
- Reliable and uninstructed sellers use the model adapter in live mode; the sloppy harness trims its output. Judge A sees retrieval plus cited documents; Judge B sees only cited documents. Harness failure labels stay outside verification.
- Added retryable `stalled` status for infrastructure failures, named mock-service banners, citation explanations, and a buyer-selected minimum citation count in the dashboard.
- Validation on final code: 44 TypeScript tests passed (including existing blindness/payment-veto tests and a full paraphrased-decomposition adapter regression), typecheck passed, UI build and Worker dry run passed, actual Wrangler/DO HTTP happy/refund/pool/decomposition/idempotency tests passed. Adapter tests stub transport; no live sponsor evidence is claimed.
- `npm run verify:clean` was attempted here and failed during `npm ci` with ENOSPC. Removed only that attempt's generated directory, preserved its log at `.cache/clean-verification-attempt.log`; about 384 MiB remained available. Historical clean-verification artifacts predate this change and do not validate it. Browser runtime reported no connected browsers; visual QA is unverified.
- No environment secrets were edited, no live services enabled, and no deployment performed. Remaining review items are tracked in TODO.md.

## Bootstrap
- Existing repository contained only LICENSE and README. Tooling: Node 24, npm, Rust available; Anchor/Solana CLI absent. Docker daemon probe pending.
- No credentials available. All integrations default mocked; live definition-of-done items remain open.
- Scope/architecture/contracts captured in BUILD_SPEC.md. Verification is the implementation priority.
- Next: implement typed contracts, fail-closed verifier, durable orchestration, escrow, phase-1 happy/dispute tests; iterate through later phases with live fallbacks recorded.

## Phases 1–2 local checkpoint
- Implemented Worker, per-task SQLite Durable Object with alarms/retries, board DO, KV config read, React dashboard, multi-allocation escrow source/client, blind verification, structured judge/tiebreak clients, mock/live adapters.
- Validation: 19 TypeScript tests passed; 5 Rust host tests passed; real Wrangler HTTP end-to-end happy/reject/pool/decomposition/unprotected/idempotency checks passed; Worker dry-run build passed. Devnet deployment and live sponsor evidence deliberately deferred until credentials per user.
- Verification remains deeper than UI: independent hard gates, disputes tied to failed criteria, attribution removal, persisted steps, chain settlement idempotency. No discovery/bidding/reputation added.
- Grounding/pool scaffolding is implemented and fixture-tested; Phase 3 now needs real local Elasticsearch, adapter contract validation, cache/seed tooling.
- Docker daemon unavailable (5-second probe timeout). Trying project-local native Elasticsearch archive; first HTTP/2 download failed after 54 MB; retry with HTTP/1.1/resume.
- Current fix: standalone tsx could not import Anchor's CJS `BN`; use explicit bn.js dependency. Seed and demo scripts implemented, need rerun.
- Next: complete seed/demo/doctor; run real local ES; browser QA; toolchain + IDL build; docs/clean verification. All sponsor credentials remain intentionally deferred.

## Phase 3 / 3.5 checkpoint
- Real native Elasticsearch 9.5.4 installed and seeded. `scripts/elasticsearch-test.ts` passed real BM25+dense_vector+RRF+parameterized ES|QL: valid citations accepted, 3 fabricated/unsupported citations blocked. Embeddings remain explicitly mocked feature vectors until OpenAI credentials arrive. Sanitized evidence: artifacts/elasticsearch-validation.json.
- Four-seller pool, 3-claim decomposition, contested reconciliation, per-seller payment/refund, blind projections and replay are implemented. `npm run demo -- --decompose` completed via Worker and cached artifacts/demo-cache.json + public/demo-cache.json.
- Source/retry safety strengthened: per-task mock/live flags are pinned; verifier rejects metadata-bearing objects; batch up to 4 blind submissions per alarm to bound external subrequests.
- Native Rust 5 tests and TypeScript suite pass; full Worker HTTP test previously passed. Latest changes pending another Worker test.
- Browser skill attempted, runtime discovery returned zero browsers. No interactive visual QA performed; HTTP/UI build validation is available.
- Machine disk reached full during simultaneous Elasticsearch/toolchain installation. Removed only own regenerable downloads/npm cache/failed cargo CLI build. Anchor 0.31.1 prebuilt CLI and Agave 2.3.13 binaries now installed in .tools. Native ES may be removed after evidence to free space for SBF compilation; remote ES credentials are deferred.
- Next: SBF build + compiler IDL, security/regression tests, README/demo docs, clean-directory verification. GPTZero API contract remains provisional pending final sponsor docs/credentials. No live devnet/model/GPTZero/Sentry evidence claimed.

## Phase 4 / packaging checkpoint
- SBF build now passed: `target/deploy/cosign_escrow.so` (236 KiB), Anchor compiler-generated JSON IDL and TypeScript client types checked into source. `npm run tools:chain` / `npm run build:escrow` automate project-local installation/build. Program public ID: Fd9qA4pYkS43ordqGUVyYnaFZqAgRL1qZwa6nCBhC7Xq. Private program key only in ignored .keys and target.
- SBF build required Rust-1.84-compatible Cargo.lock, notably blake3 1.5.5; automatic IDL PDA resolution disabled in Anchor.toml. SDK post-processing installer needed local provision markers to prevent redundant downloads/global Rust registration.
- Fresh-directory verification passed all documented local commands, including actual Worker E2E and cached decomposition demo. Report: artifacts/clean-verification.json. Rerunning after dependency/security fixes.
- Dependency audit high findings removed with patched TOML override; Vitest updated to 4.1.11. Six transitive moderate advisories remain in required Solana/web3 dependencies; no production deployment authorized.
- Dashboard, disputes, animated ledger, activity, offline replay, structured export, Sentry instrumentation and a real Sentry ingestion-check command are implemented. Browser unavailable; no visual click-through evidence.
- Test discovery restricted to tests/ so temporary clean-copy suites are not accidentally counted twice.
- Next: final 24-test suite + Worker E2E + native tests + second clean setup; document exact live blockers. Credentials still intentionally deferred. Public devnet-only funding may be attempted at final validation because it needs no sponsor credential; no protected live payout will accept mock verification.
