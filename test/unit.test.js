import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBusinessId, toVatNumber } from '../src/businessId.js';
import { parseCustomerCsv, parseRows } from '../src/csv.js';
import { coreName, chooseByName } from '../src/match.js';
import { normalizeCompany } from '../src/normalize.js';
import { toCustomerRecord } from '../src/customerMapper.js';
import { createMockClient } from '../src/mockClient.js';
import { enrichRows } from '../src/enrich.js';
import { createYtjClient } from '../src/ytjClient.js';

test('business ID: valid, reformatted and invalid variants', () => {
  assert.deepEqual(normalizeBusinessId('0112038-9'), { value: '0112038-9', valid: true, reason: null });
  assert.equal(normalizeBusinessId(' 0112038 - 9 ').value, '0112038-9');
  assert.equal(normalizeBusinessId('01120389').valid, true);
  assert.equal(normalizeBusinessId('112038-9').value, '0112038-9'); // leading zero restored
  assert.equal(normalizeBusinessId('FI01120389').value, '0112038-9');
  assert.equal(normalizeBusinessId('0112038-8').reason, 'checksum_mismatch');
  assert.equal(normalizeBusinessId('12345').reason, 'wrong_length');
  assert.equal(normalizeBusinessId('').reason, 'empty');
  assert.equal(toVatNumber('0112038-9'), 'FI01120389');
});

test('CSV: semicolon delimiter, quotes, BOM, header aliases, blank lines', () => {
  const rows = parseCustomerCsv('﻿Y-tunnus;Nimi\r\n0112038-9;"Nokia; ""the"" Oyj"\r\n\r\n;Valio Oy\r\n');
  assert.deepEqual(rows, [
    { line: 2, businessId: '0112038-9', name: 'Nokia; "the" Oyj' },
    { line: 4, businessId: '', name: 'Valio Oy' },
  ]);
  assert.deepEqual(parseRows('a,b\n1,2', ','), [['a', 'b'], ['1', '2']]);
  assert.throws(() => parseCustomerCsv('foo,bar\n1,2'), /header must contain/);
});

test('name matching: suffix stripping and ambiguity', () => {
  assert.equal(coreName('Oy Eniro Finland Ab'), 'eniro finland');
  assert.equal(coreName('Stockmann Oyj Abp'), 'stockmann');
  const cos = [
    { businessId: '1', name: 'Autotalo Virtanen Oy', otherNames: [], status: 'active' },
    { businessId: '2', name: 'Autotalo Virtanen Ky', otherNames: [], status: 'active' },
    { businessId: '3', name: 'Autotalo Virtanen Oy', otherNames: [], status: 'ceased' },
  ];
  assert.equal(chooseByName('Autotalo Virtanen Oy', cos).company.businessId, '1'); // active beats ceased
  assert.equal(chooseByName('Autotalo Virtanen', cos).outcome, 'ambiguous');
  assert.equal(chooseByName('Something Else', cos).outcome, 'none');
});

test('normalize + map: current values only, postal -> billing, street -> shipping', async () => {
  const raw = await createMockClient().getByBusinessId('0100130-4');
  const c = normalizeCompany(raw);
  assert.equal(c.name, 'Dynava Oy'); // former name ignored
  assert.equal(c.status, 'active');
  assert.equal(c.streetAddress.city, 'Helsinki');
  assert.equal(c.vatRegistered, true);

  const cust = toCustomerRecord(c, { matchMethod: 'business_id', confidence: 'high' });
  assert.equal(cust.externalId, 'FI-0100130-4');
  assert.equal(cust.vatRegNumber, 'FI01001304');
  assert.equal(cust.url, 'https://www.dynava.fi');
  assert.equal(cust.custentity_company_form, 'OY');
  // Same postal and street address -> one address-book entry, default for both.
  assert.equal(cust.addressBook.length, 1);
  assert.equal(cust.addressBook[0].defaultBilling, true);
  assert.equal(cust.addressBook[0].defaultShipping, true);

  // Different postal (PO box) and street address -> two entries.
  const nokia = toCustomerRecord(normalizeCompany(await createMockClient().getByBusinessId('0112038-9')));
  assert.deepEqual(nokia.addressBook.map((a) => a.addressbookAddress.addr1), ['PL 226', 'Karakaari 7']);
  assert.equal(nokia.custentity_company_form, 'OYJ');
});

test('ceased and bankrupt companies are marked inactive and warned', async () => {
  const client = createMockClient();
  const { results } = await enrichRows(
    [{ line: 2, businessId: '0100002-9', name: '' }, { line: 3, businessId: '', name: 'Pikakuljetus Lahtinen Oy' }],
    client
  );
  assert.equal(results[0].company.status, 'ceased');
  assert.equal(results[0].customer.isInactive, true);
  assert.equal(results[0].customer.vatRegNumber, null);
  assert.equal(results[1].company.status, 'bankruptcy');
  assert.ok(results[1].warnings.includes('company_not_active:bankruptcy'));
});

test('enrich: duplicates, name mismatch, invalid ID fallback, errors never throw', async () => {
  const client = createMockClient();
  const rows = [
    { line: 2, businessId: '0112038-9', name: 'Nokia Oyj' },
    { line: 3, businessId: '', name: 'Nokia Oyj' },
    { line: 4, businessId: '0100130-4', name: 'Eniro Finland' },
    { line: 5, businessId: '0116297-5', name: 'Valio Oy' },
    { line: 6, businessId: '1234567-8', name: '' },
  ];
  const out = await enrichRows(rows, client);
  const [a, b, c, d, e] = out.results;
  assert.equal(a.confidence, 'high');
  assert.ok(b.warnings.includes('duplicate_of_line:2'));
  assert.ok(c.warnings.some((w) => w.startsWith('name_mismatch')));
  assert.equal(c.confidence, 'medium');
  assert.equal(d.status, 'ok');
  assert.equal(d.matchMethod, 'name_exact');
  assert.equal(e.status, 'invalid_input');
  assert.equal(out.customers.length, 3); // duplicate excluded

  const failing = { getByBusinessId: async () => { throw new Error('boom'); }, searchByName: async () => ({ companies: [] }) };
  const f = await enrichRows([{ line: 2, businessId: '0112038-9', name: '' }], failing);
  assert.equal(f.results[0].status, 'error');
});

test('YTJ client: retries on 503, caches, ignores non-matching IDs', async () => {
  let calls = 0;
  const fake = async () => {
    calls++;
    if (calls === 1) return new Response('', { status: 503 });
    return Response.json({ totalResults: 1, companies: [{ businessId: { value: '0112038-9' } }] });
  };
  const client = createYtjClient({ fetchImpl: fake });
  assert.equal((await client.getByBusinessId('0112038-9')).businessId.value, '0112038-9');
  await client.getByBusinessId('0112038-9');
  assert.equal(calls, 2); // one retry, then cached
  assert.equal(await client.getByBusinessId('1927400-1'), null); // API returned a different company
});
