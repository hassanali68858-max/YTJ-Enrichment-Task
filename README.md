# YTJ business ID enrichment service

A small Node.js service that takes a CSV of corporate customers (business IDs and/or company names), looks them up in PRH's open YTJ API, returns a normalised JSON result, and maps each company to an import-ready **customer record** (shaped like a NetSuite Customer).

```
CSV ──► parse & validate ──► YTJ lookup ──► normalise ──► match / dedupe ──► customer record
          (csv.js,            (ytjClient.js)  (normalize.js)  (match.js,        (customerMapper.js)
           businessId.js)                                      enrich.js)
```

## Running it

Requires Node 18+. There are **no npm dependencies**, so `npm install` is not needed.

```bash
npm start                      # http://localhost:3000 - UI + API against the live YTJ API
npm run start:mock             # same, against offline fixtures (no network needed)
npm test                       # unit tests (offline)

# CLI: full result to stdout, a readable summary to stderr
node src/cli.js data/sample-customers.csv > result.json
node src/cli.js data/sample-customers.csv --customers-only --lang=fi > customers.json
```

API:

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/enrich?lang=en\|fi\|sv` | Body: raw CSV (`text/csv`) or `{"csv": "..."}` |
| `GET` | `/api/companies/:businessId` | Single normalised lookup, handy for debugging |
| `GET` | `/` | Minimal UI: paste or upload a CSV, see results and errors, download customers JSON |

```bash
curl -X POST --data-binary @data/sample-customers.csv -H 'Content-Type: text/csv' localhost:3000/api/enrich
```

Response shape:

```jsonc
{
  "summary":   { "total": 30, "ok": 18, "not_found": 4, "ambiguous": 2, "invalid_input": 2, "duplicates": 3 },
  "results":   [ /* one per input line: status, matchMethod, confidence, company, customer, warnings, candidates */ ],
  "customers": [ /* import-ready records: resolved and de-duplicated */ ]
}
```

## How I thought about the problem

The real problem is a data-quality problem rather than an API problem. Calling YTJ is easy. The difficulty is that the input is messy: IDs come without dashes or lose their leading zero in Excel, names are short forms or old names, and rows are duplicated. The output goes into a customer register, where a **wrong match is worse than no match**: invoicing the wrong legal entity is expensive, while an unmatched row only costs someone a minute.

That led to three principles:

1. **The business ID is authoritative and the name is only a hint.** If a valid ID is present, I look it up directly. If the CSV name disagrees with the register, I keep the register's name and raise a `name_mismatch` warning instead of guessing.
2. **Only auto-accept unambiguous matches.** A name search that hits more than one plausible company returns `ambiguous` with candidates, so a person can choose one.
3. **Every row gets a result, and failures are data.** One bad row or one API timeout never fails the whole file. Each row has a `status` (`ok`, `not_found`, `ambiguous`, `invalid_input`, `error`), a `confidence`, and `warnings`, which makes the output usable for a review queue.

## Assumptions

| Assumption | Why |
|---|---|
| The CSV has a header row with a business-ID column and/or a name column. Common aliases are accepted (`y-tunnus`, `business_id`, `nimi`, `company_name`, ...), and the delimiter `,` or `;` is auto-detected. | Exports from Finnish Excel use `;`. The header names in real files vary. |
| Lists are small (tens to a few thousand rows) and imports run occasionally, not in real time. | That is how CSV imports of corporate customers usually work. It justifies a synchronous request, an in-memory cache and a concurrency of 3 instead of a job queue. I capped uploads at 2,000 rows. |
| The customer register wants the **current** state only, not history. | PRH keeps full history (old names, ended forms and addresses). I keep only entries without an `endDate`. |
| A company is "active" if it has no `endDate` and no open company situation (liquidation, bankruptcy, restructuring). | PRH has no single "is active" flag, so status has to be derived. |
| The PRH postal address is the **billing** address and the street address is the **visiting/shipping** address. | That matches what the two address types mean. When both are identical, I create only one address-book entry. |
| A VAT number is set only if PRH lists a current VAT-register entry. | `FI` + the ID digits always gives a correctly formatted VAT number, but the company might not actually be VAT-registered. A wrong VAT number on an invoice is a real problem. |
| Ceased or bankrupt companies are still returned and mapped, but with `isInactive: true` and a warning. | The dealership may have historical customers, and silently dropping rows hides information. The import step can decide. |
| Descriptions default to English (`?lang=fi\|sv` is available). | The reviewers read English. A Finnish dealership would probably set `fi`. |
| Names in the sample CSV are fictitious customer rows. The business IDs of well-known companies are real, so live mode returns real data. | The task asks for a fictitious example file, but the lookup needs real IDs to be meaningful. |

## Decisions and why

- **Zero dependencies (`node:http`, built-in `fetch`, `node:test`).** The service is small. Express, a CSV library and Jest would add about 100 transitive packages for very little benefit. I wrote the CSV parser myself because it is about 40 lines. In production I would probably switch to `csv-parse` to get better handling of edge cases.
- **Business ID validation before calling the API.** The Y-tunnus check digit (weights 7-9-10-5-8-4-2, mod 11) catches typos without any network call. The normaliser also repairs common variants: `0112038 9`, `01120389`, `112038-9` (leading zero lost in Excel) and `FI01120389`. Each repair is reported as a warning.
- **Invalid ID with a name present → fall back to name search** (with a warning). Without a name, the row is `invalid_input`.
- **Defensive ID check.** The client only accepts a returned company whose `businessId.value` equals the requested ID. It never assumes the filter worked.
- **Name matching.** Names are lowercased, punctuation is removed, and legal suffixes (`oy`, `oyj`, `ab`, `abp`, `ky` ...) are stripped. An exact full-name match gets `medium` confidence. A unique match on the core name (without the suffix) gets `low`. When both an active and a ceased company match, the active one wins. Anything else is `ambiguous` and the top 5 candidates are returned.
- **Duplicates are detected after resolution.** `Nokia`, `0112038-9` and `FI01120389` are the same customer even though the input strings differ. Duplicates stay in `results` with a `duplicate_of_line:N` warning but are left out of `customers`.
- **Being polite to a free public API.** The client uses 3 concurrent requests, a 10 s timeout, 2 retries with exponential backoff (only on 429, 5xx and network errors), and a 15-minute in-memory cache. Failures are never cached.
- **Mock mode and fixtures.** These make the tests deterministic and the service demoable offline. The fixtures follow the real v3 response shape (field names checked against live responses) but contain hand-written values.

## Mapping to a customer record

I used NetSuite's Customer record as the target shape because NetSuite was the example in the task. Field names follow its REST record API, so moving to a real integration would mostly mean adding authentication and a `PUT`/upsert.

| Customer field | Source | Reasoning |
|---|---|---|
| `externalId` = `FI-<businessId>` | business ID | A stable, natural key. Re-importing the same list **updates** records instead of creating duplicates (upsert by external ID). The `FI-` prefix leaves room for foreign companies later. |
| `isPerson: false` | constant | These are corporate customers. |
| `companyName` | current primary name (`names[type=1]`, no `endDate`) | The legal name as registered, not the abbreviation from the CSV. |
| `vatRegNumber` | `FI` + ID digits, **only if VAT-registered** | Needed on B2B invoices. See the assumptions above. |
| `isInactive` | derived status ≠ `active` | Keeps ceased or bankrupt companies from being sold to on credit by mistake. |
| `url` | `website.url`, normalised to `https://` | |
| `addressBook[]` | postal address → default billing, street address → default shipping | Merged into one entry when identical. `addressee` is the company name. `attention` is the c/o field. |
| `custentity_business_id` | business ID | Kept as a separate searchable field, because sales and finance search by Y-tunnus. |
| `custentity_company_form` | company form → `OY`, `OYJ`, `KY`, `AY`, `OSK`, `TMI`, ... | Short codes fit a list column. Unknown forms fall back to PRH's description. |
| `custentity_industry_code` / `_name` | main business line (TOL 2008) | Useful for segmentation (for example leasing or fleet customers). |
| `custentity_register_status` | derived status | More detail than the `isInactive` boolean (bankruptcy versus ceased). |
| `custentity_enrichment` | source, PRH `lastModified`, timestamp, match method, confidence, warnings | Provenance. Users can see where the data came from and how much to trust it, and a later re-sync can skip unchanged companies. |

Fields that are deliberately **not** mapped: subsidiary, sales rep, terms, price level and currency. These are business decisions inside the register, not facts from PRH, so they belong to the import configuration.

## What I left out and what I would do next

Left out because of the time box:

- **Paging name searches.** I only read the first page of results. If a name has more hits than that, the row gets a `name_search_truncated` warning. Next step: refine the search (for example by adding a postcode column when available) instead of paging through everything.
- **Persistence and async jobs.** Big files should be handled as a background job (upload → job ID → poll), with a persistent cache (Redis or SQLite) instead of the in-memory one.
- **Pushing to the actual register.** The next step would be a NetSuite adapter that upserts by `externalId` and a review screen where a person resolves `ambiguous` rows by clicking a candidate.
- **Code lists.** I use the descriptions embedded in the response. PRH also has a code-list endpoint that would give clean, versioned labels for company forms, situations and industries.
- **Smarter status rules.** The companySituation codes (`KONK`, `SELTILA`, `SANE`) are mapped from documentation. They need confirming against more real cases.
- **Production hardening.** Structured logging, rate limiting on our own endpoint, input fuzzing, CSV export of the results, a Dockerfile, and TypeScript or JSDoc types for the response shapes.
- **React UI.** The UI is one static HTML file with vanilla JS. For a reviewer it does the job (paste or upload, filter by status, view each mapped record, download). In a real product with more screens I would use React.

## How I used AI tools

<!-- TODO (Awais): rewrite this section in your own words so it matches exactly what you did. -->

I used **Claude (Anthropic)** as a pair programmer throughout:

- **Understanding the API.** Exploring the shape of the YTJ v3 response: language codes, address types, history entries with `endDate`.
- **Scaffolding and code.** Claude wrote most of the first version of the modules, tests, fixtures and UI based on the design discussed above. I reviewed the code, ran it against the live API, and adjusted it.
- **Design discussion.** Working through edge cases such as when to trust a name match, how to treat ceased companies and VAT numbers, and how to de-duplicate after resolution.
- **README drafting.** Claude wrote the first draft and I edited it.

The decisions above are ones I can explain and defend. AI made it faster to get to a working, tested baseline, so more of the time went into the judgment calls, which this assignment is about.
