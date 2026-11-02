// Turn PRH's verbose, history-preserving, multilingual record into one flat,
// "current state" object that is easy to reason about downstream.
//
// PRH conventions used here (from the v3 OpenAPI spec / observed responses):
//  - descriptions[].languageCode: "1" = Finnish, "2" = Swedish, "3" = English
//  - addresses[].type: 1 = street (visiting) address, 2 = postal address
//  - postOffices[].languageCode: same codes as above
//  - names[].type: "1" = primary business name; other types are parallel / auxiliary names
//  - every historical entry has an endDate; current entries have none

const LANG_CODE = { fi: '1', sv: '2', en: '3' };

export function pickDescription(descriptions = [], lang = 'en') {
  const order = [lang, 'en', 'fi', 'sv'];
  for (const l of order) {
    const d = descriptions.find((x) => x.languageCode === LANG_CODE[l]);
    if (d?.description) return d.description;
  }
  return null;
}

const isCurrent = (entry) => entry && !entry.endDate;

function currentName(names = []) {
  const current = names.filter(isCurrent);
  const primary = current.filter((n) => String(n.type) === '1');
  const pool = primary.length ? primary : current.length ? current : names;
  // In PRH data version 1 is the current version; then latest registration wins.
  return [...pool].sort((a, b) =>
    (a.version ?? 99) - (b.version ?? 99) ||
    String(b.registrationDate ?? '').localeCompare(String(a.registrationDate ?? ''))
  )[0]?.name ?? null;
}

function formatAddress(a, lang) {
  if (!a) return null;
  const city = a.postOffices?.find((p) => p.languageCode === LANG_CODE[lang === 'sv' ? 'sv' : 'fi'])?.city
    ?? a.postOffices?.[0]?.city ?? null;
  const streetLine = [
    a.street,
    a.buildingNumber,
    a.entrance,
    [a.apartmentNumber, a.apartmentIdSuffix].filter(Boolean).join(''),
  ].filter((x) => x && String(x).trim()).join(' ').trim();
  const poBox = a.postOfficeBox ? `PL ${a.postOfficeBox}` : '';
  return {
    type: Number(a.type) === 2 ? 'postal' : 'street',
    careOf: a.co || null,
    street: streetLine || poBox || null,
    postCode: a.postCode || null,
    city: city ? titleCase(city) : null,
    country: a.country || 'FI',
    municipalityCode: a.postOffices?.[0]?.municipalityCode ?? null,
  };
}

function titleCase(s) {
  return s.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (m, sep, ch) => sep + ch.toUpperCase());
}

/**
 * Status is derived, not copied, because PRH has no single "is active" flag:
 *  - company.endDate set              -> "ceased"
 *  - an open companySituation exists   -> "liquidation" | "bankruptcy" | "restructuring" | "other_situation"
 *  - otherwise                         -> "active"
 */
function deriveStatus(raw, lang) {
  if (raw.endDate) return { status: 'ceased', statusDetail: `Ceased ${raw.endDate}` };
  const situation = (raw.companySituations ?? []).find(isCurrent);
  if (situation) {
    const type = String(situation.type ?? '').toUpperCase();
    const map = { SELTILA: 'liquidation', KONK: 'bankruptcy', SANE: 'restructuring' };
    return {
      status: map[type] ?? 'other_situation',
      statusDetail: pickDescription(situation.descriptions, lang) ?? type,
    };
  }
  return { status: 'active', statusDetail: null };
}

function isVatRegistered(raw) {
  return (raw.registeredEntries ?? []).some((e) =>
    isCurrent(e) && (e.descriptions ?? []).some((d) => /arvonlis|value added|VAT|mervärdes/i.test(d.description ?? ''))
  );
}

export function normalizeCompany(raw, { lang = 'en' } = {}) {
  const currentForm = (raw.companyForms ?? []).find(isCurrent) ?? raw.companyForms?.[0];
  const addresses = (raw.addresses ?? []).filter(isCurrent).map((a) => formatAddress(a, lang));
  const { status, statusDetail } = deriveStatus(raw, lang);

  return {
    businessId: raw.businessId?.value ?? null,
    euId: raw.euId?.value ?? null,
    name: currentName(raw.names),
    otherNames: (raw.names ?? []).filter((n) => isCurrent(n) && String(n.type) !== '1').map((n) => n.name),
    companyForm: currentForm
      ? {
          code: String(currentForm.type),
          description: pickDescription(currentForm.descriptions, lang),
          descriptionFi: pickDescription(currentForm.descriptions, 'fi'),
        }
      : null,
    mainIndustry: raw.mainBusinessLine
      ? {
          code: raw.mainBusinessLine.type ?? null, // TOL 2008 code
          codeSet: raw.mainBusinessLine.typeCodeSet ?? null,
          description: pickDescription(raw.mainBusinessLine.descriptions, lang),
        }
      : null,
    status,
    statusDetail,
    vatRegistered: isVatRegistered(raw),
    website: raw.website?.url ?? null,
    postalAddress: addresses.find((a) => a.type === 'postal') ?? null,
    streetAddress: addresses.find((a) => a.type === 'street') ?? null,
    registrationDate: raw.registrationDate ?? null,
    endDate: raw.endDate ?? null,
    lastModified: raw.lastModified ?? null,
  };
}
