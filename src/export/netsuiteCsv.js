// NetSuite's CSV Import Assistant is the usual no-code way to bulk-load customers.
// One row per customer; billing and shipping address in their own columns. Column
// names are mapped to fields once in the Import Assistant and saved as an import map,
// so after that the file can be imported repeatedly ("Add or Update" on External ID).

import { toCsv } from '../lib/csv.js';

/** @type {Array<[string, (c: any) => unknown]>} */
const COLUMNS = [
  ['External ID', (c) => c.externalId],
  ['Company Name', (c) => c.companyName],
  ['Is Individual', (c) => (c.isPerson ? 'T' : 'F')],
  ['Inactive', (c) => (c.isInactive ? 'T' : 'F')],
  ['Tax Reg. Number', (c) => c.vatRegNumber],
  ['Web Address', (c) => c.url],
  ['Business ID', (c) => c.custentity_business_id],
  ['Company Form', (c) => c.custentity_company_form],
  ['Industry Code', (c) => c.custentity_industry_code],
  ['Industry', (c) => c.custentity_industry_name],
  ['Register Status', (c) => c.custentity_register_status],
  ['Billing Attention', (c) => billing(c)?.attention],
  ['Billing Address 1', (c) => billing(c)?.addr1],
  ['Billing Zip', (c) => billing(c)?.zip],
  ['Billing City', (c) => billing(c)?.city],
  ['Billing Country', (c) => billing(c)?.country],
  ['Shipping Address 1', (c) => shipping(c)?.addr1],
  ['Shipping Zip', (c) => shipping(c)?.zip],
  ['Shipping City', (c) => shipping(c)?.city],
  ['Shipping Country', (c) => shipping(c)?.country],
  ['Enrichment Confidence', (c) => c.custentity_enrichment?.confidence],
  ['Enrichment Warnings', (c) => c.custentity_enrichment?.warnings?.join(' | ')],
];

const billing = (c) => c.addressBook?.find((a) => a.defaultBilling)?.addressbookAddress;
const shipping = (c) => c.addressBook?.find((a) => a.defaultShipping)?.addressbookAddress;

/** @param {any[]} customers */
export function toNetSuiteCsv(customers) {
  return toCsv([COLUMNS.map(([h]) => h), ...customers.map((c) => COLUMNS.map(([, get]) => /** @type {string} */ (get(c) ?? '')))]);
}
