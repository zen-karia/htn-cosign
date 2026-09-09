import { mockEnabled, type ServiceEvidence, type Settings } from '../core/models';
export type EvidenceSink = (e: ServiceEvidence) => void;
export class ServiceUnavailable extends Error { constructor(public service: string, message: string) { super(`${service}: ${message}`); } }
// Transient by nature: the same request a moment later is expected to succeed.
const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);
export class Runtime {
  constructor(public env: Settings, public evidence: EvidenceSink = () => {}) {}
  mocked(service: string) { return mockEnabled(this.env, service); }
  async call<T>(service: string, operation: string, mock: () => T | Promise<T>, live: () => Promise<T>): Promise<T> {
    const start = Date.now(), mocked = this.mocked(service);
    try {
      const result = await (mocked ? mock() : live());
      this.evidence({ service, operation, mocked, ok: true, at: new Date().toISOString(), duration_ms: Date.now() - start });
      console.info(`${mocked ? '[MOCKED]' : '[LIVE]'} ${service}.${operation} OK`);
      return result;
    } catch (err) {
      // Avoid logging response bodies, URLs, headers, or arbitrary provider messages (may contain secrets).
      const raw = err instanceof ServiceUnavailable ? err.message : err instanceof Error && /\b429\b/.test(err.message) ? 'Upstream rate limit (HTTP 429)' : 'Request failed or returned an invalid response';
      // Re-wrapping an error already scoped to this service would read 'evidence: evidence: ...'.
      const message = raw.startsWith(`${service}: `) ? raw.slice(service.length + 2) : raw;
      this.evidence({ service, operation, mocked, ok: false, at: new Date().toISOString(), duration_ms: Date.now() - start, error: message });
      throw new ServiceUnavailable(service, message);
    }
  }
  require(key: string) { const value = this.env[key]; if (!value) throw new ServiceUnavailable(key, 'Missing configuration; live mode does not silently fall back'); return value; }
  // A 429 is an instruction to wait, not a verdict. Retrying it immediately, which is what
  // happened before, turns one rate limit into three and stalls a run that would have gone
  // through a second later. Only Elastic, GPTZero and OpenAI reach this: Solana settles through
  // web3.js, so nothing here can resubmit a transaction.
  async json<T>(url: string, init: RequestInit, timeout = 45_000, attempts = 3): Promise<T> {
    const base = Number(this.env.HTTP_RETRY_BASE_MS ?? 1200);
    for (let attempt = 1; ; attempt++) {
      const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeout) });
      if (response.ok) return response.json() as Promise<T>;
      if (attempt >= attempts || !RETRYABLE.has(response.status)) throw new ServiceUnavailable('http', `HTTP ${response.status}`);
      // Honour the server's own figure when it gives one, and jitter otherwise so that several
      // calls rate limited together do not all come back at the same moment.
      const after = Number(response.headers.get('retry-after'));
      const wait = Number.isFinite(after) && after > 0 ? Math.min(after * 1000, 10_000) : base * 2 ** (attempt - 1) + Math.random() * 400;
      await new Promise(resolve => setTimeout(resolve, wait));
    }
  }
}
