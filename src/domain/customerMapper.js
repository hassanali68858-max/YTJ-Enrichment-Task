// Map a normalised company to a customer-register record.
//
// Target shape: NetSuite's Customer record (REST record API field names), because
// NetSuite was the example register in the brief. Custom fields use NetSuite's
// `custentity_` convention. Nothing here talks to NetSuite; see export/netsuiteCsv.js
// for a file the CSV Import Assistant can take as-is.

import { toVatNumber } from './businessId.js';

/**
 * @param {import('../types.js').Address|null} addr
 * @param {{ label: string, defaultBilling: boolean, defaultShipping: boolean, addressee: string|null }} opts
 */
function addressBookEntry(addr, { label, defaultBilling, defaultShipping, addressee }) {
  if (!addr) return null;
  return {
    label,
    defaultBilling,
    defaultShipping,
    addressbookAddress: {
      addressee,
      attention: addr.careOf,
      addr1: addr.street,
      zip: addr.postCode,
      city: addr.city,
      country: addr.country,
    },
  };
}

/** @param {string|null} url */
const normalizeUrl = (url) => (!url ? null : /^https?:\/\//i.test(url) ? url : `https://${url}`);

/**
 * @param {import('../types.js').Company} company
 * @param {{ matchMethod?: string, confidence?: string, warnings?: string[], now?: Date }} [meta]
 */
export function toCustomerRecord(company, { matchMethod, confidence, warnings = [], now = new Date() } = {}) {
  // Postal address is where invoices go; street address is where people/cars go.
  const billing = company.postalAddress ?? company.streetAddress;
  const shipping = company.streetAddress ?? company.postalAddress;
  // PRH often has the same address as both types; one entry is enough then.
  const same = !billing || !shipping || (billing.street === shipping.street && billing.postCode === shipping.postCode);

  const addressBook = [
    addressBookEntry(billing, {
      label: same ? 'Main' : 'Billing',
      defaultBilling: true,
      defaultShipping: same,
      addressee: company.name,
    }),
    same ? null : addressBookEntry(shipping, { label: 'Visiting', defaultBilling: false, defaultShipping: true, addressee: company.name }),
  ].filter(Boolean);

  return {
    // Natural key -> idempotent upserts. Re-importing the same list updates, never duplicates.
    externalId: `FI-${company.businessId}`,
    isPerson: false,
    companyName: company.name,
    // Only when PRH says the company is in the VAT register (register 6). The FI+digits
    // format is deterministic, the registration is not.
    vatRegNumber: company.vatRegistered ? toVatNumber(company.businessId) : null,
    isInactive: company.status !== 'active',
    url: normalizeUrl(company.website),
    addressBook,

    custentity_business_id: company.businessId,
    custentity_company_form: company.companyForm?.abbreviation ?? company.companyForm?.description ?? null,
    custentity_industry_code: company.mainIndustry?.code ?? null,
    custentity_industry_name: company.mainIndustry?.description ?? null,
    custentity_register_status: company.status,
    custentity_enrichment: {
      source: 'PRH YTJ open data API v3',
      sourceLastModified: company.lastModified,
      enrichedAt: now.toISOString(),
      matchMethod: matchMethod ?? null,
      confidence: confidence ?? null,
      warnings,
    },
  };
}
