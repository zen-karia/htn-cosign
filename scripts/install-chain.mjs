import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, unlinkSync, chmodSync, statfsSync } from 'node:fs';
const darwin = process.platform === 'darwin', linux = process.platform === 'linux';
if (!darwin && !linux) throw new Error('Use macOS or Linux/WSL for the project-local chain toolchain.');
const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
const target = darwin ? `${arch}-apple-darwin` : `${arch}-unknown-linux-gnu`;
if (['.tools/anchor/bin/anchor', '.tools/solana-release/bin/cargo-build-sbf', '.tools/platform-tools/rust/bin/rustc'].every(existsSync)) { console.log('Project-local chain tools are already installed.'); process.exit(0); }
const disk = statfsSync('.'); if (disk.bavail * disk.bsize < 4 * 1024 ** 3) throw new Error('Chain tools/build require at least 4 GB free disk. Only project caches may be cleared automatically.');
mkdirSync('.tools/downloads', { recursive: true }); mkdirSync('.tools/anchor/bin', { recursive: true });
function run(cmd, args) { const r = spawnSync(cmd, args, { stdio: 'inherit' }); if (r.status !== 0) throw new Error(`${cmd} failed; rerun to resume downloads.`); }
function download(url, path) { run('curl', ['--http1.1', '-fL', '--retry', '3', '--connect-timeout', '15', '--max-time', '900', '-C', '-', url, '-o', path]); }
if (!existsSync('.tools/anchor/bin/anchor')) { download(`https://github.com/otter-sec/anchor/releases/download/v0.31.1/anchor-0.31.1-${target}`, '.tools/anchor/bin/anchor'); chmodSync('.tools/anchor/bin/anchor', 0o755); }
if (!existsSync('.tools/solana-release/bin/cargo-build-sbf')) { download(`https://github.com/anza-xyz/agave/releases/download/v2.3.13/solana-release-${target}.tar.bz2`, '.tools/downloads/solana.tar.bz2'); run('tar', ['-xjf', '.tools/downloads/solana.tar.bz2', '-C', '.tools']); unlinkSync('.tools/downloads/solana.tar.bz2'); }
if (!existsSync('.tools/platform-tools/rust/bin/rustc')) { download(`https://github.com/anza-xyz/platform-tools/releases/download/v1.48/platform-tools-${darwin ? 'osx' : 'linux'}-${arch}.tar.bz2`, '.tools/downloads/platform-tools.tar.bz2'); mkdirSync('.tools/platform-tools', { recursive: true }); run('tar', ['-xjf', '.tools/downloads/platform-tools.tar.bz2', '-C', '.tools/platform-tools']); unlinkSync('.tools/downloads/platform-tools.tar.bz2'); }
console.log('Project-local chain tools ready. No global shell profile or Rust configuration was changed.');
