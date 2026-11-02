// End-to-end through the real HTTP server (ephemeral port, mock registry).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/http/server.js';
import { createMockRegistry } from '../src/ytj/mockClient.js';

let server, base;
before(async () => {
  server = createServer({ registry: createMockRegistry(), limits: { maxBodyBytes: 2_000, maxRows: 5 } });
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});
after(() => new Promise((r) => server.close(r)));

const post = (body, { type = 'text/csv', query = '' } = {}) =>
  fetch(`${base}/api/enrich${query}`, { method: 'POST', headers: { 'Content-Type': type }, body });

test('POST /api/enrich with CSV', async () => {
  const res = await post('business_id,name\n0112038-9,Nokia Oyj\n,Valio Oy\n');
  assert.equal(res.status, 200);
  assert.ok(res.headers.get('x-request-id'));
  const body = await res.json();
  assert.equal(body.summary.ok, 2);
  assert.equal(body.customers.length, 2);
});

test('POST /api/enrich with JSON body and Finnish descriptions', async () => {
  const res = await post(JSON.stringify({ csv: 'y-tunnus\n0116297-6\n' }), { type: 'application/json', query: '?lang=fi' });
  const body = await res.json();
  assert.equal(body.results[0].company.companyForm.description, 'Osakeyhtiö');
});

test('POST /api/enrich?format=netsuite-csv returns a CSV download', async () => {
  const res = await post('business_id\n0112038-9\n', { query: '?format=netsuite-csv' });
  assert.match(res.headers.get('content-type') ?? '', /text\/csv/);
  assert.match(res.headers.get('content-disposition') ?? '', /attachment/);
  assert.match(await res.text(), /^External ID,Company Name/);
});

test('400 on a CSV without usable columns, 400 on bad JSON', async () => {
  assert.equal((await post('foo,bar\n1,2\n')).status, 400);
  assert.equal((await post('{nope', { type: 'application/json' })).status, 400);
});

test('413 on too many rows and on oversized bodies', async () => {
  assert.equal((await post('business_id\n' + '0112038-9\n'.repeat(6))).status, 413);
  assert.equal((await post('business_id\n' + 'x'.repeat(3_000))).status, 413);
});

test('GET /api/companies/:id validates, normalises and 404s', async () => {
  assert.equal((await fetch(`${base}/api/companies/112038-9`)).status, 200); // leading zero repaired
  assert.equal((await fetch(`${base}/api/companies/0112038-8`)).status, 400);
  assert.equal((await fetch(`${base}/api/companies/0000000-0`)).status, 404);
});

test('GET /healthz and GET /', async () => {
  assert.equal((await (await fetch(`${base}/healthz`)).json()).status, 'ok');
  assert.match(await (await fetch(base)).text(), /<title>YTJ Enrichment<\/title>/);
});
