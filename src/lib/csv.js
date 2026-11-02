// Minimal RFC 4180-style CSV parser. Handles quoted fields, escaped quotes (""),
// CRLF/LF line endings, a UTF-8 BOM, and auto-detects ',' vs ';' delimiter
// (Finnish Excel exports default to ';').

const HEADER_ALIASES = {
  businessId: ['businessid', 'business_id', 'business id', 'ytunnus', 'y-tunnus', 'y_tunnus', 'vat', 'vat_number'],
  name: ['name', 'company', 'companyname', 'company_name', 'company name', 'nimi', 'yritys', 'toiminimi'],
};

export function detectDelimiter(firstLine) {
  const count = (ch) => firstLine.split(ch).length - 1;
  return count(';') > count(',') ? ';' : ',';
}

export function parseRows(text, delimiter) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === delimiter) { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function resolveColumn(headers, key) {
  const aliases = HEADER_ALIASES[key];
  return headers.findIndex((h) => aliases.includes(h.trim().toLowerCase()));
}

/**
 * Serialise rows to CSV (RFC 4180, CRLF, quoting only when needed).
 * Cells starting with = + - @ are prefixed with ' to prevent formula injection when the
 * file is opened in Excel - company names come from an external source.
 * @param {Array<Array<string|number|boolean|null|undefined>>} rows
 */
export function toCsv(rows) {
  const cell = (v) => {
    let s = v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@]/.test(s)) s = `'${s}`;
    return /[",\r\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

/**
 * Parse an input CSV into [{ line, businessId, name }].
 * `line` is the 1-based line number in the original file so errors can be traced back.
 */
export function parseCustomerCsv(text) {
  const clean = text.replace(/^﻿/, '');
  const delimiter = detectDelimiter(clean.split(/\r?\n/, 1)[0] || '');
  const rows = parseRows(clean, delimiter);
  if (rows.length === 0) throw new Error('CSV is empty');

  const headers = rows[0];
  const idCol = resolveColumn(headers, 'businessId');
  const nameCol = resolveColumn(headers, 'name');
  if (idCol === -1 && nameCol === -1) {
    throw new Error(
      `CSV header must contain a business ID column (${HEADER_ALIASES.businessId.join(', ')}) ` +
      `and/or a name column (${HEADER_ALIASES.name.join(', ')}). Got: ${headers.join(', ')}`
    );
  }

  return rows.slice(1)
    .map((cells, i) => ({
      line: i + 2,
      businessId: idCol >= 0 ? (cells[idCol] ?? '').trim() : '',
      name: nameCol >= 0 ? (cells[nameCol] ?? '').trim() : '',
    }))
    .filter((r) => r.businessId || r.name); // skip fully blank lines
}
