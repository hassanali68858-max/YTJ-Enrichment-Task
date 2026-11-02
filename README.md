# YTJ business ID enrichment

My solution to the Advectus pre-assignment. It's a small Node service: you give it a CSV of company customers with business IDs and/or names, it looks them up in PRH's open YTJ API, returns clean JSON, and maps each company to a customer record for a register like NetSuite. You can download the records as JSON, or as a CSV that NetSuite's CSV Import Assistant can load directly.

## Quick start

You need Node 20+. The service has **no runtime dependencies**. `npm install` only pulls TypeScript for the type check.

```bash
npm start                 # http://localhost:3000, uses the live YTJ API
npm run start:mock        # same, with local fixtures (no network needed)
npm test                  # 37 tests, all offline
npm run check             # typecheck + tests (what CI runs)

node src/cli.js data/sample-customers.csv > result.json
node src/cli.js data/sample-customers.csv --format=netsuite-csv > customers.csv
```

The CLI exits with code 2 if any row needs attention, so it's usable in a script. Configuration is done with environment variables, see `.env.example`. There's also a `Dockerfile` with a health check.

### API

| | | |
|---|---|---|
| `POST /api/enrich` | body: CSV, or JSON `{ "csv": "..." }` | `?lang=en\|fi\|sv`, `?format=json\|netsuite-csv` |
| `GET /api/companies/:businessId` | single normalised company | handy for debugging |
| `GET /healthz` | liveness + upstream stats (requests, retries, cache hits) | |
| `GET /` | small UI: paste or upload, filter by status, download | |

The JSON response has three parts:

- `summary`: counts per status, duplicates, and how many rows need review.
- `results`: one entry per CSV line, with the status, match method, confidence, company, customer record, warnings and candidates.
- `customers`: the import-ready records.

Every response has an `X-Request-Id`, and the same ID appears in the JSON logs.

## How I approached it

Calling the API is the easy part. The real problem is data quality. Customer CSVs are messy: the dash is missing, Excel has dropped the leading zero, someone typed "Kone" instead of "KONE Oyj", the company was renamed, or the same customer appears twice in different forms.

The output goes into a customer register, so my guiding rule was that **a wrong match is worse than no match**. Linking a customer to the wrong legal entity means invoices go to the wrong company. An unmatched row costs someone a minute. Concretely:

1. **A valid business ID is authoritative and the name is only a hint.** If the CSV name doesn't match any of the company's current names (primary, parallel or auxiliary), I keep the register's data, add a `name_mismatch` warning and lower the confidence.
2. **A name search is only accepted automatically if it's unambiguous.** Otherwise the row is `ambiguous`, with up to 5 candidates for a person to choose from.
3. **Every row gets a result, and failures are data.** A bad ID or a network error on one row never fails the file. Each row has a `status`, a `confidence` (high/medium/low) and `warnings`, so the output can feed a review queue directly.

## Architecture

```
src/
  main.js              composition root: config, logger, registry, server, graceful shutdown
  config.js            all env-based config in one place, validated at startup
  enrich.js            application service: rows -> results (orchestration, dedupe, summary)
  domain/              pure functions, no I/O
    businessId.js        Y-tunnus normalisation + check digit
    normalize.js         raw YTJ record -> flat "current state" Company
    match.js             choosing a company from a name search
    customerMapper.js    Company -> NetSuite-style customer record
  ytj/                 everything that knows about PRH
    client.js            HTTP client: pacing, retries with jitter, cache, error causes
    codes.js             PRH code lists (company forms, registers, name types...)
    mockClient.js        fixture-backed registry with the same interface
  export/netsuiteCsv.js  customer records -> CSV for NetSuite's Import Assistant
  http/server.js       routing, body limits, status codes; no business logic
  lib/                 csv parse/serialise, JSON logger
```

The domain code is pure, which keeps it easy to test. The PRH-specific parts are isolated in `ytj/` and `normalize.js`, so switching to a different register (for example a Swedish one) would mean a new client and normaliser, while matching, mapping and export stay the same. The registry is passed in as a dependency (`CompanyRegistry`), which is how the mock and the tests plug in without any patching.

## Things I learned from the live API

I didn't want to trust only the docs, so I checked real responses. A few things changed the code:

- **VAT registration** is `registeredEntries` with `register: "6"` ("Value added tax-liability" in the `REK` code list). The descriptions are things like "VAT-liable for business activity", so matching on text would have been fragile.
- **Company forms** have official abbreviations in the `YRMU` code list (16 = OY, 17 = OYJ, 14 = OK, ...). I embedded that list in `codes.js` instead of inventing my own.
- **Name types**: 1 = company name, 2 = parallel name (e.g. "Valio Ltd"), 3 = auxiliary name (trade names like "Valio Aimo"). The matcher treats them differently: official names first, auxiliary names only as a last tier.
- **Name search is broad.** "Kesko" returns 17 companies, mostly through auxiliary names. "Nokia" returns about 1,000. That's why matching uses tiers and stops at the first ambiguous tier instead of picking something.
- **Streets and cities are often upper case** ("MEIJERITIE"), so they get title-cased for the register.
- **Companies get renamed.** In the sample CSV, "Stockmann Oyj Abp" with ID 0114162-2 comes back as **Lindex Group Oyj**. That's the reason the ID wins over the name.
- **The API refuses connections at times.** From my network it refused connections completely for a while (`ECONNREFUSED`), and my first live run had several rows fail with errors. The client now paces requests (150 ms minimum gap, 2 in parallel), retries refused connections and 5xx with exponential backoff and jitter, and reports the real cause (`ECONNREFUSED`, `ETIMEDOUT`) instead of a generic "fetch failed".

## Assumptions

- **The CSV has a header row.** I accept common column names (`y-tunnus`, `business_id`, `nimi`, `company_name`...) and auto-detect `,` or `;`. Finnish Excel defaults to `;`.
- **Files are tens to a few thousand rows**, imported occasionally. One synchronous request is fine for that, with a cap of 2,000 rows (configurable). Bigger files should be a background job (see next steps).
- **The register wants current data only.** I ignore anything with an `endDate`.
- **Status is derived**, because PRH has no "active" flag: ended → `ceased`; an open company situation → `liquidation` / `bankruptcy` / `restructuring`; otherwise `active`.
- **Postal address = billing, street address = shipping.** If they're the same, there's one address entry.
- **VAT number only if PRH says the company is VAT liable.** `FI` + the digits is always a well-formed number, but a wrong VAT number on an invoice is a real problem.
- **Inactive companies are still returned**, flagged with `isInactive: true` and a warning. Dealerships have old customers, and silently dropping rows hides information.
- **English descriptions by default** for reviewability. A Finnish team would use `?lang=fi`.
- **The sample CSV is fictitious**, but most business IDs are real so live mode returns real data. A few rows are deliberately broken to exercise each path.

## Decisions and trade-offs

**No runtime dependencies.** Node 20 has `fetch`, `node:test` and a perfectly usable `http` module. For a service this size, Express, a CSV library and Jest would add about a hundred packages to audit for very little gain. The trade-off: I own a 40-line CSV parser. In production I'd switch to `csv-parse` as soon as we saw unusual files. TypeScript is a dev dependency only: the code is plain JS with JSDoc types, checked by `tsc --noEmit` in CI, so there's no build step.

**Validate before calling the API.** The Y-tunnus check digit (weights 7-9-10-5-8-4-2, mod 11; remainder 1 is never issued) catches typos with no network call. Known spreadsheet damage gets repaired, with a warning: `0112038 9`, `01120389`, `112038-9`, `FI01120389`. If the ID is invalid but there's a name, I fall back to a name search.

**Never trust the filter.** After an ID lookup, the client only accepts a company whose `businessId.value` equals the requested ID.

**Matching in tiers, with explicit confidence.** Exact official name (`medium`) → core name without the legal suffix (`low`) → auxiliary name (`low`). An ID match is `high`. Active companies are preferred over ended ones. A tier with several hits stops the search as `ambiguous`, because falling through to a weaker tier would just pick something arbitrary.

**Dedupe after resolving, not before.** "Nokia", "0112038-9" and "FI01120389" are the same customer. Duplicates stay visible in `results` with `duplicate_of_line:N`, but appear only once in `customers`.

**Being a good citizen towards a free API.** Pacing plus a concurrency limit, a 10 s timeout, retries only for 429, 5xx and network errors, and a 15-minute cache with in-flight de-duplication. Failures are never cached. All of this is configurable, and `/healthz` shows request, retry and cache-hit counts.

**Concurrency vs. pacing.** I kept both. Concurrency limits how much we wait on slow responses. Pacing limits how hard we hit PRH. For 30 rows this takes a few seconds, which is fine for an import.

**Embedded code lists instead of fetching them.** PRH has a `/description` endpoint. These lists change maybe once a decade, so embedding them keeps the output deterministic and startup free of network calls. Unknown codes fall back to the text that comes with the response.

**Mock registry + fixtures.** The tests are deterministic and offline, and the demo works without network. The fixtures follow the real v3 shape (checked against live responses), but the values are written by hand and not copied from the register.

**CSV export is safe to open in Excel.** Company names come from an external source, so cells starting with `=`, `+`, `-` or `@` are prefixed with `'` to prevent formula injection.

## Mapping to a customer record

I used NetSuite's Customer record because NetSuite was the example in the brief, so the field names are real. In practice there are two ways in:

- **CSV Import Assistant**, which needs no code: `?format=netsuite-csv` gives one row per customer. Map the columns once, save the import map, and use "Add or Update" on External ID.
- **REST API**: the JSON `customers` array is already in the record API's shape, so an adapter only needs auth and an upsert.

| Field | From | Why |
|---|---|---|
| `externalId` = `FI-<businessId>` | business ID | Natural key → idempotent upserts. Re-running an import updates records instead of duplicating them. The prefix leaves room for foreign companies. |
| `isPerson: false` | – | Corporate customers. |
| `companyName` | current primary name | The registered name, not what was typed in the CSV. |
| `vatRegNumber` | `FI` + digits, only if VAT liable | Needed on B2B invoices. |
| `isInactive` | status ≠ active | Stops anyone selling on credit to a bankrupt company by accident. |
| `url` | website, `https://` added | |
| `addressBook` | postal → billing, street → shipping | One entry if they're the same. |
| `custentity_business_id` | business ID | Separate searchable field. Finance searches by Y-tunnus. |
| `custentity_company_form` | YRMU abbreviation (OY, OYJ, KY, OK…) | Short, official, fits a list column. |
| `custentity_industry_code` / `_name` | main business line (TOL 2008) | Segmentation, e.g. finding fleet or leasing customers. |
| `custentity_register_status` | derived status | More precise than a boolean: ceased ≠ bankrupt. |
| `custentity_enrichment` | source, PRH `lastModified`, fetch time, method, confidence, warnings | Provenance: anyone looking at the record can see where the data came from and how much to trust it. A re-sync can also skip companies that haven't changed. |

**Deliberately not mapped:** subsidiary, sales rep, payment terms, price level and currency. PRH doesn't know them. They're business decisions, so they belong in the import configuration.

## Production readiness: what's there and what isn't

What's there:

- structured JSON logs with request IDs
- `/healthz`
- graceful shutdown
- config validated at startup
- body and row limits
- upstream timeouts, retries and pacing
- typecheck and tests in CI on Node 20 and 22
- a Dockerfile that runs as a non-root user

What's missing, roughly in the order I'd add it:

1. **Async jobs for large files.** Upload → job ID → poll or webhook. Store the results, and use a shared cache (Redis or Postgres) so several instances don't each hit PRH.
2. **Review workflow.** A screen where someone resolves `ambiguous` and `low`-confidence rows by clicking a candidate. Their choice is stored and reused next time.
3. **The actual NetSuite adapter.** Token-based auth, upsert by `externalId`, a dry-run mode, and per-record error reporting back into the results.
4. **Periodic re-sync.** Re-check existing customers and use PRH's `lastModified` to catch renames, address changes and bankruptcies. For a dealership, finding out a customer went bankrupt matters more than the initial import.
5. **Name search paging and narrowing.** I only read the first page and flag `name_search_truncated`. Rather than paging through 1,000 "Nokia" hits, I'd narrow the search with a postcode or city column when the CSV has one.
6. **Operations.** Metrics (Prometheus: rows by status, upstream latency and retries), rate limiting and auth on our own endpoint, and contract tests that run nightly against the live API to catch format changes.
7. **Confirm the situation codes.** `SELTILA` (liquidation) is verified from the code list. `KONK` and `SANE` come from the documentation and should be confirmed against real cases.
8. **A React front end** if the UI grows into the review workflow. For now it's one HTML file, which is enough to see results and errors.

## How I used AI

<!-- Awais: edit this so it matches exactly what you did, then delete this line. -->

I used Claude (Anthropic) extensively:

- to work out the YTJ v3 response format and to query the live API and its code lists (that's where the VAT register, name type and company form findings come from)
- to write most of the code, tests, fixtures and UI. I then ran it against the live API and compared the results with the YTJ website. When the first live run showed refused connections, that led to the pacing and retry changes.
- as a sparring partner on the design: when a name match is safe, how to treat inactive companies and VAT numbers, where duplicates should be detected, and how to structure the code so the PRH-specific parts are isolated
- to draft this README, which I then edited

I agree with the decisions here and can explain each of them. AI let me get to a tested, working baseline quickly, so more of my time went into the judgment calls, which is what this assignment is really about.
