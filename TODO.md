# Build checklist

## Live Verification Desk pass — 2026-09-19
- [x] Main desk creates explicit live tasks; fixture behaviors remain replay/test-only.
- [x] Verifiability classification blocks subjective, future, and underspecified work before simulated funding.
- [x] Four independent Responses API sellers research unseen claims with live web search and strict schemas.
- [x] Cosign independently retrieves public HTTPS sources, extracts text, records metadata/SHA-256, and creates a run-scoped Elastic index.
- [x] Two fresh blind judges evaluate every submission from indexed evidence; server derives pass/fail from structured factual verdicts.
- [x] Seller conflicts invoke live evidence-based reconciliation; deterministic evidence gates remain vetoes.
- [x] Seller cards/Evidence Inspector consume persisted runtime outputs, source excerpts, metadata, and judge reasoning.
- [x] Settlement remains explicitly simulated and is calculated from actual verification results; no Solana call or Explorer link is claimed.
- [x] Full unseen-claim runs persisted and reopened: four-seller conflict run `3da29332-fd5f-4fbd-a67f-e8c403b20bb5` and post-hardening two-seller run `44f096fe-24a6-42e7-b3fe-779727ffdda2`.
- [x] Typecheck, 55 tests, Worker/Durable Object HTTP integration, UI build, and Cloudflare dry-run pass after the live runtime changes.
- [ ] Add PDF/transcript extraction; currently non-HTML/text citations fail closed.
- [ ] Deploy updated Worker after Cloudflare authentication is intentionally provided.

## Implemented and locally verified
- [x] Worker + per-task SQLite Durable Objects, KV config, durable phase/retry state machine
- [x] Happy and dispute paths tested through actual Wrangler HTTP backend
- [x] Anchor multi-allocation escrow, native tests, deployable SBF artifact, generated IDL/client types
- [x] Two strict structured judges, tiebreak resolver, immutable hard gates, structured disputes
- [x] Real local Elasticsearch BM25 + vector + RRF + ES|QL caught fabricated citations (mock embeddings disclosed)
- [x] Blind pool capped at four, concurrent work, per-seller allocations, decomposition and contested reconciliation
- [x] Regression checks for both judge/tiebreak and claim-reconciliation identity leakage
- [x] Full successful cached run and offline terminal/dashboard replay
- [x] React dashboard: tasks, activity, verdicts, disputes, principal balances, real-receipt Explorer links
- [x] Sentry SDK spans, trace continuation and Session Replay wiring; live ingestion checker provided
- [x] Complete environment example, seed script, README, demo/fallback script, durable state
- [x] Fresh-directory documented setup/build/Worker tests/demo/replay passed twice, including the final verifier/client changes
- [x] Unlabeled text-corpus swap command implemented (new index required)
- [x] Passage entailment replaces answer-key grounding; exact quotes, distinct citations, blind projections, and separate judge evidence views preserved
- [x] Infrastructure failures use retryable `stalled` status; citation explanations and named mock services appear in the dashboard
- [ ] Validate live entailment quality on paraphrases, conflicting passages, and an unseen corpus; adapter regression tests use stubbed transport

## Pending final credentials / live evidence — do not claim complete
- [x] GPTZero endpoint and schema confirmed: `/v2/bibliography-scan/text`, key entitled, adapter rewritten and verified live against both fictional (flagged) and real (clean) citations.
- [ ] Swap the fictional corpus for real public sources; Bibliography Scan correctly marks every `cosign.example` citation `fake`, so the gate blocks all payment until the corpus is real.
- [ ] Configure OpenAI/GPTZero/Elastic/Sentry and verify non-mocked responses; reseed neural vectors into a fresh index.
- [ ] Fund devnet buyer/verifier; public faucet returned HTTP 429 after retries.
- [ ] Deploy the compiled Anchor program to devnet and run `npm run test:devnet`.
- [ ] Run real full-pipeline release/refund with shareable Explorer links.
- [ ] Observe a real judge disagreement and evidence-based tiebreak.
- [ ] Observe an unprompted failure from the unchanged uninstructed seller; do not force/tune it.
- [ ] Confirm real happy/dispute Sentry traces using `npm run test:sentry`, then open them live.
- [ ] Run `npm run evidence -- --require-live` with all required evidence present.

## Limits / deferred work
- [ ] Rerun `npm run verify:clean` after freeing disk space: September 19 review attempt hit ENOSPC during npm ci; existing-workspace checks pass.
- [ ] Interactive browser QA: no Browser runtime was available in this session.
- [ ] Verify a second live surprise corpus swap; the command is implemented, not yet exercised against a new live dataset.
- [ ] Six transitive moderate npm advisories remain in required web3/Anchor dependency chains. High findings were removed; no production deployment is authorized.
- Baseten/Browserbase intentionally unimplemented and not claimed. No bidding, reputation, discovery or seller subcontracting.

## Remaining track-review work after the verification pass
- [ ] Export reconstructable escrow evidence commitments, add browser/on-chain hash comparison, and implement/test account closure.
- [ ] Add seller tool calls and MCP search/fetch/span tools; implement PDF/transcript extraction, chunking, and citation-to-span mapping on a real corpus.
- [ ] Revisit full-dimensional embeddings, native RRF/reranking compatibility, and useful verification-outcome analytics.
- [ ] Implement Queue fan-out, useful KV configuration writes, and R2 source storage; consider Durable Object WebSockets.
- [ ] Evaluate current model defaults and a separate model family/provider for the adversarial judge.
- [ ] Validate GPTZero's actual contract and a narrative-fabrication case; collect real Sentry traces/replays and performance findings.
- [ ] Prepare public Worker deployment and repository publication, including resolving the nested Git repositories and testing a clean clone.
