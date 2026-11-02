// Finnish business ID (Y-tunnus): 7 digits + '-' + check digit.
// Check digit: weights 7,9,10,5,8,4,2; remainder r = sum % 11;
// r === 0 -> 0, r === 1 -> invalid (never issued), otherwise 11 - r.

const WEIGHTS = [7, 9, 10, 5, 8, 4, 2];

export function checkDigit(sevenDigits) {
  const sum = [...sevenDigits].reduce((acc, d, i) => acc + Number(d) * WEIGHTS[i], 0);
  const r = sum % 11;
  if (r === 0) return 0;
  if (r === 1) return null;
  return 11 - r;
}

/**
 * Normalise common real-world variants found in CSV exports:
 *  "0112038-9", " 0112038 - 9 ", "01120389", "112038-9" (Excel ate the leading zero),
 *  "FI01120389" (VAT number form).
 * Returns { value, valid, reason }.
 */
export function normalizeBusinessId(raw) {
  if (!raw) return { value: null, valid: false, reason: 'empty' };
  let s = String(raw).toUpperCase().replace(/\s+/g, '');
  if (s.startsWith('FI')) s = s.slice(2);
  s = s.replace(/[^0-9]/g, '');

  if (s.length === 7) s = '0' + s; // leading zero lost in spreadsheet
  if (s.length !== 8) return { value: null, valid: false, reason: 'wrong_length' };

  const body = s.slice(0, 7);
  const given = Number(s[7]);
  const expected = checkDigit(body);
  const value = `${body}-${s[7]}`;
  if (expected === null || expected !== given) {
    return { value, valid: false, reason: 'checksum_mismatch' };
  }
  return { value, valid: true, reason: null };
}

/** EU VAT number format for a Finnish business ID: FI + 8 digits without the dash. */
export function toVatNumber(businessId) {
  return businessId ? 'FI' + businessId.replace('-', '') : null;
}
