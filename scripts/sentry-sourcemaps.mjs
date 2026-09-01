import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { config } from 'dotenv';
config({ quiet: true });
const { SENTRY_AUTH_TOKEN, SENTRY_ORG, SENTRY_PROJECT } = process.env;
const dir = 'dist/worker';
if (!existsSync(dir)) { console.log(`Sentry source maps skipped: ${dir} has not been built.`); process.exit(0); }
const missing = Object.entries({ SENTRY_AUTH_TOKEN, SENTRY_ORG, SENTRY_PROJECT }).filter(([, value]) => !value).map(([key]) => key);
if (missing.length) {
  console.log(`Sentry source maps skipped: ${missing.join(', ')} not set. Deployed Worker stack traces stay unreadable until this runs.`);
  process.exit(0);
}
const cli = 'node_modules/@sentry/cli/bin/sentry-cli';
for (const args of [['sourcemaps', 'inject', dir], ['sourcemaps', 'upload', '--org', SENTRY_ORG, '--project', SENTRY_PROJECT, dir]]) {
  const result = spawnSync(process.execPath, [cli, ...args], { stdio: 'inherit', env: process.env });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
