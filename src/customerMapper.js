// Map a normalized company into a fictitious customer-register record.
//
// The shape deliberately follows NetSuite's Customer record (REST record API field
// names: companyName, isPerson, externalId, vatRegNumber, isInactive, url,
// addressBook with defaultBilling/defaultShipping, custentity_* for custom fields),
// because NetSuite was named as the example target. Nothing here calls NetSuite;
// it only produces an import-ready object. See README "Mapping" for the reasoning.

import { toVatNumber } from './businessId.js';

// Short, register-friendly company form abbreviations, keyed by PRH's Finnish
// description. Keyed by text rather than PRH's numeric code on purpose: the text is
// self-explanatory and I could not verify the full numeric code list offline.
// Unknown forms fall back to PRH's own description.
const FORM_ABBR = {
  'osakeyhtiö': 'OY',
  'julkinen osakeyhtiö': 'OYJ',
  'kommandiittiyhtiö': 'KY',
  'avoin yhtiö': 'AY',
  'osuuskunta': 'OSK',
  'osuuspankki': 'OP',
  'asunto-osakeyhtiö': 'AS OY',
  'aatteellinen yhdistys': 'RY',
  'elinkeinonharjoittaja': 'TMI',
  'yksityinen elinkeinonharjoittaja': 'TMI',
};

function formAbbreviation(form) {
  if (!form) return null;
  return FORM_ABBR[String(form.descriptionFi ?? '').trim().toLowerCase()] ?? form.description ?? null;
}

function toAddressBookEntry(addr, { label, defaultBilling, defaultShipping }) {
  if (!addr) return null;
  return {
    label,
    defaultBilling,
    defaultShipping,
    addressbookAddress: {
      addressee: null, // filled with companyName below
      attention: addr.careOf,
      addr1: addr.street,
      zip: addr.postCode,
      city: addr.city,
      country: addr.country,
    },
  };
}

export function toCustomerRecord(company, { matchMethod, confidence, warnings = [] } = {}) {
  const billing = company.postalAddress ?? company.streetAddress;
  const shipping = company.streetAddress ?? company.postalAddress;

  // PRH often stores the same address as both postal and street; don't create two entries.
  const same = !billing || !shipping || (billing.street === shipping.street && billing.postCode === shipping.postCode);

  const addressBook = [
    toAddressBookEntry(billing, { label: same ? 'Main (PRH address)' : 'Billing (PRH postal address)', defaultBilling: true, defaultShipping: same }),
    !same
      ? toAddressBookEntry(shipping, { label: 'Visiting (PRH street address)', defaultBilling: false, defaultShipping: true })
      : null,
  ].filter(Boolean);
  for (const a of addressBook) a.addressbookAddress.addressee = company.name;

  const website = company.website
    ? (/^https?:\/\//i.test(company.website) ? company.website : `https://${company.website}`)
    : null;

  return {
    // Stable key for idempotent upserts: re-importing the same list updates, never duplicates.
    externalId: `FI-${company.businessId}`,
    isPerson: false,
    companyName: company.name,
    // VAT number is only set when PRH says the company is in the VAT register;
    // the format FI+digits is deterministic but the registration is not.
    vatRegNumber: company.vatRegistered ? toVatNumber(company.businessId) : null,
    isInactive: company.status !== 'active',
    url: website,
    addressBook,

    // Custom fields (NetSuite convention: custentity_ prefix)
    custentity_business_id: company.businessId,
    custentity_company_form: formAbbreviation(company.companyForm),
    custentity_industry_code: company.mainIndustry?.code ?? null,
    custentity_industry_name: company.mainIndustry?.description ?? null,
    custentity_register_status: company.status,

    // Provenance, so a sales person can tell where the data came from and how sure we are.
    custentity_enrichment: {
      source: 'PRH YTJ open data API v3',
      sourceLastModified: company.lastModified,
      enrichedAt: new Date().toISOString(),
      matchMethod,
      confidence,
      warnings,
    },
  };
}
