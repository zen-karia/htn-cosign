# Assumptions and fallbacks

## Current override — live desk pass
- Runtime credentials are now present locally and were exercised without printing or committing their values.
- Verification Desk is live for OpenAI/web research/source retrieval/Elastic and must never fall back to fixtures. Demo Replay remains deterministic and fixture-backed.
- The latest user instruction explicitly defers Solana work. Verification Desk settlement is simulated, labels itself simulated, emits no Explorer URL, and does not call the existing Anchor/devnet client.
- Direct retrieval currently accepts public HTTPS HTML, XHTML, and plain text up to 2 MB and persists at most 30,000 extracted characters per source. PDF/transcript sources fail closed until an extractor is added.

## Persistent user instruction
2026-09-19: User will add **all sponsor credentials at the very end**. Do not ask again during implementation. Complete local build/test/replay first, then run live validation only after credentials are supplied. Missing credentials do not authorize invented live evidence.

- Project root is the existing nested Git repository `CoSign/CoSign`; parent directory is untouched.
- All sponsor services start mocked. No `.env`, `.dev.vars`, or sponsor environment credentials were available at bootstrap. Live evidence is pending; mock activity must never count as live evidence.
- Local Wrangler runs the actual Worker and SQLite Durable Objects. The Sites starter/hosting workflow is not used because the user explicitly requires this backend and prohibits public/production deployment.
- One task has one escrow with up to four fixed seller allocations. `payment_amount_sol` is the per-seller maximum; total deposit is that amount times the pool size. All atomic claims must pass for a seller's allocation to release. Failed allocations return to the buyer.
- The default public-transit corpus is explicitly fictional. Dataset swaps accept unlabeled `{id,url,title,text}` documents. Indexed URL existence, verbatim quotes and minimum citation count are deterministic gates; verdict entailment is a separate fallible model judgment. Offline text heuristics are labeled and not semantic validation. Legacy answer annotations never enter verification prompts.
- Development keypairs are devnet-only and stay in ignored `.keys/`. No mainnet or local-validator cluster will be used without authorization (the prompt restricts all non-devnet clusters).
- A resolver may break a judge tie but cannot override a deterministic rubric, grounding, or hallucination failure. Unavailable dependencies block payment and preserve retryable work.
- Blind verification gets a projected, attribution-scrubbed value object, never seller IDs, profiles, task IDs, arrival sequence, trace tags, or a shared batch. Identity mapping remains in orchestration only.
- Natural language style can itself be distinctive; blindness means no deliberate identity/behavior/order metadata is supplied. Tests cover schema and injected attribution leakage.
- No live uninstructed failure or real model disagreement can be claimed without an authenticated model run; mock fixtures are labeled fixtures.
- GPTZero Bibliography Scan (`POST /v2/bibliography-scan/text`) is the confirmed hallucination contract; the key is entitled and the adapter was validated live. A citation is flagged only when `citation_exists.status` is `fake`; `unsure` is reported but does not veto, because grounding independently proves index membership and one vendor's uncertainty is not evidence of fabrication. AI-authorship probabilities are never substituted for hallucination evidence. The scan searches the public web, so it presumes real sources: on the fictional corpus it correctly marks every citation fake.
- Docker is installed but its daemon does not respond. Native Elasticsearch is being attempted inside `.tools/`; no Docker Desktop/system installation or outside-directory modifications are needed.
- Native Rust escrow unit tests run without any validator/cluster. Real instruction execution and deployment remain devnet-only.
- Native Elasticsearch tests passed real BM25+vector+ES|QL. Its temporary distribution was removed after testing because this machine ran out of disk during toolchain installation; recorded evidence remains. Mock vectors are explicitly distinguished from neural embeddings.
- Browser runtime discovery returned no available browsers. Dashboard build/HTTP tests are verified; interactive visual QA is not claimed.
- Anchor IDL account auto-resolution is disabled because CLI 0.31.1's compilation path hit a seed-resolution macro error. Compiler-generated IDL succeeds with explicit accounts; the client already uses `accountsStrict`.
- Solana's bundled Rust 1.84 requires dependency compatibility pins (including blake3 1.5.5); Cargo.lock is the reproducibility boundary. Do not update it blindly with a newer host toolchain.
- Sentry ingestion verification uses the official trace metadata API: https://docs.sentry.io/api/discover/retrieve-trace-metadata/ . A configured DSN or successful flush alone does not mark the evidence checklist complete.
- Final public-devnet pre-funding attempt hit HTTP 429 after the Solana client's bounded retries. No deployment or settlement has been claimed. The genesis check uses the full RPC hash (not the shortened CAIP-2 identifier), verified against the official devnet endpoint and Solana SDK source.
- Solana transaction confirmation uses HTTP polling rather than a Node/browser WebSocket constructor, making the Anchor client usable in Workers.

## Integration sources
- OpenAI strict structured responses: https://developers.openai.com/api/docs/guides/structured-outputs
- Cloudflare persistent alarms: https://developers.cloudflare.com/durable-objects/api/alarms/
- Anchor PDA constraints: https://www.anchor-lang.com/docs/basics/pda
- Elasticsearch hybrid search: https://www.elastic.co/docs/solutions/search/vector
