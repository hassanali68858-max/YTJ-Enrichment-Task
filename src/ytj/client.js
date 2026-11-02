// Client for PRH's open YTJ API v3 (no API key).
// Docs: https://avoindata.prh.fi/en/ytj/swagger-ui
//
// Behaviour:
//  - per-request timeout
//  - pacing: a minimum gap between requests (PRH refuses connections under bursts)
//  - retries with exponential backoff + jitter on 429, 5xx and network errors only
//  - in-flight de-duplication + TTL cache, so duplicate CSV rows cost one request
//  - errors carry the low-level cause (e.g. ECONNREFUSED) so failures are diagnosable

import { silentLogger } from '../lib/logger.js';

export class YtjError extends Error {
  /** @param {string} message @param {{ status?: number, retriable?: boolean, code?: string }} [info] */
  constructor(message, { status, retriable = false, code } = {}) {
    super(message);
    this.name = 'YtjError';
    this.status = status;
    this.retriable = retriable;
    this.code = code;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Serialises request start times so they are at least `minIntervalMs` apart. */
function createPacer(minIntervalMs) {
  let next = 0;
  return async () => {
    const now = Date.now();
    const at = Math.max(now, next);
    next = at + minIntervalMs;
    if (at > now) await sleep(at - now);
  };
}

/**
 * @param {{ baseUrl?: string, timeoutMs?: number, retries?: number, minIntervalMs?: number,
 *   cacheTtlMs?: number, fetchImpl?: typeof fetch, logger?: import('../lib/logger.js').Logger,
 *   backoffBaseMs?: number }} [opts]
 * @returns {import('../types.js').CompanyRegistry & { stats: () => object }}
 */
export function createYtjClient({
  baseUrl = 'https://avoindata.prh.fi/opendata-ytj-api/v3',
  timeoutMs = 10_000,
  retries = 3,
  minIntervalMs = 150,
  cacheTtlMs = 15 * 60_000,
  fetchImpl = globalThis.fetch,
  logger = silentLogger,
  backoffBaseMs = 400,
} = {}) {
  /** @type {Map<string, { at: number, promise: Promise<any> }>} */
  const cache = new Map();
  const pace = createPacer(minIntervalMs);
  const stats = { requests: 0, cacheHits: 0, retries: 0, failures: 0 };

  async function attempt(url) {
    await pace();
    stats.requests++;
    const started = Date.now();
    let res;
    try {
      res = await fetchImpl(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      const code = err?.cause?.code ?? (err?.name === 'TimeoutError' ? 'ETIMEDOUT' : err?.name);
      throw new YtjError(`YTJ unreachable (${code ?? err.message})`, { retriable: true, code });
    }
    logger.debug('ytj request', { url, status: res.status, ms: Date.now() - started });
    if (res.status === 404) return { totalResults: 0, companies: [] };
    if (res.status === 429 || res.status >= 500) {
      throw new YtjError(`YTJ responded ${res.status}`, { status: res.status, retriable: true });
    }
    if (!res.ok) throw new YtjError(`YTJ responded ${res.status}`, { status: res.status });
    try {
      return await res.json();
    } catch {
      throw new YtjError('YTJ returned invalid JSON', { status: res.status, retriable: true });
    }
  }

  async function request(path, params) {
    const url = `${baseUrl}${path}?${new URLSearchParams(params)}`;
    const hit = cache.get(url);
    if (hit && Date.now() - hit.at < cacheTtlMs) {
      stats.cacheHits++;
      return hit.promise;
    }

    const promise = (async () => {
      for (let i = 0; ; i++) {
        try {
          return await attempt(url);
        } catch (err) {
          if (!(err instanceof YtjError) || !err.retriable || i >= retries) {
            stats.failures++;
            logger.warn('ytj request failed', { url, error: err.message, attempts: i + 1 });
            throw err;
          }
          stats.retries++;
          const delay = backoffBaseMs * 2 ** i * (0.5 + Math.random()); // full-ish jitter
          logger.debug('ytj retry', { url, error: err.message, attempt: i + 1, delayMs: Math.round(delay) });
          await sleep(delay);
        }
      }
    })();

    cache.set(url, { at: Date.now(), promise });
    promise.catch(() => cache.delete(url)); // never cache failures
    return promise;
  }

  return {
    async getByBusinessId(businessId) {
      const data = await request('/companies', { businessId });
      // Defensive: only accept an exact ID match, never "first result".
      return (data.companies ?? []).find((c) => c.businessId?.value === businessId) ?? null;
    },
    async searchByName(name) {
      const data = await request('/companies', { name });
      return { totalResults: data.totalResults ?? 0, companies: data.companies ?? [] };
    },
    stats: () => ({ ...stats, cacheSize: cache.size }),
  };
}
