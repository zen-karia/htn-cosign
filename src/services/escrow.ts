import { AnchorProvider, Program, type Idl } from '@coral-xyz/anchor';
import BN from 'bn.js';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, VersionedTransaction, type Signer, type ConfirmOptions } from '@solana/web3.js';
import { Buffer } from 'buffer';
import type { Receipt, Task } from '../core/models';
import { Runtime, ServiceUnavailable } from './runtime';
import idl from '../data/escrow-idl.json';
import type { CosignEscrow } from '../data/escrow-types';

// Full RPC genesis hash; the shortened CAIP-2 chain identifier is not sufficient here.
export const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
export class HttpAnchorProvider extends AnchorProvider {
  // Cloudflare Workers require fetch-based sockets; avoid web3.js's Node/browser WebSocket confirmation path.
  override async sendAndConfirm(tx: Transaction | VersionedTransaction, signers: Signer[] = [], opts?: ConfirmOptions): Promise<string> {
    const block = await this.connection.getLatestBlockhash('confirmed');
    if (tx instanceof VersionedTransaction) { if (signers.length) tx.sign(signers); }
    else { tx.recentBlockhash = block.blockhash; tx.feePayer ||= this.wallet.publicKey; if (signers.length) tx.partialSign(...signers); }
    const signed = await this.wallet.signTransaction(tx);
    const signature = await this.connection.sendRawTransaction(signed.serialize(), { skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 3, ...opts });
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const status = (await this.connection.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0];
      if (status?.err) throw new ServiceUnavailable('solana', 'Transaction failed on-chain');
      if (status && ['confirmed', 'finalized'].includes(status.confirmationStatus || '')) return signature;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw new ServiceUnavailable('solana', 'Confirmation timed out; retry reconciles persisted on-chain state');
  }
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, v]) => [key, canonical(v)]));
  return value;
}
export async function digest(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(canonical(value)));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(x => x.toString(16).padStart(2, '0')).join('');
}
export interface EscrowService { initialize(task: Task): Promise<Receipt>; settle(task: Task, slot: number, pass: boolean, hash: string, share?: number): Promise<Receipt>; }
interface EscrowAccount { buyer: PublicKey; authority: PublicKey; taskHash: number[]; sellers: PublicKey[]; amountPerSeller: BN; states: number[]; evidenceHashes: number[][]; count: number; }


// Settlement without the escrow program: the buyer pays the seller directly and the verification
// evidence hash rides along in a memo, so the payment carries a commitment to what authorised it.
// This records the decision on chain; it does not enforce it, because nothing holds the funds.
const MEMO_PROGRAM = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

export class Escrow implements EscrowService {
  constructor(private runtime: Runtime) {}
  async connection() {
    // api.devnet.solana.com answers workerd with 403 'Your IP or provider is blocked', so a Worker
    // needs its own RPC endpoint. The default is kept for scripts, which run under Node and are served.
    const endpoint = this.runtime.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
    if (new URL(endpoint).protocol !== 'https:') throw new ServiceUnavailable('solana', 'Devnet RPC must use HTTPS');
    const connection = new Connection(endpoint, { commitment: 'confirmed', confirmTransactionInitialTimeout: 60_000 });
    if (await connection.getGenesisHash() !== DEVNET_GENESIS) throw new ServiceUnavailable('solana', 'Refusing a non-devnet cluster');
    return connection;
  }
  private key(name: string) {
    const bytes: unknown = JSON.parse(this.runtime.require(name));
    if (!Array.isArray(bytes) || bytes.length !== 64 || bytes.some(x => !Number.isInteger(x) || x < 0 || x > 255)) throw new ServiceUnavailable('solana', 'Invalid keypair configuration');
    return Keypair.fromSecretKey(Uint8Array.from(bytes));
  }
  private async client(task: Task) {
    const connection = await this.connection();
    const buyer = this.key('SOLANA_BUYER_SECRET_KEY'), authority = this.key('SOLANA_AUTHORITY_SECRET_KEY');
    const programId = this.runtime.env.SOLANA_PROGRAM_ID || idl.address;
    const signTransaction = async <T extends Transaction | VersionedTransaction>(tx: T): Promise<T> => { if (tx instanceof VersionedTransaction) tx.sign([authority]); else tx.partialSign(authority); return tx; };
    const wallet = { publicKey: authority.publicKey, signTransaction, signAllTransactions: async <T extends Transaction | VersionedTransaction>(txs: T[]) => Promise.all(txs.map(signTransaction)) };
    const provider = new HttpAnchorProvider(connection, wallet, { commitment: 'confirmed' });
    const program = new Program<CosignEscrow>({ ...idl, address: programId } as unknown as CosignEscrow, provider);
    const hash = Buffer.from(await digest(task.task_id), 'hex');
    const [pda] = PublicKey.findProgramAddressSync([Buffer.from('escrow'), buyer.publicKey.toBuffer(), hash], program.programId);
    const account = (program.account as unknown as { escrow: { fetchNullable: (key: PublicKey) => Promise<EscrowAccount | null> } }).escrow;
    return { connection, buyer, authority, program, hash, pda, account };
  }

  // Direct settlement used while the escrow program is not deployed. A release moves lamports to the
  // seller; a refusal moves nothing, because the buyer never gave the funds up, and is recorded as a
  // memo so the decision is still auditable on chain.
  private async transferSettlement(task: Task, slot: number, pass: boolean, hash: string, amount_sol: number): Promise<Receipt> {
    const operation = pass ? 'release' : 'refund';
    const seller = task.slots[slot];
    const memo = `cosign ${operation} task=${task.task_id} slot=${slot} evidence=${hash}`;
    let payment: { to: string; lamports: number } | undefined;
    if (pass) {
      if (!seller?.address || seller.address.startsWith('SIMULATED-')) throw new ServiceUnavailable('solana', 'Seller has no payable address configured');
      const lamports = Math.round(amount_sol * 1e9);
      if (lamports <= 0) throw new ServiceUnavailable('solana', 'Refusing a zero-value release');
      payment = { to: seller.address, lamports };
    }
    return this.memoReceipt(task, operation, memo, pass ? amount_sol : 0, hash, payment);
  }

  // One signed transaction carrying a memo, optionally moving lamports with it.
  private async memoReceipt(task: Task, operation: Receipt['operation'], memo: string, amount_sol: number, hash?: string, payment?: { to: string; lamports: number }): Promise<Receipt> {
    const connection = await this.connection();
    const buyer = this.key('SOLANA_BUYER_SECRET_KEY');
    const transaction = new Transaction();
    if (payment) transaction.add(SystemProgram.transfer({ fromPubkey: buyer.publicKey, toPubkey: new PublicKey(payment.to), lamports: payment.lamports }));
    transaction.add({ keys: [], programId: MEMO_PROGRAM, data: Buffer.from(memo.slice(0, 560), 'utf8') });
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = buyer.publicKey;
    transaction.sign(buyer);
    const signature = await connection.sendRawTransaction(transaction.serialize(), { preflightCommitment: 'confirmed' });
    await this.awaitConfirmation(connection, signature);
    return this.receipt(connection, signature, operation, amount_sol, hash);
  }

  // connection.confirmTransaction waits on a signature subscription, and a Worker has no outbound
  // WebSocket, so the wait never resolves and the blockhash expires under a transaction that did in
  // fact land. Poll the status over HTTP instead, which is the same question asked a different way.
  private async awaitConfirmation(connection: Connection, signature: string, timeoutMs = 60_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const status = (await connection.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0];
      if (status?.err) throw new ServiceUnavailable('solana', 'Transaction failed on chain');
      if (status && ['confirmed', 'finalized'].includes(status.confirmationStatus || '')) return;
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
    throw new ServiceUnavailable('solana', 'Transaction was not confirmed in time; retry to reconcile on-chain state');
  }

  private async receipt(connection: Connection, signature: string, operation: Receipt['operation'], amount: number, hash?: string): Promise<Receipt> {
    const result = await connection.getSignatureStatuses([signature], { searchTransactionHistory: true });
    const status = result.value[0];
    if (!status || status.err || !['confirmed', 'finalized'].includes(status.confirmationStatus || '')) throw new ServiceUnavailable('solana', 'Transaction not confirmed; retry to reconcile on-chain state');
    return { operation, mocked: false, signature, explorer_url: `https://explorer.solana.com/tx/${signature}?cluster=devnet`, slot: status.slot, amount_sol: amount, ...(hash ? { evidence_hash: hash } : {}) };
  }
  private async recover(connection: Connection, pda: PublicKey, marker: string) {
    const signatures = await connection.getSignaturesForAddress(pda, { limit: 30 }, 'confirmed');
    for (const entry of signatures.filter(x => !x.err)) {
      const tx = await connection.getTransaction(entry.signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
      if (tx?.meta?.logMessages?.some(line => line === `Program log: ${marker}`)) return entry.signature;
    }
    throw new ServiceUnavailable('solana', 'Settlement exists; transaction receipt not yet indexed. Retry later.');
  }
  initialize(task: Task): Promise<Receipt> {
    return this.runtime.call<Receipt>('solana', 'initialize', () => ({ operation: 'initialize', mocked: true, signature: `MOCK-${task.task_id}-initialize`, explorer_url: null, amount_sol: task.payment_amount_sol * task.slots.length }), async () => {
      // Transfer settlement has no escrow account to open, because the buyer keeps the funds until a
      // payout. Opening one would call a program that is not deployed. Record the commitment instead.
      if (this.runtime.env.SOLANA_SETTLEMENT === 'transfer') return this.memoReceipt(task, 'initialize', `cosign initialize task=${task.task_id} slots=${task.slots.length} per_seller_sol=${task.payment_amount_sol}`, task.payment_amount_sol * task.slots.length);
      const { connection, buyer, authority, program, hash, pda, account } = await this.client(task);
      const existing = await account.fetchNullable(pda);
      let signature: string;
      if (existing) {
        if (!existing.buyer.equals(buyer.publicKey) || !existing.authority.equals(authority.publicKey) || existing.count !== task.slots.length || existing.amountPerSeller.toNumber() !== Math.round(task.payment_amount_sol * 1e9) || task.slots.some((s, i) => existing.sellers[i].toBase58() !== s.address)) throw new ServiceUnavailable('solana', 'Existing escrow does not match the task authorization');
        signature = await this.recover(connection, pda, 'COSIGN initialize');
      } else {
        signature = await program.methods.initializeEscrow([...hash], task.slots.map(s => new PublicKey(s.address)), new BN(Math.round(task.payment_amount_sol * 1e9)), new BN(Math.floor(new Date(task.created_at).getTime() / 1000) + 86400)).accountsStrict({ buyer: buyer.publicKey, authority: authority.publicKey, escrow: pda, systemProgram: SystemProgram.programId }).signers([buyer]).rpc();
      }
      return this.receipt(connection, signature, 'initialize', task.payment_amount_sol * task.slots.length);
    });
  }
  // `share` is the fraction of the slot allocation this settlement moves, so a seller that verified
  // some of a decomposed task is paid for that part. The deployed program settles a slot whole, so a
  // fractional share is only expressible in simulated settlement and is refused on chain.
  settle(task: Task, slot: number, pass: boolean, hash: string, share = 1): Promise<Receipt> {
    const operation = pass ? 'release' : 'refund';
    const amount_sol = Math.round(task.payment_amount_sol * share * 1e9) / 1e9;
    return this.runtime.call<Receipt>('solana', operation, () => ({ operation, mocked: true, signature: `MOCK-${task.task_id}-${operation}-${slot}`, explorer_url: null, amount_sol, evidence_hash: hash }), async () => {
      if (this.runtime.env.SOLANA_SETTLEMENT === 'transfer') return this.transferSettlement(task, slot, pass, hash, amount_sol);
      if (share !== 1) throw new ServiceUnavailable('solana', 'Partial settlement is not supported by the deployed escrow program');
      if (task.request.protected && pass && task.deliveries.filter(d => d.seller_id === task.slots[slot].seller_id).some(d => d.verification?.mocked)) throw new ServiceUnavailable('solana', 'Refusing live payout for mocked verification');
      const { connection, buyer, authority, program, pda, account } = await this.client(task);
      const existing = await account.fetchNullable(pda);
      if (!existing) throw new ServiceUnavailable('solana', 'Escrow missing');
      let signature: string;
      if (existing.states[slot] !== 0) {
        if (existing.states[slot] !== (pass ? 1 : 2) || Buffer.from(existing.evidenceHashes[slot]).toString('hex') !== hash) throw new ServiceUnavailable('solana', 'Settlement conflicts with committed evidence');
        signature = await this.recover(connection, pda, `COSIGN ${operation} slot=${slot}`);
      } else if (pass) {
        signature = await program.methods.release(slot, [...Buffer.from(hash, 'hex')]).accountsStrict({ authority: authority.publicKey, escrow: pda, seller: new PublicKey(task.slots[slot].address) }).rpc();
      } else {
        signature = await program.methods.refund(slot, [...Buffer.from(hash, 'hex')]).accountsStrict({ caller: authority.publicKey, escrow: pda, buyer: buyer.publicKey }).rpc();
      }
      return this.receipt(connection, signature, operation, task.payment_amount_sol, hash);
    });
  }
}
