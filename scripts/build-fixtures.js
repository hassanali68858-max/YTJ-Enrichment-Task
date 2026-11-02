// Generates companies.json: hand-written fixtures in the same shape as YTJ v3
// responses (field names verified against live responses). Real business IDs are
// used for well-known companies so the mock and live modes give comparable output,
// but the field VALUES here are illustrative, not copied register data.
// Run: node scripts/build-fixtures.js

import { writeFileSync } from 'node:fs';

const desc = (fi, sv, en) => [
  { languageCode: '1', description: fi },
  { languageCode: '2', description: sv },
  { languageCode: '3', description: en },
];
const OY = { type: '16', descriptions: desc('Osakeyhtiö', 'Aktiebolag', 'Limited company'), registrationDate: '2000-01-01', version: 1, source: '1' };
const OYJ = { type: '17', descriptions: desc('Julkinen osakeyhtiö', 'Publikt aktiebolag', 'Public limited company'), registrationDate: '2000-01-01', version: 1, source: '1' };
const KY = { type: '13', descriptions: desc('Kommandiittiyhtiö', 'Kommanditbolag', 'Limited partnership'), registrationDate: '2010-01-01', version: 1, source: '1' };
const VAT = { type: '1', descriptions: desc('Arvonlisäverorekisterissä', 'I mervärdesskatteregistret', 'Registered in VAT register'), registrationDate: '1994-06-01', register: '6', authority: '1' };
const TRADE = { type: '1', descriptions: desc('Rekisterissä', 'Registrerad', 'Registered'), registrationDate: '1980-01-01', register: '1', authority: '2' };

const addr = (type, street, no, postCode, fi, sv = fi, extra = {}) => ({
  type, street, buildingNumber: no, entrance: '', apartmentNumber: '', apartmentIdSuffix: '', co: '',
  postCode, postOffices: [{ city: fi.toUpperCase(), languageCode: '1', municipalityCode: '091' }, { city: sv.toUpperCase(), languageCode: '2', municipalityCode: '091' }],
  registrationDate: '2020-01-01', source: '0', ...extra,
});

function company({ id, name, form = OY, tol, tolEn, tolFi, addresses = [], website, vat = true, endDate, situations = [], otherNames = [], formerNames = [] }) {
  return {
    businessId: { value: id, registrationDate: '1990-01-01', source: '3' },
    euId: { value: `FIFPRO.${id}`, source: '1' },
    names: [
      { name, type: '1', registrationDate: '2010-01-01', version: 1, source: '1', ...(endDate ? { endDate } : {}) },
      ...formerNames.map((n) => ({ name: n, type: '1', registrationDate: '1990-01-01', endDate: '2009-12-31', version: 2, source: '1' })),
      ...otherNames.map((n) => ({ name: n, type: '3', registrationDate: '2015-01-01', version: 1, source: '1' })),
    ],
    mainBusinessLine: tol ? { type: tol, descriptions: desc(tolFi, tolFi, tolEn), typeCodeSet: 'TOIMI4', registrationDate: '2008-01-01', source: '2' } : undefined,
    website: website ? { url: website, registrationDate: '2020-01-01', source: '0' } : undefined,
    companyForms: [{ ...form, ...(endDate ? { endDate } : {}) }],
    companySituations: situations,
    registeredEntries: [TRADE, ...(vat ? [VAT] : [])].map((e) => (endDate ? { ...e, endDate } : e)),
    addresses,
    tradeRegisterStatus: endDate ? '4' : '1',
    status: '2',
    registrationDate: '1980-01-01',
    ...(endDate ? { endDate } : {}),
    lastModified: '2026-10-01T10:00:00',
  };
}

const companies = [
  company({ id: '0112038-9', name: 'Nokia Oyj', form: OYJ, tol: '70100', tolEn: 'Activities of head offices', tolFi: 'Pääkonttorien toiminta',
    website: 'www.nokia.com', addresses: [addr(1, 'Karakaari', '7', '02610', 'Espoo', 'Esbo'), addr(2, 'PL', '226', '00045', 'Nokia Group', 'Nokia Group', { street: '', buildingNumber: '', postOfficeBox: '226' })] }),
  company({ id: '1927400-1', name: 'KONE Oyj', form: OYJ, tol: '28220', tolEn: 'Manufacture of lifting and handling equipment', tolFi: 'Nosto- ja siirtolaitteiden valmistus',
    website: 'www.kone.com', addresses: [addr(1, 'Kartanontie', '1', '00330', 'Helsinki', 'Helsingfors'), addr(2, 'Kartanontie', '1', '00330', 'Helsinki', 'Helsingfors')] }),
  company({ id: '0116297-6', name: 'Valio Oy', tol: '10510', tolEn: 'Operation of dairies and cheese making', tolFi: 'Maitotaloustuotteiden valmistus',
    website: 'valio.fi', addresses: [addr(1, 'Meijeritie', '6', '00370', 'Helsinki', 'Helsingfors'), addr(2, 'PL', '10', '00039', 'Valio', 'Valio', { street: '', buildingNumber: '', postOfficeBox: '10' })] }),
  company({ id: '0100130-4', name: 'Dynava Oy', tol: '82200', tolEn: 'Activities of call centres', tolFi: 'Puhelinpalvelukeskusten toiminta',
    website: 'www.dynava.fi', formerNames: ['Oy Eniro Finland Ab'],
    addresses: [addr(1, 'Valimotie', '17-19', '00380', 'Helsinki', 'Helsingfors'), addr(2, 'Valimotie', '17-19', '00380', 'Helsinki', 'Helsingfors')] }),
  company({ id: '0100002-9', name: 'Artjärven Metalli Oy', tol: '28130', tolEn: 'Manufacture of other pumps and compressors', tolFi: 'Muiden pumppujen ja kompressorien valmistus',
    endDate: '2005-12-19', vat: false }),
  // Two different active companies with the same core name -> ambiguity by name.
  company({ id: '2345678-0', name: 'Autotalo Virtanen Oy', tol: '45110', tolEn: 'Sale of cars and light motor vehicles', tolFi: 'Henkilöautojen ja kevyiden moottoriajoneuvojen kauppa',
    addresses: [addr(1, 'Hämeenkatu', '10', '33100', 'Tampere', 'Tammerfors')] }),
  company({ id: '2456789-4', name: 'Autotalo Virtanen Ky', form: KY, tol: '45200', tolEn: 'Maintenance and repair of motor vehicles', tolFi: 'Moottoriajoneuvojen huolto ja korjaus',
    addresses: [addr(1, 'Kauppakatu', '3', '40100', 'Jyväskylä', 'Jyväskylä')] }),
  // In bankruptcy.
  company({ id: '3012345-0', name: 'Pikakuljetus Lahtinen Oy', tol: '49410', tolEn: 'Freight transport by road', tolFi: 'Tieliikenteen tavarankuljetus',
    situations: [{ type: 'KONK', registrationDate: '2026-05-01', source: '1', descriptions: desc('Konkurssissa', 'I konkurs', 'Bankruptcy') }],
    addresses: [addr(2, 'Teollisuustie', '22', '15100', 'Lahti', 'Lahtis')] }),
];

// Fill IDs for the fictitious companies with valid check digits.
const W = [7, 9, 10, 5, 8, 4, 2];
for (const c of companies) {
  const body = c.businessId.value.slice(0, 7);
  const r = [...body].reduce((s, d, i) => s + d * W[i], 0) % 11;
  if (r === 1) throw new Error(`Pick another fixture ID body: ${body}`);
  const fixed = `${body}-${r === 0 ? 0 : 11 - r}`;
  if (fixed !== c.businessId.value) {
    c.businessId.value = fixed;
    c.euId.value = `FIFPRO.${fixed}`;
  }
}

writeFileSync(new URL('../test/fixtures/companies.json', import.meta.url), JSON.stringify({ totalResults: companies.length, companies }, null, 2));
console.log(companies.map((c) => `${c.businessId.value}  ${c.names[0].name}`).join('\n'));
