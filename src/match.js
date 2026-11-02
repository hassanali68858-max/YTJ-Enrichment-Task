// Picking the right company from a name search.
// Name search is fuzzy on PRH's side and can return dozens of hits ("Valio" matches
// every company with "valio" in the name). We only auto-accept a match when it is
// unambiguous; otherwise we return candidates for a human to choose from.
// Creating a customer on the wrong legal entity is worse than not enriching at all.

const LEGAL_SUFFIXES = [
  'oyj', 'oy', 'ab', 'abp', 'ky', 'ay', 'osk', 'ry', 'tmi', 'ltd', 'inc', 'plc', 'gmbh', 'as', 'aps',
  'osakeyhtiö', 'osuuskunta', 'kommandiittiyhtiö', 'avoin yhtiö',
];

export function normalizeName(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/&/g, ' ja ')
    .replace(/[.,"'()/\\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function coreName(s) {
  let n = normalizeName(s);
  let changed = true;
  while (changed) {
    changed = false;
    for (const suf of LEGAL_SUFFIXES) {
      if (n.endsWith(' ' + suf)) { n = n.slice(0, -suf.length - 1).trim(); changed = true; }
      if (n.startsWith(suf + ' ')) { n = n.slice(suf.length + 1).trim(); changed = true; }
    }
  }
  return n;
}

/**
 * @param {string} inputName       name as given in the CSV
 * @param {Array}  normalized      normalized companies from the search result
 * @returns {{ outcome: 'match'|'ambiguous'|'none', company?, method?, candidates }}
 */
export function chooseByName(inputName, normalized) {
  const wantFull = normalizeName(inputName);
  const wantCore = coreName(inputName);
  const names = (c) => [c.name, ...(c.otherNames ?? [])].filter(Boolean);

  // Prefer active companies: a dissolved "Valio Oy" from 1990 should not beat the live one.
  const rank = (list) => {
    const active = list.filter((c) => c.status === 'active');
    return active.length ? active : list;
  };

  const exact = rank(normalized.filter((c) => names(c).some((n) => normalizeName(n) === wantFull)));
  if (exact.length === 1) return { outcome: 'match', company: exact[0], method: 'name_exact', candidates: [] };

  const core = rank(normalized.filter((c) => names(c).some((n) => coreName(n) === wantCore)));
  if (exact.length === 0 && core.length === 1) {
    return { outcome: 'match', company: core[0], method: 'name_core', candidates: [] };
  }

  const pool = exact.length ? exact : core.length ? core : normalized;
  const candidates = pool.slice(0, 5).map((c) => ({
    businessId: c.businessId, name: c.name, status: c.status, city: c.postalAddress?.city ?? c.streetAddress?.city ?? null,
  }));
  return { outcome: pool.length && (exact.length || core.length) ? 'ambiguous' : 'none', candidates };
}
