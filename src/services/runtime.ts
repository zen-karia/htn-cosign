import { mockEnabled, type ServiceEvidence, type Settings } from '../core/models';
export type EvidenceSink = (e: ServiceEvidence) => void;
export class ServiceUnavailable extends Error { constructor(public service: string, message: string) { super(`${service}: ${message}`); } }
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
  async json<T>(url: string, init: RequestInit, timeout = 45_000): Promise<T> {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeout) });
    if (!response.ok) throw new ServiceUnavailable('http', `HTTP ${response.status}`);
    return response.json() as Promise<T>;
  }
}
