import { readFileSync } from 'node:fs';
import type { Task } from '../src/core/models';
const cached = JSON.parse(readFileSync('artifacts/demo-cache.json', 'utf8')) as { task: Task; cached_at: string };
console.log(`OFFLINE REPLAY · Recorded ${cached.cached_at} · No API calls, no payments`);
for (const event of cached.task.activity) console.log(`${event.at.slice(11, 19)} ${event.stage.padEnd(12)} ${event.message}`);
console.log(`Replay finished: ${cached.task.paid_sol.toFixed(3)} SOL paid, ${cached.task.refunded_sol.toFixed(3)} SOL returned in the recorded run.`);
