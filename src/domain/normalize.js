// Turn PRH's verbose, history-preserving, multilingual record into one flat
// "current state" object. Everything PRH-specific (codes, quirks) is handled here
// so the rest of the code never sees the raw format.

import { LANG_CODE, NAME_TYPE, REGISTER, ADDRESS_TYPE, SITUATION_STATUS, COMPANY_FORM_ABBR } from '../ytj/codes.js';

/** @param {any[]} [descriptions] @param {string} [lang] */
export function pickDescription(descriptions = [], lang = 'en') {
  for (const l of [lang, 'en', 'fi', 'sv']) {
    const d = descriptions.find((x) => x.languageCode === LANG_CODE[l]);
    if (d?.description) return d.description;
  }
  return null;
}

const isCurrent = (entry) => Boolean(entry) && !entry.endDate;

/** PRH stores many streets and cities in upper case ("MEIJERITIE"). */
export function titleCase(s) {
  if (!s) return s;
  return s.toLowerCase().replace(/(^|[\s\-/])(\p{L})/gu, (_, sep, ch) => sep + ch.toUpperCase());
}

/** Prefer the current version (version 1), then the most recent registration. */
function newest(list) {
  return [...list].sort((a, b) =>
    (a.version ?? 99) - (b.version ?? 99) ||
    String(b.registrationDate ?? '').localeCompare(String(a.registrationDate ?? ''))
  )[0];
}

function names(raw) {
  const all = raw.names ?? [];
  const current = all.filter(isCurrent);
  const ofType = (t) => current.filter((n) => String(n.type) === t).map((n) => n.name);
  const primary = newest(current.filter((n) => String(n.type) === NAME_TYPE.PRIMARY))
    ?? newest(current) ?? newest(all); // ceased companies have no current name
  return {
    name: primary?.name ?? null,
    parallelNames: ofType(NAME_TYPE.PARALLEL),
    auxiliaryNames: [...ofType(NAME_TYPE.AUXILIARY), ...ofType(NAME_TYPE.AUXILIARY_TRANSLATION)],
  };
}

function formatAddress(a, lang) {
  const cityFor = (code) => a.postOffices?.find((p) => p.languageCode === code)?.city;
  const city = cityFor(lang === 'sv' ? LANG_CODE.sv : LANG_CODE.fi) ?? a.postOffices?.[0]?.city ?? null;
  const streetLine = [
    titleCase(a.street),
    a.buildingNumber,
    a.entrance,
    [a.apartmentNumber, a.apartmentIdSuffix].filter(Boolean).join(''),
  ].filter((x) => x && String(x).trim()).join(' ').trim();
  return /** @type {import('../types.js').Address} */ ({
    type: Number(a.type) === ADDRESS_TYPE.POSTAL ? 'postal' : 'street',
    careOf: a.co || null,
    street: streetLine || (a.postOfficeBox ? `PL ${a.postOfficeBox}` : null),
    postCode: a.postCode || null,
    city: city ? titleCase(city) : null,
    country: a.country || 'FI',
    municipalityCode: a.postOffices?.[0]?.municipalityCode ?? null,
  });
}

/**
 * PRH has no single "is active" flag, so status is derived:
 *  endDate set -> ceased; an open company situation -> liquidation/bankruptcy/...; else active.
 */
function deriveStatus(raw, lang) {
  if (raw.endDate) return { status: 'ceased', statusDetail: `Ceased ${raw.endDate}` };
  const situation = (raw.companySituations ?? []).find(isCurrent);
  if (situation) {
    const type = String(situation.type ?? '').toUpperCase();
    return {
      status: SITUATION_STATUS[type] ?? 'other_situation',
      statusDetail: pickDescription(situation.descriptions, lang) ?? type,
    };
  }
  return { status: 'active', statusDetail: null };
}

/**
 * @param {any} raw  a company object from the YTJ v3 API
 * @param {{ lang?: string }} [opts]
 * @returns {import('../types.js').Company}
 */
export function normalizeCompany(raw, { lang = 'en' } = {}) {
  const form = (raw.companyForms ?? []).find(isCurrent) ?? newest(raw.companyForms ?? []);
  const addresses = (raw.addresses ?? []).filter(isCurrent).map((a) => formatAddress(a, lang));
  const { status, statusDetail } = deriveStatus(raw, lang);

  return {
    businessId: raw.businessId?.value ?? null,
    euId: raw.euId?.value ?? null,
    ...names(raw),
    companyForm: form
      ? {
          code: String(form.type),
          abbreviation: COMPANY_FORM_ABBR[String(form.type)] ?? null,
          description: pickDescription(form.descriptions, lang),
        }
      : null,
    mainIndustry: raw.mainBusinessLine
      ? {
          code: raw.mainBusinessLine.type ?? null,
          codeSet: raw.mainBusinessLine.typeCodeSet ?? null,
          description: pickDescription(raw.mainBusinessLine.descriptions, lang),
        }
      : null,
    status,
    statusDetail,
    vatRegistered: (raw.registeredEntries ?? []).some((e) => isCurrent(e) && String(e.register) === REGISTER.VAT),
    website: raw.website?.url ?? null,
    postalAddress: addresses.find((a) => a.type === 'postal') ?? null,
    streetAddress: addresses.find((a) => a.type === 'street') ?? null,
    registrationDate: raw.registrationDate ?? null,
    endDate: raw.endDate ?? null,
    lastModified: raw.lastModified ?? null,
  };
}
