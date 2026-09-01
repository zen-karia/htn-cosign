import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, symlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { Keypair } from '@solana/web3.js';
const root = process.cwd();
for (const path of ['.tools/anchor/bin/anchor', '.tools/solana-release/bin/cargo-build-sbf', '.tools/platform-tools/rust/bin/rustc']) if (!existsSync(path)) throw new Error(`Missing ${path}. Run npm run tools:chain first (requires several GB of free disk).`);
mkdirSync('.keys', { recursive: true }); mkdirSync('target/deploy', { recursive: true });
if (!existsSync('.keys/program.json')) writeFileSync('.keys/program.json', JSON.stringify([...Keypair.generate().secretKey]), { mode: 0o600 });
const programId = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync('.keys/program.json', 'utf8')))).publicKey.toBase58();
copyFileSync('.keys/program.json', 'target/deploy/cosign_escrow-keypair.json');
const sdk = '.tools/solana-release/bin/platform-tools-sdk/sbf';
mkdirSync(`${sdk}/dependencies`, { recursive: true });
if (!existsSync(`${sdk}/dependencies/platform-tools`)) symlinkSync(resolve('.tools/platform-tools'), `${sdk}/dependencies/platform-tools`, 'dir');
// SDK post-processing sources install.sh independently of --skip-tools-install.
// Mark the already provisioned compiler and unused C test dependency locally so it never installs globally.
writeFileSync(`${sdk}/dependencies/platform-tools-v1.48.md`, 'Provisioned inside this project.\n');
mkdirSync(`${sdk}/dependencies/criterion`, { recursive: true });
writeFileSync(`${sdk}/dependencies/criterion-v2.3.2.md`, 'C test runner is not used by this Rust program.\n');
writeFileSync(`${sdk}/dependencies/criterion-v2.3.3.md`, 'C test runner is not used by this Rust program.\n');
const env = { ...process.env, CARGO_HOME: resolve('.tools/cargo'), CARGO_TARGET_DIR: resolve('target'), CARGO_PROFILE_DEV_DEBUG: '0', CARGO_PROFILE_TEST_DEBUG: '0', CARGO_INCREMENTAL: '0', RUSTUP_TOOLCHAIN: 'stable', PATH: [resolve('.tools/anchor/bin'), resolve('.tools/solana-release/bin'), process.env.PATH].join(':') };
function run(cmd, args, variables = env) { const result = spawnSync(cmd, args, { stdio: 'inherit', env: variables }); if (result.status !== 0) throw new Error(`${cmd} failed`); }
run('.tools/anchor/bin/anchor', ['keys', 'sync']);
// Use the downloaded compiler directly; never register a Rust toolchain outside the project.
run('.tools/solana-release/bin/cargo-build-sbf', ['--workspace', '--skip-tools-install', '--no-rustup-override', '--sbf-out-dir', resolve('target/deploy')], { ...env, RUSTC: resolve('.tools/platform-tools/rust/bin/rustc'), PATH: `${resolve('.tools/platform-tools/rust/bin')}:${env.PATH}` });
run('.tools/anchor/bin/anchor', ['idl', 'build', '--out', 'src/data/escrow-idl.json', '--out-ts', 'src/data/escrow-types.ts']);
if (existsSync('.env')) writeFileSync('.env', readFileSync('.env', 'utf8').replace(/^SOLANA_PROGRAM_ID=.*$/m, `SOLANA_PROGRAM_ID=${programId}`));
console.log(`Built SBF + compiler IDL for ${programId}. Run npm run setup before using the Worker.`);
