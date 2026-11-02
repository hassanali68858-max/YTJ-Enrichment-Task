// Code lists from PRH's description endpoint, e.g.
//   GET /opendata-ytj-api/v3/description?code=YRMU&lang=en
// Fetched 2026-11-02 and embedded on purpose: they change very rarely, and embedding
// keeps enrichment deterministic and avoids an extra network dependency at startup.
// If they ever do change, unknown codes fall back to the description in the response.

/** Company forms (YRMU): numeric code -> official abbreviation. */
export const COMPANY_FORM_ABBR = {
  '2': 'AOY', '3': 'ASH', '4': 'ASY', '5': 'AY', '6': 'AYH', '7': 'ETS', '8': 'ETY',
  '9': 'HY', '10': 'KOY', '11': 'KVJ', '12': 'KVY', '13': 'KY', '14': 'OK', '15': 'OP',
  '16': 'OY', '17': 'OYJ', '18': 'SÄÄ', '19': 'SL', '20': 'SP', '21': 'TYH', '22': 'VALTLL',
  '23': 'VOJ', '24': 'VOY', '25': 'VY', '80': 'SE', '83': 'SCE', '84': 'SCP',
};

/** Language codes (KIELI). */
export const LANG_CODE = { fi: '1', sv: '2', en: '3' };

/** Name types (TLAJI). */
export const NAME_TYPE = { PRIMARY: '1', PARALLEL: '2', AUXILIARY: '3', AUXILIARY_TRANSLATION: '4' };

/** Registers (REK). Only the ones we use. */
export const REGISTER = { TRADE: '1', VAT: '6' };

/** Address types. */
export const ADDRESS_TYPE = { STREET: 1, POSTAL: 2 };

/** Company situations. SELTILA verified from the code list; KONK and SANE from PRH docs. */
export const SITUATION_STATUS = { SELTILA: 'liquidation', KONK: 'bankruptcy', SANE: 'restructuring' };
