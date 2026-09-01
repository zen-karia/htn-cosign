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

Open http://127.0.0.1:8787. Inspect Integrations: mock labels mean fixtures, not live sponsor evidence. Complete README's final live setup before claiming real API calls or devnet settlement.

## Main run — three minutes

1. **Show the failure first.** Leave the default emissions claim. Click **Run unprotected**, or `npm run demo:naive`. Say: “A confident agent provides a verdict and three citations and gets paid. But two sources don’t exist and the third quotation was invented.” Inspect the submission. Call mock payments simulated; otherwise open the actual devnet receipt.
2. **Same claim, Cosign on.** Click **Run the seller pool**, or `npm run demo`. Say: “Four agents attempt the same fact-check. We don’t tell the verification layer which one is lying.” Dashboard identities are audience-facing; the judges receive neither labels nor an ordered seller batch.
3. **Inspect the catch.** Open **Verdicts**. Show `NOT FOUND`, `QUOTE MISMATCH`, or `UNSUPPORTED`. Compare under-sourced work: its source is real, but one citation fails a three-citation contract. A grounded `refuted` answer is valid work.
4. **Put a number on it.** Point to **PAYMENT BLOCKED** and read the actual protected/refunded amount. The fixture returns 0.100 SOL across two allocations. Live outcomes may differ; never announce a result before observing it.
5. **Show the dispute.** Open **Disputes**: authorization, delivery, exact failed criteria and evidence hash. Download the JSON. Open real devnet refund receipts when available; otherwise explicitly call this an offline refund simulation.
6. **Show decomposition.** Enable **Decompose into atomic claims** or run `npm run demo -- --decompose`. Show three claims, twelve submissions, a preserved `contested` emissions claim, its document-based resolution, and the parent verdict. Sellers must pass every atomic claim to receive payment.
7. **Show observability.** Only with confirmed ingestion, open **Integrations → Open task trace in Sentry**. Narrate submission, grounding, hallucination, judges, resolver, and settlement for happy/dispute traces. Without credentials, call the activity feed local evidence.
8. Close: **“Agents paying other agents to verify whether agents are lying — and nobody gets paid until two independent judges cosign the work.”** Hard grounding/hallucination failures veto payment even if a tiebreak favors the work.

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
| Solana | Real devnet Explorer link; `MOCK-*` is not a signature |
| Sentry | Open ingested happy/dispute traces, not just a configured DSN |
| Baseten/Browserbase | Not implemented or claimed |

Do not tune the uninstructed seller to force a failure. A natural failure and real judge conflict remain open until actually observed.
