# Cosign

**Agents paying other agents to verify whether agents are lying — and nobody gets paid until two independent judges cosign the work.**

Cosign is a verify-then-settle layer for agent-to-agent commerce, demonstrated through fact-checking. The Verification Desk performs live research and verification, then settles on Solana devnet: a release transfers lamports to the seller and a refusal moves nothing, each carrying the hash of the verification that authorised it in a transaction memo. The Anchor escrow program in `programs/cosign-escrow/` is written but not deployed, so the chain records the decision rather than enforcing it.

Payment rails such as x402 authorize and settle payments before establishing whether delivered work is correct or in scope. They leave a gap for “the payment was valid, but the work was wrong.” Cosign closes that gap with a machine-checkable rubric, independent reviews grounded in indexed documents, and structured dispute evidence. Verification and conflict resolution are the product; there is no bidding, discovery, or reputation system.

## Current evidence

The local application uses a real Cloudflare Worker and SQLite Durable Objects through Wrangler. The main desk now creates explicit `live` tasks: it classifies verifiability, launches 2–4 Responses API sellers with web search, each on a different model with its own research strategy and search budget (see `src/core/agents.ts`; they remain one provider, so this is strategy diversity rather than model-family independence), retrieves their URLs server-side, hashes and indexes extracted text in a run-scoped Elastic index, runs two fresh blind judges per submission, reconciles conflicts, settles each seller slot on devnet from the actual results, and persists the full run.

A live deployed run settles on devnet end to end: sellers research, sources are retrieved and indexed, judges review blind, and each slot is paid or returned in its own transaction carrying the verification evidence hash. Two findings from live running are worth stating plainly. Both judges have approved a submission built on a source that does not exist — `home.cern/energy/energy/`, invented by the seller and returning 404 — which the grounding gate rejected; that is the case the deterministic checks exist for. And a seller lens that asks for counter-evidence drove one model to cite plausible URLs recalled from training rather than pages it opened, which is why citations are now checked against the search tool's own record of what was read. Demo Replay remains the only fixture-backed UI mode. [PROGRESS.md](PROGRESS.md) records details.

## Architecture

```mermaid
flowchart TD
  UI[React dashboard] --> W[Cloudflare Worker API]
  W --> DO[One SQLite Durable Object per task]
  W --> KV[KV configuration]
  DO --> BUYER[Buyer decomposes claims]
  BUYER --> POOL[2–4 independent web-search sellers]
  POOL --> FETCH[Retrieve, extract, hash and index cited URLs]
  FETCH --> BLIND[Strip attribution and shuffle evaluation order]
  BLIND --> ES[Elasticsearch: BM25 + vectors + ES|QL]
  BLIND --> GZ[GPTZero hallucination gate]
  ES --> A[Judge A: factual review]
  ES --> B[Judge B: adversarial review]
  A --> R[Consensus / structured tiebreak]
  B --> R
  GZ --> R
  R --> PASS[All hard gates pass]
  R --> FAIL[Failed criteria + dispute evidence]
  PASS --> RELEASE[Devnet transfer to the seller]
  FAIL --> REFUND[Return retained by the buyer]
  DO -. task trace .-> SENTRY[Sentry spans + frontend Session Replay]
```

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

Setup creates ignored `.env` and `.dev.vars`. Demo Replay needs no credentials. The main Verification Desk requires `OPENAI_API_KEY`, `ELASTICSEARCH_URL`, and an accessible Elastic service; GPTZero and Sentry are optional integrations. After editing `.env`, run `npm run setup` and **restart the Worker**. Live tasks pin OpenAI, source retrieval, and Elastic to live execution and pin settlement to simulation, so they never silently fall back to fixtures or claim a chain transaction.

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
| Failure wording | `src/core/criteria.ts` |
| Harness-only labels | `src/harness/sellers.ts` |
| Anchor escrow | `programs/cosign-escrow/` |
| Dashboard | `src/web/` |
| Tests | `tests/`, `scripts/e2e.ts` |
| Diagnostics | `scripts/settlement-smoke.ts`, `scripts/agent-probe.ts` |
| Durable memory | `PROGRESS.md`, `ASSUMPTIONS.md`, `TODO.md` |

Build runs TypeScript, Vite and a Cloudflare **dry run**, without publishing. HTTP end-to-end tests use actual Wrangler and SQLite Durable Objects.

## Concrete Codex contribution

Codex built the verifier and adversarial tests, then caught a setup defect in the full Worker rehearsal: JSON-quoting wallet data into dotenv retained backslashes and broke task creation. It fixed the serializer and reran the successful cached demo. It also tested per-task service-mode pinning to prevent fictional refunds after configuration changes. These are build contributions, distinct from claiming live OpenAI judge calls.
