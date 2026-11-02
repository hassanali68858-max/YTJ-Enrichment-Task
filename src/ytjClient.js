// Thin client for PRH's open YTJ API v3.
// Docs: https://avoindata.prh.fi/en/ytj/swagger-ui
// No API key is required. We are polite: per-request timeout, bounded retries with
// exponential backoff on 429/5xx/network errors, and an in-memory cache so duplicate
// rows in a CSV do not hit the API twice.

export const DEFAULT_BASE_URL = 'https://avoindata.prh.fi/opendata-ytj-api/v3';

export class YtjError extends Error {
  constructor(message, { status, retriable } = {}) {
    super(message);
    this.name = 'YtjError';
    this.status = status;
    this.retriable = retriable;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createYtjClient({
  baseUrl = DEFAULT_BASE_URL,
  timeoutMs = 10_000,
  retries = 2,
  fetchImpl = globalThis.fetch,
  cacheTtlMs = 15 * 60_000,
} = {}) {
  const cache = new Map(); // url -> { at, promise }

  async function request(path, params) {
    const url = `${baseUrl}${path}?${new URLSearchParams(params)}`;
    const hit = cache.get(url);
    if (hit && Date.now() - hit.at < cacheTtlMs) return hit.promise;

    const promise = (async () => {
      let lastErr;
      for (let attempt = 0; attempt <= retries; attempt++) {
        if (attempt > 0) await sleep(300 * 2 ** (attempt - 1));
        try {
          const res = await fetchImpl(url, {
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(timeoutMs),
          });
          if (res.status === 404) return { totalResults: 0, companies: [] };
          if (res.status === 429 || res.status >= 500) {
            lastErr = new YtjError(`YTJ responded ${res.status}`, { status: res.status, retriable: true });
            continue;
          }
          if (!res.ok) {
            throw new YtjError(`YTJ responded ${res.status}`, { status: res.status, retriable: false });
          }
          return await res.json();
        } catch (err) {
          if (err instanceof YtjError && !err.retriable) throw err;
          lastErr = err instanceof YtjError
            ? err
            : new YtjError(`YTJ request failed: ${err.message}`, { retriable: true });
        }
      }
      throw lastErr;
    })();

    cache.set(url, { at: Date.now(), promise });
    promise.catch(() => cache.delete(url)); // never cache failures
    return promise;
  }

  return {
    /** Returns the raw company object or null. */
    async getByBusinessId(businessId) {
      const data = await request('/companies', { businessId });
      // Defensive: never trust that the filter was applied - only accept an exact ID match.
      return (data.companies ?? []).find((c) => c.businessId?.value === businessId) ?? null;
    },
    /** Returns { totalResults, companies } (first page, max 100 results). */
    async searchByName(name) {
      const data = await request('/companies', { name });
      return { totalResults: data.totalResults ?? 0, companies: data.companies ?? [] };
    },
  };
}
