// Offline client backed by test fixtures (same JSON shape as the real API).
// Used by the tests and by `npm run start:mock` so the service can be demoed
// without network access. The fixtures are hand-written, not real register data.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { normalizeName } from './match.js';

const fixturePath = fileURLToPath(new URL('../test/fixtures/companies.json', import.meta.url));

export function createMockClient(companies = JSON.parse(readFileSync(fixturePath, 'utf8')).companies) {
  return {
    async getByBusinessId(id) {
      return companies.find((c) => c.businessId.value === id) ?? null;
    },
    async searchByName(name) {
      const q = normalizeName(name);
      const hits = companies.filter((c) => c.names.some((n) => normalizeName(n.name).includes(q)));
      return { totalResults: hits.length, companies: hits };
    },
  };
}
