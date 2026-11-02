// HTTP layer only: routing, parsing, limits, status codes. No business logic here.
//
//   POST /api/enrich?lang=en|fi|sv&format=json|netsuite-csv   body: CSV, or JSON { "csv": "..." }
//   GET  /api/companies/:businessId?lang=..                   single normalised lookup
//   GET  /healthz                                              liveness + upstream client stats
//   GET  /                                                     small UI

import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { parseCustomerCsv } from '../lib/csv.js';
import { enrichRows } from '../enrich.js';
import { normalizeBusinessId } from '../domain/businessId.js';
import { normalizeCompany } from '../domain/normalize.js';
import { toNetSuiteCsv } from '../export/netsuiteCsv.js';
import { silentLogger } from '../lib/logger.js';

const UI_PATH = new URL('../../public/index.html', import.meta.url);
const LANGS = new Set(['en', 'fi', 'sv']);

class HttpError extends Error {
  /** @param {number} status @param {string} message */
  constructor(status, message) { super(message); this.status = status; }
}

/**
 * @param {{
 *   registry: import('../types.js').CompanyRegistry & { stats?: () => object },
 *   logger?: import('../lib/logger.js').Logger,
 *   concurrency?: number,
 *   limits?: { maxBodyBytes: number, maxRows: number },
 * }} deps
 */
export function createServer({ registry, logger = silentLogger, concurrency = 2, limits = { maxBodyBytes: 1_000_000, maxRows: 2_000 } }) {
  return http.createServer(async (req, res) => {
    const requestId = String(req.headers['x-request-id'] ?? randomUUID());
    const log = logger.child({ requestId });
    const started = Date.now();
    const url = new URL(req.url ?? '/', 'http://localhost');
    res.setHeader('X-Request-Id', requestId);
    res.on('finish', () => log.debug('request', { method: req.method, path: url.pathname, status: res.statusCode, ms: Date.now() - started }));

    const send = (status, body, type = 'application/json; charset=utf-8', extraHeaders = {}) => {
      res.writeHead(status, { 'Content-Type': type, ...extraHeaders });
      res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body, null, 2));
    };

    try {
      const lang = LANGS.has(url.searchParams.get('lang') ?? '') ? /** @type {string} */ (url.searchParams.get('lang')) : 'en';

      if (req.method === 'GET' && url.pathname === '/') {
        return send(200, await readFile(UI_PATH), 'text/html; charset=utf-8');
      }

      if (req.method === 'GET' && url.pathname === '/healthz') {
        return send(200, { status: 'ok', uptimeSec: Math.round(process.uptime()), ytj: registry.stats?.() ?? null });
      }

      if (req.method === 'GET' && url.pathname.startsWith('/api/companies/')) {
        const id = normalizeBusinessId(decodeURIComponent(url.pathname.slice('/api/companies/'.length)));
        if (!id.valid || !id.value) throw new HttpError(400, `Invalid business ID (${id.reason})`);
        const raw = await registry.getByBusinessId(id.value);
        if (!raw) throw new HttpError(404, `No company with business ID ${id.value}`);
        return send(200, normalizeCompany(raw, { lang }));
      }

      if (req.method === 'POST' && url.pathname === '/api/enrich') {
        const body = await readBody(req, limits.maxBodyBytes);
        const csv = (req.headers['content-type'] ?? '').includes('application/json') ? parseJson(body).csv : body;
        if (typeof csv !== 'string' || !csv.trim()) throw new HttpError(400, 'Send CSV as the request body, or JSON { "csv": "..." }');

        let rows;
        try { rows = parseCustomerCsv(csv); } catch (e) { throw new HttpError(400, e.message); }
        if (rows.length > limits.maxRows) throw new HttpError(413, `Too many rows (${rows.length} > ${limits.maxRows})`);

        const result = await enrichRows(rows, registry, { concurrency, lang });
        log.info('enrich done', { rows: rows.length, summary: result.summary, ms: Date.now() - started });

        if (url.searchParams.get('format') === 'netsuite-csv') {
          return send(200, toNetSuiteCsv(result.customers), 'text/csv; charset=utf-8', {
            'Content-Disposition': 'attachment; filename="customers-netsuite.csv"',
          });
        }
        return send(200, result);
      }

      throw new HttpError(404, 'Not found');
    } catch (err) {
      if (err instanceof HttpError) return send(err.status, { error: err.message, requestId });
      log.error('unhandled error', { error: err.message, stack: err.stack });
      return send(500, { error: 'Internal error', requestId });
    }
  });
}

function parseJson(body) {
  try { return JSON.parse(body); } catch { throw new HttpError(400, 'Invalid JSON body'); }
}

/** @param {http.IncomingMessage} req @param {number} max */
function readBody(req, max) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let tooLarge = false;
    /** @type {Buffer[]} */
    const chunks = [];
    req.on('data', (c) => {
      if (tooLarge) return; // keep draining so the client can read our 413
      size += c.length;
      if (size > max) {
        tooLarge = true;
        chunks.length = 0;
        reject(new HttpError(413, `Body larger than ${max} bytes`));
      } else chunks.push(c);
    });
    req.on('end', () => { if (!tooLarge) resolve(Buffer.concat(chunks).toString('utf8')); });
    req.on('error', reject);
  });
}
