// Application service: input rows -> lookup -> normalised company -> customer record.
// Every row always produces a result; failures are data, not exceptions, so one bad
// row (or one upstream hiccup) never fails the whole import.

import { normalizeBusinessId } from './domain/businessId.js';
import { normalizeCompany } from './domain/normalize.js';
import { chooseByName, coreName } from './domain/match.js';
import { toCustomerRecord } from './domain/customerMapper.js';

/**
 * Run `fn` over `items` with at most `limit` in flight, preserving order.
 * @template T, R
 * @param {T[]} items @param {number} limit @param {(item: T, i: number) => Promise<R>} fn
 * @returns {Promise<R[]>}
 */
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

/** @type {Record<import('./types.js').MatchMethod, import('./types.js').Confidence>} */
const CONFIDENCE_BY_METHOD = { business_id: 'high', name_exact: 'medium', name_core: 'low', name_auxiliary: 'low' };

/**
 * @param {import('./types.js').InputRow} row
 * @param {import('./types.js').CompanyRegistry} registry
 * @param {{ lang: string }} opts
 * @returns {Promise<import('./types.js').RowResult>}
 */
async function enrichRow(row, registry, opts) {
  const base = { line: row.line, input: { businessId: row.businessId || null, name: row.name || null } };
  /** @type {string[]} */
  const warnings = [];

  try {
    // 1) A valid business ID is authoritative.
    if (row.businessId) {
      const id = normalizeBusinessId(row.businessId);
      if (id.valid && id.value) {
        if (id.value !== row.businessId) warnings.push(`business_id_reformatted:${row.businessId}->${id.value}`);
        const raw = await registry.getByBusinessId(id.value);
        if (!raw) return { ...base, status: 'not_found', error: `No company with business ID ${id.value} in YTJ`, warnings };

        const company = normalizeCompany(raw, opts);
        let confidence = /** @type {import('./types.js').Confidence} */ ('high');
        if (row.name && !nameBelongsTo(row.name, company)) {
          // Old name, brand name, or a wrong ID. Keep the register's data, but flag it:
          // this is exactly what a person should look at before importing.
          warnings.push(`name_mismatch:csv="${row.name}" register="${company.name}"`);
          confidence = 'medium';
        }
        return finish(base, company, 'business_id', confidence, warnings);
      }
      if (!row.name) {
        return { ...base, status: 'invalid_input', error: `Invalid business ID "${row.businessId}" (${id.reason})`, warnings };
      }
      warnings.push(`invalid_business_id_ignored:${row.businessId}(${id.reason})`);
    }

    // 2) Fall back to a name search.
    const { totalResults, companies } = await registry.searchByName(row.name);
    const normalized = companies.map((c) => normalizeCompany(c, opts));
    if (totalResults > companies.length) warnings.push(`name_search_truncated:${companies.length}/${totalResults}`);

    const choice = chooseByName(row.name, normalized);
    if (choice.outcome === 'match' && choice.company && choice.method) {
      return finish(base, choice.company, choice.method, CONFIDENCE_BY_METHOD[choice.method], warnings);
    }
    return {
      ...base,
      status: choice.outcome === 'ambiguous' ? 'ambiguous' : 'not_found',
      error: choice.outcome === 'ambiguous'
        ? `"${row.name}" matches several companies; add the business ID to pick one`
        : `No company named "${row.name}" found in YTJ`,
      candidates: choice.candidates,
      warnings,
    };
  } catch (err) {
    return { ...base, status: 'error', error: err.message, retriable: err.retriable ?? false, warnings };
  }
}

/** @param {string} inputName @param {import('./types.js').Company} c */
function nameBelongsTo(inputName, c) {
  const want = coreName(inputName);
  return [c.name, ...c.parallelNames, ...c.auxiliaryNames].some((n) => coreName(n) === want);
}

/**
 * @param {any} base @param {import('./types.js').Company} company
 * @param {import('./types.js').MatchMethod} matchMethod @param {import('./types.js').Confidence} confidence
 * @param {string[]} warnings
 * @returns {import('./types.js').RowResult}
 */
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

/**
 * @param {import('./types.js').InputRow[]} rows
 * @param {import('./types.js').CompanyRegistry} registry
 * @param {{ concurrency?: number, lang?: string }} [opts]
 */
export async function enrichRows(rows, registry, { concurrency = 2, lang = 'en' } = {}) {
  const results = await mapLimit(rows, concurrency, (row) => enrichRow(row, registry, { lang }));

  // Duplicates are detected after resolution: "Nokia" and "0112038-9" are the same customer.
  const firstLine = new Map();
  for (const r of results) {
    const id = r.company?.businessId;
    if (!id) continue;
    if (firstLine.has(id)) r.warnings.push(`duplicate_of_line:${firstLine.get(id)}`);
    else firstLine.set(id, r.line);
  }

  const isDuplicate = (r) => r.warnings.some((w) => w.startsWith('duplicate_of_line'));
  /** @type {Record<string, number>} */
  const summary = { total: results.length };
  for (const r of results) summary[r.status] = (summary[r.status] ?? 0) + 1;
  summary.duplicates = results.filter(isDuplicate).length;
  summary.needsReview = results.filter((r) => r.status === 'ambiguous' || (r.status === 'ok' && r.confidence !== 'high')).length;

  return {
    summary,
    results,
    // Import-ready: resolved and de-duplicated. Each record carries its own confidence.
    customers: results.filter((r) => r.status === 'ok' && !isDuplicate(r)).map((r) => r.customer),
  };
}
