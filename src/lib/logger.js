// Minimal structured (JSON lines) logger. Enough to grep locally and to ship to any
// log platform later; swapping in pino would be a one-file change.

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

/** @param {{ level?: string, base?: object, write?: (line: string) => void }} [opts] */
export function createLogger({ level = 'info', base = {}, write = (l) => process.stderr.write(l + '\n') } = {}) {
  const min = LEVELS[level] ?? LEVELS.info;
  const log = (lvl) => (msg, fields = {}) => {
    if (LEVELS[lvl] < min) return;
    write(JSON.stringify({ time: new Date().toISOString(), level: lvl, msg, ...base, ...fields }));
  };
  return {
    debug: log('debug'),
    info: log('info'),
    warn: log('warn'),
    error: log('error'),
    /** @param {object} fields */
    child: (fields) => createLogger({ level, base: { ...base, ...fields }, write }),
  };
}

/** @typedef {ReturnType<typeof createLogger>} Logger */

export const silentLogger = createLogger({ level: 'silent' });
