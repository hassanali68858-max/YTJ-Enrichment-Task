import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBusinessId, toVatNumber, checkDigit } from '../src/domain/businessId.js';
import { coreName, chooseByName } from '../src/domain/match.js';
import { normalizeCompany, titleCase } from '../src/domain/normalize.js';
import { toCustomerRecord } from '../src/domain/customerMapper.js';
import { createMockRegistry } from '../src/ytj/mockClient.js';

const registry = createMockRegistry();
const company = async (id) => normalizeCompany(await registry.getByBusinessId(id));

describe('business ID', () => {
  test('accepts valid IDs and repairs common spreadsheet damage', () => {
    assert.deepEqual(normalizeBusinessId('0112038-9'), { value: '0112038-9', valid: true, reason: null });
    for (const variant of [' 0112038 - 9 ', '01120389', '112038-9', 'FI01120389', 'fi0112038-9']) {
      assert.equal(normalizeBusinessId(variant).value, '0112038-9', variant);
    }
  });

  test('rejects bad check digits, wrong lengths and empty input', () => {
    assert.equal(normalizeBusinessId('0112038-8').reason, 'checksum_mismatch');
    assert.equal(normalizeBusinessId('12345').reason, 'wrong_length');
    assert.equal(normalizeBusinessId('').reason, 'empty');
  });

  test('remainder 1 is never a valid check digit', () => {
    // Find a body whose weighted sum % 11 === 1 and make sure no digit is accepted.
    const body = Array.from({ length: 1000 }, (_, i) => String(i).padStart(7, '0')).find((b) => checkDigit(b) === null);
    assert.ok(body);
    for (let d = 0; d <= 9; d++) assert.equal(normalizeBusinessId(`${body}-${d}`).valid, false);
  });

  test('VAT number format', () => assert.equal(toVatNumber('0112038-9'), 'FI01120389'));
});

describe('normalisation', () => {
  test('keeps only current data and resolves PRH codes', async () => {
    const c = await company('0116297-6');
    assert.equal(c.name, 'Valio Oy');
    assert.deepEqual(c.parallelNames, ['Valio Ltd', 'Valio Ab']);
    assert.ok(c.auxiliaryNames.includes('Valio Aimo'));
    assert.equal(c.companyForm?.abbreviation, 'OY');
    assert.equal(c.vatRegistered, true); // register "6"
    assert.equal(c.streetAddress?.street, 'Meijeritie 6'); // upper case in the source
    assert.equal(c.postalAddress?.street, 'PL 10');
  });

  test('former names are ignored', async () => {
    const c = await company('0100130-4');
    assert.equal(c.name, 'Dynava Oy');
    assert.ok(!c.auxiliaryNames.includes('Oy Eniro Finland Ab'));
  });

  test('derives ceased and bankruptcy status', async () => {
    const ceased = await company('0100002-9');
    assert.equal(ceased.status, 'ceased');
    assert.equal(ceased.name, 'Artjärven Metalli Oy'); // falls back to last known name
    assert.equal(ceased.vatRegistered, false);
    assert.equal((await company('3012345-8')).status, 'bankruptcy');
  });

  test('title-cases Finnish place names', () => {
    assert.equal(titleCase('HELSINKI'), 'Helsinki');
    assert.equal(titleCase('ÄÄNEKOSKI'), 'Äänekoski');
    assert.equal(titleCase('KARL-JOHANS GATA'), 'Karl-Johans Gata');
  });
});

describe('name matching', () => {
  const c = (businessId, name, extra = {}) => ({ businessId, name, parallelNames: [], auxiliaryNames: [], status: 'active', ...extra });

  test('strips legal suffixes', () => {
    assert.equal(coreName('Oy Eniro Finland Ab'), 'eniro finland');
    assert.equal(coreName('Stockmann Oyj Abp'), 'stockmann');
  });

  test('exact > core > auxiliary, active beats ceased', () => {
    const list = [
      c('1', 'Autotalo Virtanen Oy'),
      c('2', 'Autotalo Virtanen Ky'),
      c('3', 'Autotalo Virtanen Oy', { status: 'ceased' }),
      c('4', 'Kesko Oyj'),
      c('5', 'Frutta Hedelmä Oy', { auxiliaryNames: ['Kesko Food'] }),
      c('6', 'Some Holding Oy', { auxiliaryNames: ['Brandname'] }),
    ];
    assert.equal(chooseByName('Autotalo Virtanen Oy', list).company?.businessId, '1');
    assert.equal(chooseByName('Autotalo Virtanen', list).outcome, 'ambiguous');
    assert.equal(chooseByName('Kesko', list).company?.businessId, '4');
    assert.equal(chooseByName('Kesko', list).method, 'name_core');
    assert.equal(chooseByName('Brandname', list).method, 'name_auxiliary');
    assert.equal(chooseByName('Nothing Like It', list).outcome, 'none');
  });
});

describe('customer mapping', () => {
  test('identical postal/street addresses become one entry', async () => {
    const r = toCustomerRecord(await company('0100130-4'));
    assert.equal(r.externalId, 'FI-0100130-4');
    assert.equal(r.url, 'https://www.dynava.fi');
    assert.equal(r.addressBook.length, 1);
    assert.equal(r.addressBook[0]?.defaultBilling, true);
    assert.equal(r.addressBook[0]?.defaultShipping, true);
  });

  test('PO box is billing, street address is shipping', async () => {
    const r = toCustomerRecord(await company('0112038-9'));
    assert.deepEqual(r.addressBook.map((a) => [a?.label, a?.addressbookAddress.addr1]), [['Billing', 'PL 226'], ['Visiting', 'Karakaari 7']]);
    assert.equal(r.custentity_company_form, 'OYJ');
    assert.equal(r.vatRegNumber, 'FI01120389');
  });

  test('inactive companies get no VAT number and are flagged inactive', async () => {
    const r = toCustomerRecord(await company('0100002-9'));
    assert.equal(r.isInactive, true);
    assert.equal(r.vatRegNumber, null);
  });

  test('enrichment timestamp is injectable (deterministic output)', async () => {
    const r = toCustomerRecord(await company('0112038-9'), { now: new Date('2026-01-01T00:00:00Z') });
    assert.equal(r.custentity_enrichment.enrichedAt, '2026-01-01T00:00:00.000Z');
  });
});
