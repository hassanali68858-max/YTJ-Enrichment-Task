#!/usr/bin/env node
// Usage: node src/cli.js data/sample-customers.csv [--lang=fi] [--mock] [--customers-only] > out.json
// Summary goes to stderr so stdout stays pipeable JSON.

import { readFile } from 'node:fs/promises';
import { parseCustomerCsv } from './csv.js';
import { createYtjClient } from './ytjClient.js';
import { createMockClient } from './mockClient.js';
import { enrichRows } from './enrich.js';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const flag = (name) => args.find((a) => a.startsWith(`--${name}`));
if (!file) {
  console.error('Usage: node src/cli.js <file.csv> [--lang=en|fi|sv] [--mock] [--customers-only]');
  process.exit(1);
}

const lang = flag('lang')?.split('=')[1] ?? 'en';
const client = flag('mock') || process.env.YTJ_MOCK === '1' ? createMockClient() : createYtjClient();
const rows = parseCustomerCsv(await readFile(file, 'utf8'));
const result = await enrichRows(rows, client, { lang });

console.error('Summary:', JSON.stringify(result.summary));
for (const r of result.results.filter((x) => x.status !== 'ok' || x.warnings.length)) {
  console.error(`  line ${r.line}: ${r.status}${r.error ? ' - ' + r.error : ''}${r.warnings.length ? ' [' + r.warnings.join(', ') + ']' : ''}`);
}
console.log(JSON.stringify(flag('customers-only') ? result.customers : result, null, 2));
