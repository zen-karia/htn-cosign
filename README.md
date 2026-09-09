# Cosign

**Cosign treats its own AI agents as untrusted input, and checks them with code.**

Give it a document and it does two things. First it reads the document against itself and reports where it disagrees: a stated percentage its own figures contradict, two sections that cannot both be true, the same event dated twice. No search engine can settle those — only comparing the document's claims to each other can. Then it sends what remains to independent research agents, retrieves every source they cite, and pays them only for the parts it can verify.

Give it a single claim instead and it does the second half alone.

The gap it closes: payment rails such as x402 authorise and settle before establishing whether the delivered work was correct or in scope. They leave "the payment was valid, but the work was wrong." Cosign settles on Solana devnet only against evidence it retrieved itself — a release transfers lamports, a refusal moves nothing, and each transaction memo carries the hash of the verification that authorised it. The Anchor escrow program in `programs/cosign-escrow/` is written but not deployed, so the chain records the decision rather than enforcing it.

## Document audit

Upload a PDF, TXT, MD, CSV, JSON or HTML file, up to 60,000 characters. PDFs are extracted by the Worker with `unpdf`; everything else is read in the browser.

Extraction pulls every factual assertion out of the prose, resolves pronouns so each one stands alone, and sorts it into what can be researched and what cannot — opinion, forecast, or a figure too under-specified to check. The unresearchable ones are reported rather than dropped: what a document asserts without being checkable is a finding about the document.

Then `src/core/consistency.ts` reads the assertions as a set. The model proposes conflicts and code decides which survive: for a numeric mismatch the model must report both the figure the document states and the figure its own other numbers imply, and a finding whose two values agree is discarded however confidently it was worded. References to assertions that do not exist are discarded too.

Findings are reported, never gated. A document contradicting itself says nothing about the sellers, who did not write it, so settlement is untouched — a test pins a conflicted run and a clean run to the same payout. The check is also non-blocking: if it is unavailable the run continues and says so.

`docs/samples/programme-review.pdf` is a sample built to exercise every path — eight checkable facts, two statements too vague to research, two opinions, and three planted inconsistencies covering each kind the pass reports.

## Current evidence

The application runs on a real Cloudflare Worker with SQLite Durable Objects. A live task classifies verifiability, launches 2–4 Responses API sellers with web search — each on a different model with its own research strategy and search budget (`src/core/agents.ts`; one provider, so this is strategy diversity rather than model-family independence) — retrieves their URLs server-side, hashes and indexes the extracted text in a run-scoped Elastic index, runs two fresh blind judges per submission, reconciles conflicts, and settles each slot on devnet from the actual results.

Four findings from running it live are worth stating plainly.

**Both judges approved a fabricated source.** A seller cited `home.cern/energy/energy/`, which it invented and which returns 404. Both LLM judges passed it; the deterministic grounding gate rejected it. That is the case the non-model checks exist for.

**A lens asking for counter-evidence produced citations from memory.** One model returned plausible URLs recalled from training rather than pages it opened, so citations are now bound to the search tool's own record of what was read.

**An audit found a contradiction its own researchers later confirmed.** On `docs/samples/programme-review.pdf` the consistency pass rejected a stated 1,200 percent cost overrun before any research, because the document's own $10.0B and $1.0B figures give 900. The research agents, which never saw that finding, independently refuted the same figure.

**Rate limits, not bad models, were stalling runs.** An audit stalled at HTTP 429 with 7 of 16 deliveries verified. Transient statuses are now retried with backoff that honours `Retry-After`, and audits judge fewer deliveries per alarm.

Demo Replay remains the only fixture-backed UI mode. [PROGRESS.md](PROGRESS.md) records details.

## Architecture

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/architecture-dark.png">
  <img src="docs/architecture-light.png" alt="Cosign architecture. A React dashboard calls a Cloudflare Worker, which gives every task its own SQLite Durable Object running an alarm-driven phase machine. A document audit first goes through intake: every assertion is extracted from the prose, classified as researchable or as opinion, forecast or under-specified, and then read against the other assertions to find numeric mismatches, contradictions, date conflicts and undefined bases, which the model proposes and code verifies. Only researchable assertions reach the panel of independent research agents on different models. A server-side evidence pipeline then retrieves, grounds and blinds everything they cite, sorting each citation into grounded, contradicted, nonexistent or unverifiable. Elasticsearch, two blind judges, a resolver and a GPTZero bibliography scan feed a payment gate that releases lamports to the seller or returns them to the buyer, settling on Solana devnet with the verification hash in the transaction memo. Sentry traces the whole run.">
</picture>

The Worker is the backend, not a static simulation. Each task durably stores its phase, deliveries, reviews, disputes and receipts. Alarms resume work and retry unavailable services three times before pausing safely. The board has another Durable Object; KV supplies optional demo configuration.

## Local setup

Prerequisites: Node.js 22+ and npm. Run inside this repository (`CoSign/CoSign` in the supplied workspace):

```sh
npm ci --cache .cache/npm
npm run setup
npm run seed
npm test
npm run build
npm run test:e2e
npm run demo -- --decompose
npm run demo:replay
npm run dev
```

Open **http://127.0.0.1:8787**. For frontend hot reload, keep the Worker running and run `npm run dev:ui`; use the Vite URL it prints.

Setup creates ignored `.env` and `.dev.vars`. Demo Replay needs no credentials. The main Verification Desk requires `OPENAI_API_KEY`, `ELASTICSEARCH_URL`, and an accessible Elastic service; GPTZero and Sentry are optional integrations. After editing `.env`, run `npm run setup` and **restart the Worker**. Live tasks pin OpenAI, source retrieval, and Elastic to live execution, so they never silently fall back to fixtures. Settlement follows the environment: with `SOLANA_SETTLEMENT=transfer`, a funded `SOLANA_BUYER_SECRET_KEY` and `SOLANA_SELLER_ADDRESSES`, every slot settles in a real devnet transaction; without them it stays simulated and labels itself as such.

`npm run verify:clean` copies the source to a fresh ignored directory without dependencies, credentials, keys or Worker state and literally runs the setup/test/build/demo commands above. No commit or remote push is needed. Results go to `artifacts/clean-verification.json`.

## Demo

```sh
npm run demo:naive             # Fabricated work paid without verification
npm run demo                  # Four sellers, same claim, blind verification
npm run demo -- --decompose    # Three atomic claims × four sellers
npm run demo:bad               # Short single-fabricator fallback
npm run demo:replay            # Offline cache, no API calls or payments
npm run doctor                # Readiness, never secret values
npm run evidence              # Which live claims have recorded evidence?
```

The harness starts a local Worker if necessary and stops only the one it started. A complete protected pool run is cached in `artifacts/demo-cache.json` and `public/demo-cache.json`. The dashboard has **Demo replay**. See [DEMO_SCRIPT.md](DEMO_SCRIPT.md) for judging order and fallbacks.

The default claim says fictional Meridian electric ferries reduced operating emissions by 80%. Three records establish **18%**, so a grounded **refuted** answer is good work. Launch and fleet records support decomposition. This is explicitly a synthetic corpus.

## Verification and escrow rules

- Judge A reconstructs facts and Judge B performs an adversarial evidence audit. Both are fresh independent calls over anonymized work and independently retrieved/indexed evidence. Each returns a factual verdict, confidence, grounding state, unsupported claims, evidence IDs and reason. The server derives pass/fail from that verdict, preventing contradictory prose/boolean outputs from authorizing settlement. They still use the same provider; this is not model-family independence.
- Verification receives only claim, rubric, verdict, reasoning and canonicalized citations. Known IDs and harness labels are scrubbed. Extra metadata is rejected, order randomized, and every verification dependency checked by blindness tests. Writing style itself cannot be guaranteed anonymous.
- Grounding checks indexed source existence, then scores the quote by ordered three-word-sequence containment against the independently retrieved page, then calls passage entailment to evaluate the submitted verdict. Exact containment was too brittle: two independent extractions of one page rarely agree byte for byte, so honest citations failed while fabricated text still scores near zero. Each citation is classified grounded, contradicted, nonexistent or unverifiable, and a source the retrieval could not read is never charged to the seller. Answer annotations are never used or sent to models. Entailment uses `OPENAI_ENTAILMENT_MODEL` (falling back to the resolver model); its explanation and mock/live flag are exported per citation. BM25 and vector rankings are fused with RRF; parameterized ES|QL retrieves cited documents. Similarity alone never authorizes payment.
- There is no citation quota. Corroboration comes from the panel: four sellers with different models, research strategies and search budgets verify the same claim independently, which carries more information than one seller citing several pages. A submission needs one source that holds up; a citation that does not exist still fails it outright. Citations are also checked against the pages the seller actually opened, as reported by the search tool, because a model can emit a URL that fits a site's pattern rather than one it read. Consensus/tiebreaks cannot override rubric, grounding or hallucination failures.
- Sellers/judges run concurrently. Four blind submissions per alarm bound external requests. Settlements are sequential and produce deterministic evidence commitments.
- Outages set `stalled`, keep funds locked, and remain retryable. Invalid/refused/incomplete entailment responses also stall rather than substituting approval. Wrong work creates a structured dispute and refund.
- Conflicts remain `contested`, with a separate document-based resolution. Unknown assertions fail closed. False conjuncts refute the parent; unresolved conflicts stay contested.
- `payment_amount_sol` is **per seller**. A decomposed task settles per sub-claim rather than all or nothing: paying only a seller that cleared every one of them made the payout probability fall as claims got more complex, which is the work worth commissioning. A seller that verified two of three sub-claims earns two thirds and the buyer keeps the rest. Amounts, evidence commitments and the transaction signature are persisted, and an Explorer link is only present when a transaction exists.

Behavior fixtures live only in `src/harness/sellers.ts` and are used by Demo Replay/test tooling. Main-desk sellers always perform fresh independent web research. The Fabricator Test is runtime-generated with a skeptical/cherry-picking policy that is forbidden from inventing sources, URLs, quotations, or facts; judges never see that designation.

## Real Elasticsearch and dataset swaps

With Docker running:

```sh
docker compose up -d --wait
MOCK_MODE_ELASTICSEARCH=false npm run seed
npm run test:elasticsearch
```

To use it in the dashboard, set the flag in `.env`, run setup and restart. Mock OpenAI uses deterministic 64-dimensional feature vectors, which test the Elasticsearch query path rather than neural semantic quality. Live OpenAI uses its configured embedding model with 64 dimensions. Changing model/mode requires a fresh index and reseeding.

Docker was unavailable during development. Native Elasticsearch 9.5.4 was installed inside `.tools/`, tested, then removed after retaining evidence to free disk for Solana tooling. A provided Elastic Cloud endpoint also works.

For a surprise dataset, supply a JSON array of `{id, url, title, text}` records. Legacy `assertions` are optional and ignored by verification. Select a fresh `ELASTICSEARCH_INDEX`, then run:

```sh
MOCK_MODE_ELASTICSEARCH=false npm run seed -- --corpus path/to/corpus.json
```

Replay tooling can still use a seeded index. Live Verification Desk tasks instead retrieve public HTTPS HTML/text sources, validate redirects, extract up to 30,000 characters, record publisher/retrieval time/SHA-256/snippet, and index neural embeddings under a run-scoped index. PDF/transcript extraction is not implemented, so those citations fail closed. Entailment is model judgment and may be wrong; source existence, quotation presence, and citation count remain deterministic vetoes.

## Live Verification Desk setup

1. Add `OPENAI_API_KEY`, `ELASTICSEARCH_URL`, and (when needed) `ELASTICSEARCH_API_KEY` to `.env`, then run `npm run setup` and `npm run doctor`.
2. **GPTZero Bibliography Scan** is wired to `POST https://api.gptzero.me/v2/bibliography-scan/text`, posting `{document}` and reading `bibliographic_citations[].citation_exists.status` and `claim_reference.has_reference`. The second is the one signal no other check produces: grounding only validates the citations a submission offers, so nothing else notices a bibliography that backs no claim in the prose. A submission whose every cited source is unreferenced fails; a partially unreferenced one is reported, not penalised. Verified live: fictional citations return `fake` and are flagged; real public sources return clean. AI-authorship `/predict/text` is not a hallucination signal and is never used. A scan web-searches each citation and takes about a minute. **It requires real, publicly findable sources** — against the fictional demo corpus every citation is correctly judged `fake`, so no allocation would ever be paid. Swap the corpus before enabling this gate.
3. Restart the Worker and submit any concrete, current-or-historical fact from Verification Desk. The Worker creates the run-scoped index automatically; the fixture seed is not used.
4. Optional: configure Sentry and run `npm run test:sentry`.
5. To settle on devnet, set `MOCK_MODE_SOLANA=false`, `SOLANA_SETTLEMENT=transfer`, fund `.keys/buyer.json`, and point `SOLANA_RPC_URL` at an endpoint a Worker can reach. The public `api.devnet.solana.com` serves Node but answers workerd with `403 Your IP or provider is blocked`. Settlement stays simulated when the flag is unset, and a task keeps the mode it was created with.

Sentry wraps the Worker/DOs. A persisted trace ID connects alarm-stage transactions with spans through submission, grounding, GPTZero, judges, resolution and settlement. Frontend Session Replay starts with a configured DSN and masks text. A DSN/trace link is not ingestion proof; final live checks must open real traces.

Baseten/Browserbase are optional, independently flagged, and **not implemented or claimed**. A public deployment runs at `https://cosign.zenilkaria2006.workers.dev`. Dev-tunnel mutations need `API_TOKEN`; cross-origin mutations are rejected. This is not a production authentication system.

## Anchor / Solana

The checked-in IDL is compiler-generated; the web demo needs no Rust tooling. Native tests use no cluster:

```sh
CARGO_HOME="$PWD/.tools/cargo" CARGO_TARGET_DIR="$PWD/target" cargo test --workspace
```

Anchor CLI/client 0.31.1 and Agave 2.3.13 are used. Automatic IDL account resolution is disabled; the client supplies every account through `accountsStrict`. The optional toolchain needs several GB of free disk. Build scripts preserve/generate the ignored program keypair and sync its public ID. Never replace a deployed program's keypair.

```sh
npm run tools:chain
npm run build:escrow
npm run setup
npm run deploy:devnet
npm run test:devnet
```

Deployment requires `.tools/solana-release/bin/solana`, `.keys/program.json` and `target/deploy/cosign_escrow.so`. Both scripts require live mode and devnet's genesis hash. Tests exercise actual balances, wrong recipients, unauthorized signers, missing evidence, duplicate settlement and receipt recovery. Faucet failures remain explicit blockers.

## Project map

| Area | Location |
| --- | --- |
| Durable orchestration | `src/worker/`, `src/core/engine.ts` |
| Blind verification | `src/core/blind.ts`, `src/core/verify.ts` |
| Sponsor clients | `src/services/` |
| Research panel | `src/core/agents.ts` |
| Document extraction | `Models.extractAssertions` in `src/services/models.ts` |
| Internal consistency | `src/core/consistency.ts`, `Models.checkConsistency` |
| PDF upload | `POST /api/extract` in `src/worker/index.ts`, `pdfText` in `src/services/evidence.ts` |
| Failure wording | `src/core/criteria.ts` |
| Harness-only labels | `src/harness/sellers.ts` |
| Anchor escrow | `programs/cosign-escrow/` |
| Dashboard | `src/web/` |
| Tests | `tests/`, `scripts/e2e.ts` |
| Diagnostics | `scripts/settlement-smoke.ts`, `scripts/agent-probe.ts`, `scripts/audit-probe.ts` |
| Sample document | `docs/samples/programme-review.pdf` |
| Architecture diagram | `docs/architecture.py` regenerates `docs/architecture-*.svg` |
| Durable memory | `PROGRESS.md`, `ASSUMPTIONS.md`, `TODO.md` |

Build runs TypeScript, Vite and a Cloudflare **dry run**, without publishing. HTTP end-to-end tests use actual Wrangler and SQLite Durable Objects.

## Concrete Codex contribution

Codex built the verifier and adversarial tests, then caught a setup defect in the full Worker rehearsal: JSON-quoting wallet data into dotenv retained backslashes and broke task creation. It fixed the serializer and reran the successful cached demo. It also tested per-task service-mode pinning to prevent fictional refunds after configuration changes. These are build contributions, distinct from claiming live OpenAI judge calls.
