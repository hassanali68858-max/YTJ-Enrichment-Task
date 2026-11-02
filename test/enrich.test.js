import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enrichRows, mapLimit } from '../src/enrich.js';
import { createMockRegistry } from '../src/ytj/mockClient.js';
import { parseCustomerCsv, toCsv } from '../src/lib/csv.js';
import { toNetSuiteCsv } from '../src/export/netsuiteCsv.js';

const row = (line, businessId = '', name = '') => ({ line, businessId, name });

test('ID wins over name; mismatching name is flagged and lowers confidence', async () => {
  const { results } = await enrichRows([row(2, '0100130-4', 'Eniro Finland')], createMockRegistry());
  assert.equal(results[0].status, 'ok');
  assert.equal(results[0].confidence, 'medium');
  assert.ok(results[0].warnings.some((w) => w.startsWith('name_mismatch')));
});

test('a name that is a parallel or auxiliary name is not a mismatch', async () => {
  const { results } = await enrichRows([row(2, '0116297-6', 'Valio Aimo'), row(3, '0112038-9', 'Nokia Corporation')], createMockRegistry());
  for (const r of results) {
    assert.equal(r.confidence, 'high');
    assert.deepEqual(r.warnings, []);
  }
});

test('invalid ID falls back to name search; without a name it is invalid_input', async () => {
  const { results } = await enrichRows([row(2, '0116297-5', 'Valio Oy'), row(3, '1234567-8')], createMockRegistry());
  assert.equal(results[0].matchMethod, 'name_exact');
  assert.ok(results[0].warnings.some((w) => w.startsWith('invalid_business_id_ignored')));
  assert.equal(results[1].status, 'invalid_input');
});

test('duplicates are detected after resolution and kept out of customers', async () => {
  const out = await enrichRows([row(2, '0112038-9'), row(3, '', 'Nokia Oyj'), row(4, 'FI01120389')], createMockRegistry());
  assert.deepEqual(out.results.map((r) => r.warnings.find((w) => w.startsWith('duplicate'))), [undefined, 'duplicate_of_line:2', 'duplicate_of_line:2']);
  assert.equal(out.customers.length, 1);
  assert.equal(out.summary.duplicates, 2);
});

test('ambiguous names return candidates and count as needing review', async () => {
  const out = await enrichRows([row(2, '', 'Autotalo Virtanen')], createMockRegistry());
  assert.equal(out.results[0].status, 'ambiguous');
  assert.equal(out.results[0].candidates?.length, 2);
  assert.equal(out.summary.needsReview, 1);
});

test('an upstream failure becomes a row error, not an exception', async () => {
  const failing = {
    getByBusinessId: async () => { throw Object.assign(new Error('YTJ unreachable (ECONNREFUSED)'), { retriable: true }); },
    searchByName: async () => ({ totalResults: 0, companies: [] }),
  };
  const out = await enrichRows([row(2, '0112038-9'), row(3, '', 'Whatever Oy')], failing);
  assert.equal(out.results[0].status, 'error');
  assert.equal(out.results[0].retriable, true);
  assert.equal(out.results[1].status, 'not_found');
});

test('mapLimit preserves order and respects the limit', async () => {
  let inFlight = 0, peak = 0;
  const out = await mapLimit([5, 1, 3, 2, 4], 2, async (x) => {
    peak = Math.max(peak, ++inFlight);
    await new Promise((r) => setTimeout(r, x));
    inFlight--;
    return x * 10;
  });
  assert.deepEqual(out, [50, 10, 30, 20, 40]);
  assert.equal(peak, 2);
});

test('CSV parsing: ; delimiter, quotes, BOM, aliases, blank lines', () => {
  const rows = parseCustomerCsv('﻿Y-tunnus;Nimi\r\n0112038-9;"Nokia; ""the"" Oyj"\r\n\r\n;Valio Oy\r\n');
  assert.deepEqual(rows, [row(2, '0112038-9', 'Nokia; "the" Oyj'), row(4, '', 'Valio Oy')]);
  assert.throws(() => parseCustomerCsv('foo,bar\n1,2'), /header must contain/);
});

test('CSV output escapes quotes and neutralises spreadsheet formulas', () => {
  assert.equal(toCsv([['a,b', 'say "hi"', '=HYPERLINK("x")', null]]), '"a,b","say ""hi""","\'=HYPERLINK(""x"")",\r\n');
});

test('NetSuite CSV export has one row per customer with billing and shipping columns', async () => {
  const { customers } = await enrichRows([row(2, '0112038-9')], createMockRegistry());
  const [header, line] = toNetSuiteCsv(customers).trim().split('\r\n');
  const cols = header.split(',');
  const values = line.split(',');
  const get = (h) => values[cols.indexOf(h)];
  assert.equal(get('External ID'), 'FI-0112038-9');
  assert.equal(get('Billing Address 1'), 'PL 226');
  assert.equal(get('Shipping Address 1'), 'Karakaari 7');
  assert.equal(get('Tax Reg. Number'), 'FI01120389');
});
