import { describe, expect, it, vi } from 'vitest';
import { BorshAccountsCoder, Program, AnchorProvider, type Idl } from '@coral-xyz/anchor';
import { Connection, Keypair, Transaction, VersionedTransaction } from '@solana/web3.js';
import BN from 'bn.js';
import { digest, Escrow, DEVNET_GENESIS } from '../src/services/escrow';
import { Runtime } from '../src/services/runtime';
import { createTask } from '../src/core/engine';
import { readFileSync } from 'node:fs';
import idl from '../src/data/escrow-idl.json';

describe('escrow contract/client alignment', () => {
  it('requires the full devnet genesis hash and rejects other clusters before signing', async () => {
    const spy = vi.spyOn(Connection.prototype, 'getGenesisHash').mockResolvedValue('5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp');
    try {
      const client = new Escrow(new Runtime({}));
      await expect(client.connection()).rejects.toThrow('non-devnet');
      spy.mockResolvedValue(DEVNET_GENESIS.slice(0, 32)); await expect(client.connection()).rejects.toThrow('non-devnet');
      spy.mockResolvedValue('EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG'); await expect(client.connection()).resolves.toBeInstanceOf(Connection);
    } finally { spy.mockRestore(); }
  });
  it('uses compiler IDL matching the declared program and bounded account layout', async () => {
    expect(readFileSync('programs/cosign-escrow/src/lib.rs', 'utf8')).toContain(`declare_id!("${idl.address}")`);
    const payer = Keypair.generate();
    const signTransaction = async <T extends Transaction | VersionedTransaction>(tx: T) => tx;
    const program = new Program(idl as Idl, new AnchorProvider(new Connection('https://api.devnet.solana.com'), { publicKey: payer.publicKey, signTransaction, signAllTransactions: async txs => txs }, {}));
    const coder = program.coder.accounts as BorshAccountsCoder;
    const data = { buyer: payer.publicKey, authority: payer.publicKey, taskHash: Array(32).fill(1), sellers: Array(4).fill(payer.publicKey), amountPerSeller: new BN(50_000_000), expiresAt: new BN(1000), states: [1, 2, 0, 0], evidenceHashes: Array(4).fill(Array(32).fill(2)), count: 4, bump: 255 };
    const encoded = await coder.encode('escrow', data);
    expect(encoded.length).toBe(382);
    expect(coder.decode('escrow', encoded).states).toEqual([1, 2, 0, 0]);
  });
  it('hashes evidence canonically across property-order changes', async () => {
    expect(await digest({ z: 2, a: { x: 1, y: 2 } })).toBe(await digest({ a: { y: 2, x: 1 }, z: 2 }));
    expect(await digest({ pass: true })).not.toBe(await digest({ pass: false }));
  });
  it('never constructs a fake explorer link in mock settlement', async () => {
    const task = createTask({ claim: 'A sufficiently long test claim.' }, {});
    const service = new Escrow(new Runtime({}));
    expect((await service.initialize(task)).explorer_url).toBeNull();
    expect((await service.settle(task, 0, false, await digest('evidence'))).explorer_url).toBeNull();
  });
});
