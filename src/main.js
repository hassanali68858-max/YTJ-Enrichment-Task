// Composition root: read config, wire dependencies, start the server, shut down cleanly.

import { loadConfig } from './config.js';
import { createLogger } from './lib/logger.js';
import { createYtjClient } from './ytj/client.js';
import { createMockRegistry } from './ytj/mockClient.js';
import { createServer } from './http/server.js';

const config = loadConfig();
const logger = createLogger({ level: config.logLevel, base: { service: 'ytj-enrichment' } });
const registry = config.mock
  ? createMockRegistry()
  : createYtjClient({ ...config.ytj, logger: logger.child({ component: 'ytj' }) });

const server = createServer({ registry, logger, concurrency: config.ytj.concurrency, limits: config.limits });

server.listen(config.port, () => {
  logger.info('listening', { url: `http://localhost:${config.port}`, mock: config.mock });
});

// Graceful shutdown: stop accepting connections, let in-flight requests finish.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    logger.info('shutting down', { signal });
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
