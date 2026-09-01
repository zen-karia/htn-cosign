import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { Keypair } from '@solana/web3.js';
import { z } from 'zod';
import { corpus } from '../src/data/corpus';
import { ReferenceDocumentSchema, embeddingDimensions, embeddingTag, type ReferenceDocument } from '../src/core/models';
import { Runtime } from '../src/services/runtime';
import { Models } from '../src/services/models';
import { Escrow, digest } from '../src/services/escrow';
import { loadEnv, logEvidence } from './env';

export async function seed() {
  mkdirSync('.keys', { recursive: true, mode: 0o700 });
  const names = ['buyer', 'authority', 'agent-cedar', 'agent-flint', 'agent-moss', 'agent-iris'];
  const keys = names.map(name => {
    const path = `.keys/${name}.json`; if (!existsSync(path)) writeFileSync(path, JSON.stringify([...Keypair.generate().secretKey]), { mode: 0o600 });
    return { name, key: Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, 'utf8')))) };
  });
  const env = loadEnv(); const runtime = new Runtime(env, logEvidence); const models = new Models(runtime);
  const corpusArg = process.argv.indexOf('--corpus');
  const docs: ReferenceDocument[] = z.array(ReferenceDocumentSchema).min(1).max(200).parse(corpusArg >= 0 ? JSON.parse(readFileSync(process.argv[corpusArg + 1], 'utf8')) : corpus);
  const checksum = await digest(docs);
  await runtime.call('elasticsearch', 'seed_index', () => { mkdirSync('artifacts', { recursive: true }); writeFileSync('artifacts/corpus.json', JSON.stringify(docs, null, 2)); return { count: docs.length }; }, async () => {
    const base = runtime.require('ELASTICSEARCH_URL').replace(/\/$/, ''); const index = env.ELASTICSEARCH_INDEX || 'cosign-references';
    if (!/^[a-z][a-z0-9_-]{0,100}$/.test(index)) throw new Error('Invalid index name');
    const headers = { 'content-type': 'application/json', ...(env.ELASTICSEARCH_API_KEY ? { authorization: `ApiKey ${env.ELASTICSEARCH_API_KEY}` } : {}) };
    const current = await fetch(`${base}/${index}`, { headers, signal: AbortSignal.timeout(15_000) });
    const embedding = embeddingTag(env);
    if (current.ok) {
      const info = await current.json() as Record<string, { mappings: { _meta?: { corpus_sha256: string; embedding: string } } }>;
      if (info[index]?.mappings._meta?.corpus_sha256 !== checksum || info[index]?.mappings._meta?.embedding !== embedding) throw new Error('Index has a different corpus or embedding model. Choose a fresh ELASTICSEARCH_INDEX; existing data is not deleted.');
    } else if (current.status === 404) {
      const mappings = { _meta: { corpus_sha256: checksum, embedding }, properties: { id: { type: 'keyword' }, url: { type: 'keyword' }, title: { type: 'text' }, text: { type: 'text' }, assertion_claims: { type: 'keyword' }, assertion_verdicts: { type: 'keyword' }, assertions: { type: 'object', enabled: false }, canonical_url: { type: 'keyword' }, publisher: { type: 'keyword' }, retrieved_at: { type: 'date' }, content_hash: { type: 'keyword' }, snippet: { type: 'text' }, embedding: { type: 'dense_vector', dims: embeddingDimensions(env), index: true, similarity: 'cosine' } } };
      // Elasticsearch Serverless rejects shard/replica settings outright, so fall back
      // to mappings alone rather than requiring the operator to know which flavour they have.
      const create = await fetch(`${base}/${index}`, { method: 'PUT', headers, body: JSON.stringify({ settings: { number_of_shards: 1, number_of_replicas: 0 }, mappings }), signal: AbortSignal.timeout(30_000) });
      if (!create.ok) {
        const reason = await create.text();
        if (!/serverless/i.test(reason)) throw new Error(`Index create HTTP ${create.status}`);
        await runtime.json(`${base}/${index}`, { method: 'PUT', headers, body: JSON.stringify({ mappings }) });
      }
    } else throw new Error(`Index lookup HTTP ${current.status}`);
    for (const doc of docs) {
      const vector = await models.embedding(doc.text);
      await runtime.json(`${base}/${index}/_doc/${encodeURIComponent(doc.id)}?refresh=true`, { method: 'PUT', headers, body: JSON.stringify({ id: doc.id, url: doc.url, title: doc.title, text: doc.text, canonical_url: doc.canonical_url ?? doc.url, publisher: doc.publisher ?? null, retrieved_at: doc.retrieved_at ?? null, content_hash: doc.content_hash ?? null, snippet: doc.snippet ?? null, embedding: vector }) });
    }
    return { count: docs.length, checksum };
  });
  await runtime.call('solana', 'prefund_devnet_wallets', () => { console.log('[MOCKED] Wallets generated locally; simulated funding only.'); return true; }, async () => {
    const connection = await new Escrow(runtime).connection();
    for (const { name, key } of keys) {
      // Buyer also funds program deployment/buffer rent, not only task principal.
      const required = name === 'buyer' ? 4_000_000_000 : name === 'authority' ? 100_000_000 : 1_000_000;
      let balance = await connection.getBalance(key.publicKey);
      for (let attempt = 0; balance < required && attempt < 2; attempt++) {
        const signature = await connection.requestAirdrop(key.publicKey, Math.min(2_000_000_000, required - balance));
        const block = await connection.getLatestBlockhash(); const result = await connection.confirmTransaction({ signature, ...block }, 'confirmed');
        if (result.value.err) throw new Error('Airdrop failed');
        console.log(`${name}: https://explorer.solana.com/tx/${signature}?cluster=devnet`);
        balance = await connection.getBalance(key.publicKey);
      }
      if (balance < required) throw new Error('Devnet faucet did not provide the required balance; rerun seed after its rate limit resets.');
    }
    return true;
  });
  const setup = spawnSync(process.execPath, ['scripts/setup.mjs'], { stdio: 'inherit' }); if (setup.status !== 0) throw new Error('Setup failed');
  console.log(`Seeded ${docs.length} reference documents and prepared ${keys.length} devnet-only wallet(s).`);
}
await seed();
