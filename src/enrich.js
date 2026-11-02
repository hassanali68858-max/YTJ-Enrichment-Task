// Orchestration: input rows -> lookup -> normalized company -> customer record.
// Every row always produces a result object; failures are data, not exceptions,
// so one bad row never fails the whole import.

import { normalizeBusinessId } from './businessId.js';
import { normalizeCompany } from './normalize.js';
import { chooseByName, coreName } from './match.js';
import { toCustomerRecord } from './customerMapper.js';

/** Run async `fn` over `items` with at most `limit` in flight, preserving order. */
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

async function enrichRow(row, client, opts) {
  const base = { line: row.line, input: { businessId: row.businessId || null, name: row.name || null } };
  const warnings = [];

  try {
    // 1) Business ID is authoritative when present and valid.
    if (row.businessId) {
      const id = normalizeBusinessId(row.businessId);
      if (id.valid) {
        if (id.value !== row.businessId) warnings.push(`business_id_reformatted:${row.businessId}->${id.value}`);
        const raw = await client.getByBusinessId(id.value);
        if (!raw) {
          return { ...base, status: 'not_found', error: `No company with business ID ${id.value} in YTJ`, warnings };
        }
        const company = normalizeCompany(raw, opts);
        if (row.name && coreName(row.name) !== coreName(company.name) &&
            !company.otherNames.some((n) => coreName(n) === coreName(row.name))) {
          // Could be an old name, a brand name or a typo in the ID. Keep the register's name
          // but surface it - this is exactly the kind of thing a human should glance at.
          warnings.push(`name_mismatch:csv="${row.name}" register="${company.name}"`);
        }
        return finish(base, company, 'business_id', warnings.length && warnings.some((w) => w.startsWith('name_mismatch')) ? 'medium' : 'high', warnings);
      }
      if (!row.name) {
        return { ...base, status: 'invalid_input', error: `Invalid business ID "${row.businessId}" (${id.reason})`, warnings };
      }
      warnings.push(`invalid_business_id_ignored:${row.businessId}(${id.reason})`);
    }

    // 2) Fall back to name search.
    const { totalResults, companies } = await client.searchByName(row.name);
    const normalized = companies.map((c) => normalizeCompany(c, opts));
    const choice = chooseByName(row.name, normalized);
    if (totalResults > companies.length) warnings.push(`name_search_truncated:${companies.length}/${totalResults}`);

    if (choice.outcome === 'match') {
      return finish(base, choice.company, choice.method, choice.method === 'name_exact' ? 'medium' : 'low', warnings);
    }
    return {
      ...base,
      status: choice.outcome === 'ambiguous' ? 'ambiguous' : 'not_found',
      error: choice.outcome === 'ambiguous'
        ? `"${row.name}" matches ${choice.candidates.length}+ companies - pick one and add its business ID`
        : `No company named "${row.name}" found in YTJ`,
      candidates: choice.candidates,
      warnings,
    };
  } catch (err) {
    return { ...base, status: 'error', error: err.message, retriable: err.retriable ?? false, warnings };
  }
}

function finish(base, company, matchMethod, confidence, warnings) {
  if (company.status !== 'active') warnings.push(`company_not_active:${company.status}`);
  return {
    ...base,
    status: 'ok',
    matchMethod,
    confidence,
    company,
    customer: toCustomerRecord(company, { matchMethod, confidence, warnings }),
    warnings,
  };
}

export async function enrichRows(rows, client, { concurrency = 3, lang = 'en' } = {}) {
  const results = await mapLimit(rows, concurrency, (row) => enrichRow(row, client, { lang }));

  // Flag duplicates *after* resolution: "Nokia" and "0112038-9" are the same customer.
  const seen = new Map();
  for (const r of results) {
    const id = r.company?.businessId;
    if (!id) continue;
    if (seen.has(id)) r.warnings.push(`duplicate_of_line:${seen.get(id)}`);
    else seen.set(id, r.line);
  }

  const summary = results.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, { total: results.length });
  summary.duplicates = results.filter((r) => r.warnings.some((w) => w.startsWith('duplicate_of_line'))).length;

  return {
    summary,
    results,
    // Import-ready list: resolved, non-duplicate rows. Each record carries its own
    // confidence so the import step can decide whether "low" needs a review queue.
    customers: results
      .filter((r) => r.status === 'ok' && !r.warnings.some((w) => w.startsWith('duplicate_of_line')))
      .map((r) => r.customer),
  };
}
