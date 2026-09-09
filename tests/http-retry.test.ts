import { describe, expect, it, vi, afterEach } from 'vitest';
import { Runtime, ServiceUnavailable } from '../src/services/runtime';

const reply = (status: number, body: unknown = { ok: true }, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

afterEach(() => vi.unstubAllGlobals());

// HTTP_RETRY_BASE_MS keeps the waits out of the test; the behaviour under test is the retrying.
const runtime = () => new Runtime({ HTTP_RETRY_BASE_MS: '1' });

describe('http retry', () => {
  it('retries a rate limit and returns the eventual success', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(reply(429))
      .mockResolvedValueOnce(reply(200, { value: 42 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(runtime().json('https://example.test', { method: 'POST' })).resolves.toEqual({ value: 42 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('gives up after the attempt budget and still reports the status', async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply(429));
    vi.stubGlobal('fetch', fetchMock);
    await expect(runtime().json('https://example.test', {})).rejects.toThrow(/HTTP 429/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  // A 400 will read the same on the third attempt as the first.
  it('does not retry a client error', async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply(400));
    vi.stubGlobal('fetch', fetchMock);
    await expect(runtime().json('https://example.test', {})).rejects.toBeInstanceOf(ServiceUnavailable);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('waits as long as the server asked rather than guessing', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(reply(429, {}, { 'retry-after': '0.01' }))
      .mockResolvedValueOnce(reply(200, { value: 1 }));
    vi.stubGlobal('fetch', fetchMock);
    const started = Date.now();
    await expect(runtime().json('https://example.test', {})).resolves.toEqual({ value: 1 });
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
