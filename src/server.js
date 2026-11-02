// HTTP API + tiny static UI. Uses only node:http to keep the dependency list at zero.
//
//   POST /api/enrich            body: raw CSV (text/csv) or JSON { "csv": "..." }
//        ?lang=en|fi|sv         language for descriptions (default en)
//   GET  /api/companies/:id     single lookup by business ID (handy for debugging)
//   GET  /                      upload UI

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseCustomerCsv } from './csv.js';
import { createYtjClient } from './ytjClient.js';
import { createMockClient } from './mockClient.js';
import { enrichRows } from './enrich.js';
import { normalizeBusinessId } from './businessId.js';
import { normalizeCompany } from './normalize.js';

const MAX_BODY = 1_000_000; // 1 MB is plenty for a few thousand rows
const MAX_ROWS = 2_000;     // protect the public API from accidental huge uploads

export function createServer({ client = createYtjClient() } = {}) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const send = (status, body, type = 'application/json; charset=utf-8') => {
      res.writeHead(status, { 'Content-Type': type });
      res.end(type.startsWith('application/json') ? JSON.stringify(body, null, 2) : body);
    };

    try {
      if (req.method === 'GET' && url.pathname === '/') {
        const html = await readFile(fileURLToPath(new URL('../public/index.html', import.meta.url)));
        return send(200, html, 'text/html; charset=utf-8');
      }

      if (req.method === 'GET' && url.pathname.startsWith('/api/companies/')) {
        const id = normalizeBusinessId(decodeURIComponent(url.pathname.split('/').pop()));
        if (!id.valid) return send(400, { error: `Invalid business ID (${id.reason})` });
        const raw = await client.getByBusinessId(id.value);
        if (!raw) return send(404, { error: 'Not found' });
        return send(200, normalizeCompany(raw, { lang: url.searchParams.get('lang') ?? 'en' }));
      }

      if (req.method === 'POST' && url.pathname === '/api/enrich') {
        const body = await readBody(req);
        const csv = (req.headers['content-type'] ?? '').includes('application/json')
          ? JSON.parse(body).csv
          : body;
        if (!csv || typeof csv !== 'string') return send(400, { error: 'Send CSV text as the body or as { "csv": "..." }' });

        let rows;
        try { rows = parseCustomerCsv(csv); } catch (e) { return send(400, { error: e.message }); }
        if (rows.length > MAX_ROWS) return send(413, { error: `Too many rows (${rows.length} > ${MAX_ROWS})` });

        const lang = ['en', 'fi', 'sv'].includes(url.searchParams.get('lang')) ? url.searchParams.get('lang') : 'en';
        return send(200, await enrichRows(rows, client, { lang }));
      }

      send(404, { error: 'Not found' });
    } catch (err) {
      console.error(err);
      send(err.statusCode ?? 500, { error: err.statusCode ? err.message : 'Internal error' });
    }
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('Body too large'), { statusCode: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 3000);
  const mock = process.env.YTJ_MOCK === '1';
  createServer({ client: mock ? createMockClient() : createYtjClient() }).listen(port, () => {
    console.log(`YTJ enrichment service on http://localhost:${port}${mock ? ' (MOCK data)' : ''}`);
  });
}
