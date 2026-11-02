// All runtime configuration in one place, read from environment variables.
// Defaults are chosen for a laptop demo; production would set them explicitly.

const int = (name, fallback) => {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${name} must be a non-negative integer, got "${raw}"`);
  return n;
};

export function loadConfig() {
  return Object.freeze({
    port: int('PORT', 3000),
    logLevel: process.env.LOG_LEVEL ?? 'info',
    mock: process.env.YTJ_MOCK === '1',
    ytj: Object.freeze({
      baseUrl: process.env.YTJ_BASE_URL ?? 'https://avoindata.prh.fi/opendata-ytj-api/v3',
      timeoutMs: int('YTJ_TIMEOUT_MS', 10_000),
      retries: int('YTJ_RETRIES', 3),
      concurrency: int('YTJ_CONCURRENCY', 2),
      // Minimum gap between upstream requests. PRH publishes no rate limit, but it does
      // start refusing connections under bursts, so we pace ourselves.
      minIntervalMs: int('YTJ_MIN_INTERVAL_MS', 150),
      cacheTtlMs: int('YTJ_CACHE_TTL_MS', 15 * 60_000),
    }),
    limits: Object.freeze({
      maxBodyBytes: int('MAX_BODY_BYTES', 1_000_000),
      maxRows: int('MAX_ROWS', 2_000),
    }),
  });
}
