# Cosign demo script

## Prepare

```sh
npm run setup
npm run doctor
npm run build
npm run test:e2e
npm run demo -- --decompose
npm run dev
```

Open http://127.0.0.1:8787. Check Integrations: mock labels mean fixtures, not live sponsor evidence. `npm run doctor` reports whether settlement is `[DEVNET]` or `[SIMULATED]`; only claim devnet when it says so and an Explorer link resolves.

Have `docs/samples/programme-review.pdf` ready to drag in.

## Main run — four minutes

**1. Lead with the document, not the claim.** Turn on **Document audit**, drop in `docs/samples/programme-review.pdf`, click **Audit document**.

> "This is an analyst briefing. Before we spend a cent researching it, the system reads it against itself."

**2. Show the internal contradictions.** They appear before any research finishes. Three of them, and the numeric one is the point:

> "The document claims a 1,200 percent cost overrun. Its own figures — ten billion against an original one billion — give 900. No search engine can catch that. You can only catch it by reading the document as a whole."

Say plainly that the model proposes these and code verifies them: a mismatch whose own two figures agree is thrown away.

**3. Show what could not be checked at all.** Twelve assertions, eight researchable. Two are opinion, two too under-specified. Point at them: deciding which sentences are even checkable is the messy part, and they are reported rather than dropped.

**4. Let the research land.** The eight researchable assertions go to independent agents on different models. When the 1,200 percent figure comes back **refuted**:

> "Caught twice, independently. Internally against the document's own numbers, and externally by agents that never saw the internal finding."

**5. Inspect one agent.** Open **Evidence**. The middle panel is the document analysis: the assertion, why it was classed researchable, the conflict it belongs to, then the verdict. Switch submissions to show two agents on the same assertion.

**6. Show the gate with a fabricated source.** Run `npm run demo:naive`, or use a claim run. Show `NOT FOUND` / `QUOTE MISMATCH`, and say both LLM judges once approved a CERN URL that returns 404 — the deterministic grounding gate is what rejected it.

**7. Put a number on it.** Read the actual protected/released amounts off the settlement summary. Open the Explorer link on a receipt. Never announce an amount before observing it.

**8. Show observability.** Only with confirmed ingestion, open **Integrations → Open task trace in Sentry** and narrate extraction, consistency, sellers, grounding, judges and settlement.

**9. Close.**

> "Cosign treats its own AI agents as untrusted input. It finds where a document contradicts itself, checks what is left against the world, and pays only for what it can verify."

## Sixty-second fallback

```sh
npm run demo:naive
npm run demo:bad
```

Show one fabricated seller paid without protection, then blocked with a structured dispute. The fixture protects 0.050 SOL. Explorer is shown only for real receipts.

## Network/API fallback

- A dependency failure keeps funds locked. Use **Retry stage** after recovery; completed allocations are not paid twice.
- Do not flip flags to pretend a live escrow settled. Modes are pinned. Recover it or use the authorized buyer timeout refund after expiry.
- Click **Demo replay** or run `npm run demo:replay`. Say: “This is a recorded offline run; no new API calls or payments are happening.” Recorded mock labels stay visible.
- To start a new offline task, set all mock flags true, run setup, restart, then create a **new** task. Never present it as live.
- The terminal replay reads only `artifacts/demo-cache.json`; it works without the network or dashboard.

## Honest sponsor claims

| Sponsor | Evidence needed |
| --- | --- |
| Cloudflare | Actual Worker/DO flow and `x-cosign-backend` response header |
| Elasticsearch | Real hybrid/ES|QL result; disclose mocked vs neural vectors |
| OpenAI | Non-mocked model receipts; Codex build work is a separate claim |
| GPTZero | Confirmed hallucination contract and live result, not authorship probability |
| Solana | Real devnet Explorer link; `MOCK-*` is not a signature. `npm run doctor` must read `[DEVNET]` |
| Sentry | Open ingested happy/dispute traces, not just a configured DSN |
| Baseten/Browserbase | Not implemented or claimed |

Do not tune the uninstructed seller to force a failure. A natural failure and real judge conflict remain open until actually observed.
