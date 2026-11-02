// Offline registry backed by fixtures in the same JSON shape as the real API.
// Used by tests and by `npm run start:mock`. Fixture values are hand-written
// (see scripts/build-fixtures.js), not copied register data.

import { readFileSync } from 'node:fs';
import { normalizeName } from '../domain/match.js';

const FIXTURES = new URL('../../test/fixtures/companies.json', import.meta.url);

/** @returns {import('../types.js').CompanyRegistry & { stats: () => object }} */
export function createMockRegistry(companies = JSON.parse(readFileSync(FIXTURES, 'utf8')).companies) {
  let requests = 0;
  return {
    async getByBusinessId(id) {
      requests++;
      return companies.find((c) => c.businessId.value === id) ?? null;
    },
    async searchByName(name) {
      requests++;
      const q = normalizeName(name);
      const hits = companies.filter((c) => c.names.some((n) => normalizeName(n.name).includes(q)));
      return { totalResults: hits.length, companies: hits };
    },
    stats: () => ({ mock: true, requests }),
  };
}
