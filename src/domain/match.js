// Choosing a company from a name search.
//
// PRH's name search is broad: "Kesko" returns 17 companies, "Nokia" ~1000, because it
// also matches substrings and auxiliary (trade) names. We only auto-accept when the
// match is unambiguous; otherwise we return candidates for a human. Linking a customer
// to the wrong legal entity is worse than not enriching it.

const LEGAL_SUFFIXES = [
  'oyj', 'oy', 'ab', 'abp', 'ky', 'ay', 'osk', 'ok', 'ry', 'tmi', 'ltd', 'inc', 'plc', 'gmbh', 'as', 'aps',
  'osakeyhtiö', 'osuuskunta', 'kommandiittiyhtiö', 'avoin yhtiö', 'corporation', 'corp',
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
  for (let changed = true; changed;) {
    changed = false;
    for (const suf of LEGAL_SUFFIXES) {
      if (n.endsWith(' ' + suf)) { n = n.slice(0, -suf.length - 1).trim(); changed = true; }
      if (n.startsWith(suf + ' ')) { n = n.slice(suf.length + 1).trim(); changed = true; }
    }
  }
  return n;
}

/** @param {import('../types.js').Company} c */
const officialNames = (c) => [c.name, ...(c.parallelNames ?? [])].filter(Boolean);

/** @param {import('../types.js').Company[]} list */
const preferActive = (list) => {
  const active = list.filter((c) => c.status === 'active');
  return active.length ? active : list;
};

/**
 * Tiers, strongest first. The first tier with exactly one (active-preferred) hit wins.
 * A tier with several hits stops the search: that's a genuine ambiguity, and falling
 * through to a weaker tier would just pick something arbitrary.
 *
 * @param {string} inputName
 * @param {import('../types.js').Company[]} companies
 * @returns {{ outcome: 'match'|'ambiguous'|'none', company?: import('../types.js').Company,
 *   method?: import('../types.js').MatchMethod, candidates: import('../types.js').Candidate[] }}
 */
export function chooseByName(inputName, companies) {
  const full = normalizeName(inputName);
  const core = coreName(inputName);

  /** @type {[import('../types.js').MatchMethod, (c: import('../types.js').Company) => boolean][]} */
  const tiers = [
    ['name_exact', (c) => officialNames(c).some((n) => normalizeName(n) === full)],
    ['name_core', (c) => officialNames(c).some((n) => coreName(n) === core)],
    ['name_auxiliary', (c) => (c.auxiliaryNames ?? []).some((n) => coreName(n) === core)],
  ];

  for (const [method, test] of tiers) {
    const hits = preferActive(companies.filter(test));
    if (hits.length === 1) return { outcome: 'match', company: hits[0], method, candidates: [] };
    if (hits.length > 1) return { outcome: 'ambiguous', candidates: toCandidates(hits) };
  }
  return { outcome: 'none', candidates: toCandidates(preferActive(companies)) };
}

/** @param {import('../types.js').Company[]} list */
function toCandidates(list) {
  return list.slice(0, 5).map((c) => ({
    businessId: c.businessId,
    name: c.name,
    status: c.status,
    city: c.postalAddress?.city ?? c.streetAddress?.city ?? null,
  }));
}
