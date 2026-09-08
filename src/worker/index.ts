import { DurableObject } from 'cloudflare:workers';
import { pdfText } from '../services/evidence';
import * as Sentry from '@sentry/cloudflare';
import { z } from 'zod';
import { createTask, Engine } from '../core/engine';
import { TaskRequest, mockEnabled, type Settings, type Task } from '../core/models';
import { ServiceUnavailable } from '../services/runtime';
import { DEMO_CLAIM, COMPLEX_CLAIM } from '../data/corpus';

interface Env {
  TASKS: DurableObjectNamespace; BOARD: DurableObjectNamespace; CONFIG: KVNamespace; ASSETS: Fetcher;
  [key: string]: unknown;
}
const settings = (env: Env): Settings => Object.fromEntries(Object.entries(env).filter(([, value]) => typeof value === 'string')) as Settings;
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'cache-control': 'no-store', 'x-cosign-backend': 'cloudflare-durable-objects' } });
const options = (env: Env) => ({ dsn: String(env.SENTRY_DSN || ''), enabled: !mockEnabled(settings(env), 'sentry') && !!env.SENTRY_DSN, tracesSampleRate: 1, environment: String(env.SENTRY_ENVIRONMENT || 'devnet-demo'), sendDefaultPii: false });

class BoardBase extends DurableObject<Env> {
  async fetch(request: Request) {
    if (request.method === 'PUT') { const task = await request.json() as Task; await this.ctx.storage.put(task.task_id, { task_id: task.task_id, claim: task.claim, status: task.status, created_at: task.created_at, phase: task.phase, paid_sol: task.paid_sol, refunded_sol: task.refunded_sol }); return json({ ok: true }); }
    const all = await this.ctx.storage.list(); return json([...all.values()].sort((a: any, b: any) => b.created_at.localeCompare(a.created_at)).slice(0, 100));
  }
}
export const BoardObject = Sentry.instrumentDurableObjectWithSentry(options, BoardBase);

class TaskBase extends DurableObject<Env> {
  private task?: Task;
  private busy = false;
  private writes: Promise<void> = Promise.resolve();
  constructor(ctx: DurableObjectState, env: Env) { super(ctx, env); ctx.blockConcurrencyWhile(async () => { this.task = await ctx.storage.get<Task>('task'); }); }
  private async save(task: Task) {
    const snapshot = structuredClone(task);
    this.writes = this.writes.catch(() => {}).then(async () => {
      await this.ctx.storage.put('task', snapshot);
      await this.env.BOARD.get(this.env.BOARD.idFromName('board')).fetch('https://internal/board', { method: 'PUT', body: JSON.stringify(snapshot) });
    });
    return this.writes;
  }
  async fetch(request: Request) {
    const path = new URL(request.url).pathname;
    if (request.method === 'POST' && path.endsWith('/create')) {
      const raw = await request.json() as { id: string; request: unknown };
      if (this.task) return JSON.stringify(this.task.request) === JSON.stringify(TaskRequest.parse(raw.request)) ? json(this.task, 200) : json({ error: 'Idempotency key already used for a different task' }, 409);
      this.task = createTask(raw.request, settings(this.env), raw.id);
      const creationSpan = Sentry.getActiveSpan();
      if (creationSpan && !this.task.service_modes.sentry) { const context = creationSpan.spanContext(); this.task.trace_id = context.traceId; this.task.trace_parent_span_id = context.spanId; }
      await this.save(this.task); await this.ctx.storage.setAlarm(Date.now() + 100);
      return json(this.task, 201);
    }
    if (!this.task) return json({ error: 'Task not found' }, 404);
    if (request.method === 'POST' && path.endsWith('/retry')) {
      if (!this.busy && this.task.phase !== 'complete') { this.task.attempts = 0; delete this.task.error; await this.save(this.task); await this.ctx.storage.setAlarm(Date.now() + 100); }
      return json(this.task, 202);
    }
    return json(this.task);
  }
  async alarm() {
    if (!this.task || this.task.phase === 'complete' || this.busy) return;
    this.busy = true; this.task.running = true;
    // A persisted trace ID links stage transactions across Durable Object alarm restarts.
    const task = this.task;
    try {
      await Sentry.withActiveSpan(null, () => Sentry.continueTrace({ sentryTrace: `${task.trace_id}-${task.trace_parent_span_id || task.trace_id.slice(0, 16)}-1`, baggage: undefined }, () => Sentry.startSpan({ name: `cosign.task.${task.phase}`, op: 'cosign.pipeline', forceTransaction: true, attributes: { 'cosign.task_id': task.task_id } }, async () => {
        const engine = new Engine(task, settings(this.env), t => this.save(t), (name, f) => Sentry.startSpan({ name, op: `cosign.${name}` }, f));
        await engine.step(); task.attempts = 0; delete task.error;
      })));
    } catch (err) {
      task.attempts += 1; task.status = 'stalled';
      task.error = err instanceof ServiceUnavailable ? err.message : 'Pipeline stage failed. Payment remains protected; see local server logs.';
      console.error('Cosign stage failed:', task.phase, err instanceof Error ? err.name : 'UnknownError');
      Sentry.captureException(err);
      task.activity.push({ id: task.activity.length + 1, at: new Date().toISOString(), stage: 'run.failed', message: task.error, mocked: false });
    } finally {
      this.busy = false; task.running = false;
      await this.save(task);
      if (task.phase !== 'complete' && task.attempts < 3) await this.ctx.storage.setAlarm(Date.now() + (task.attempts ? 2000 * 2 ** task.attempts : 150));
    }
  }
}
export const TaskObject = Sentry.instrumentDurableObjectWithSentry(options, TaskBase);

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
      if (request.method !== 'GET') {
        const origin = request.headers.get('origin');
        if (origin && origin !== url.origin) return json({ error: 'Cross-origin mutations rejected' }, 403);
        const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
        // Open public demo: mutations are unauthenticated unless API_TOKEN is set. Setting that
        // secret re-locks the instance to callers holding the bearer token.
        if (!local && env.API_TOKEN && request.headers.get('authorization') !== `Bearer ${env.API_TOKEN}`) return json({ error: 'Authorization required outside localhost' }, 401);
      }
      if (url.pathname === '/api/config') {
        const required: Record<string, string[]> = { openai: ['OPENAI_API_KEY'], elasticsearch: ['ELASTICSEARCH_URL'], gptzero: ['GPTZERO_API_KEY'], sentry: ['SENTRY_DSN'] };
        const services = Object.fromEntries(['openai', 'gptzero', 'elasticsearch', 'solana', 'sentry'].map(s => [s, {
          // Report what each service is actually set to. Settlement was hardcoded as mocked here,
          // so a real devnet payout still described itself as simulated.
          mocked: mockEnabled(settings(env), s), optional: ['gptzero', 'sentry'].includes(s),
          configured: s === 'solana' || (required[s] || []).every(key => typeof env[key] === 'string' && String(env[key]).length > 0),
        }]));
        const config = await env.CONFIG.get('demo', 'json');
        return json({ mode: 'LIVE', settlement: mockEnabled(settings(env), 'solana') ? 'SIMULATED' : 'DEVNET', backend: 'Cloudflare Worker + per-task SQLite Durable Object', services, demo_claim: DEMO_CLAIM, complex_claim: COMPLEX_CLAIM, config, sentry_dsn: mockEnabled(settings(env), 'sentry') ? null : env.SENTRY_PUBLIC_DSN || env.SENTRY_DSN || null, sentry_org: env.SENTRY_ORG || null });
      }
      if (url.pathname === '/api/tasks' && request.method === 'GET') return env.BOARD.get(env.BOARD.idFromName('board')).fetch('https://internal/board');
      // A dropped PDF is turned into text here rather than in the browser: unpdf already runs
      // inside workerd for source retrieval, so the bundle stays free of a second pdf.js copy.
      if (url.pathname === '/api/extract' && request.method === 'POST') {
        const bytes = new Uint8Array(await request.arrayBuffer());
        if (!bytes.length) return json({ error: 'Empty upload' }, 400);
        if (bytes.length > 8_000_000) return json({ error: 'File larger than 8 MB' }, 413);
        try {
          const text = await pdfText(bytes);
          if (!text) return json({ error: 'No selectable text found. A scanned PDF needs OCR first.' }, 422);
          return json({ text });
        } catch { return json({ error: 'Could not read that PDF.' }, 422); }
      }
      if (url.pathname === '/api/tasks' && request.method === 'POST') {
        if (Number(request.headers.get('content-length') || 0) > 24000) return json({ error: 'Request too large' }, 413);
        const body = await request.text(); if (body.length > 24000) return json({ error: 'Request too large' }, 413);
        const parsed = TaskRequest.parse(JSON.parse(body));
        if (parsed.execution_mode === 'live') {
          const missing = ['OPENAI_API_KEY', 'ELASTICSEARCH_URL'].filter(key => !env[key]);
          if (missing.length) return json({ error: `Live verification is not configured (${missing.join(', ')}).` }, 503);
        }
        const key = request.headers.get('idempotency-key');
        if (key && !/^[\w-]{8,100}$/.test(key)) return json({ error: 'Invalid idempotency key' }, 400);
        const id = key || crypto.randomUUID();
        return env.TASKS.get(env.TASKS.idFromName(id)).fetch('https://internal/create', { method: 'POST', body: JSON.stringify({ id, request: parsed }) });
      }
      const match = url.pathname.match(/^\/api\/tasks\/([\w-]{8,100})(\/retry)?$/);
      if (match && ((!match[2] && request.method === 'GET') || (match[2] && request.method === 'POST'))) return env.TASKS.get(env.TASKS.idFromName(match[1])).fetch(`https://internal${match[2] || '/'}`, { method: request.method });
      return json({ error: 'Not found' }, 404);
    } catch (err) {
      if (err instanceof z.ZodError) return json({ error: 'Invalid task', issues: err.issues.map(x => ({ path: x.path, message: x.message })) }, 400);
      if (err instanceof SyntaxError) return json({ error: 'Invalid JSON' }, 400);
      Sentry.captureException(err); return json({ error: 'Internal error; no payment authorized' }, 500);
    }
  },
};
export default Sentry.withSentry(options, worker);
