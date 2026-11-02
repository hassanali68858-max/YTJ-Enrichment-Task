#!/usr/bin/env node
// Usage:
//   node src/cli.js <file.csv> [--lang=en|fi|sv] [--mock] [--format=json|customers|netsuite-csv]
// Output goes to stdout; a human-readable summary goes to stderr, so stdout stays pipeable.
// Exit code 2 if any row needs attention (useful in scripts/CI).

import { readFile } from 'node:fs/promises';
import { parseCustomerCsv } from './lib/csv.js';
import { loadConfig } from './config.js';
import { createYtjClient } from './ytj/client.js';
import { createMockRegistry } from './ytj/mockClient.js';
import { enrichRows } from './enrich.js';
import { toNetSuiteCsv } from './export/netsuiteCsv.js';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const opt = (name) => args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`))?.split('=')[1] ?? (args.includes(`--${name}`) ? true : undefined);

if (!file) {
  console.error('Usage: node src/cli.js <file.csv> [--lang=en|fi|sv] [--mock] [--format=json|customers|netsuite-csv]');
  process.exit(1);
}

const config = loadConfig();
const registry = opt('mock') || config.mock ? createMockRegistry() : createYtjClient(config.ytj);
const rows = parseCustomerCsv(await readFile(file, 'utf8'));
const result = await enrichRows(rows, registry, { lang: String(opt('lang') ?? 'en'), concurrency: config.ytj.concurrency });

console.error('Summary:', JSON.stringify(result.summary));
for (const r of result.results.filter((x) => x.status !== 'ok' || x.warnings.length)) {
  console.error(`  line ${r.line}: ${r.status}${r.error ? ' - ' + r.error : ''}${r.warnings.length ? ' [' + r.warnings.join(', ') + ']' : ''}`);
}

const format = opt('format') ?? 'json';
if (format === 'netsuite-csv') process.stdout.write(toNetSuiteCsv(result.customers));
else console.log(JSON.stringify(format === 'customers' ? result.customers : result, null, 2));

process.exitCode = result.results.some((r) => r.status !== 'ok') ? 2 : 0;
