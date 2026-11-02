// Shared JSDoc types. Checked with `npm run typecheck` (tsc --noEmit on the JS sources),
// so we get type safety without a build step.

/**
 * @typedef {{ line: number, businessId: string, name: string }} InputRow
 *
 * @typedef {{ type: 'postal'|'street', careOf: string|null, street: string|null,
 *   postCode: string|null, city: string|null, country: string, municipalityCode: string|null }} Address
 *
 * @typedef {'active'|'ceased'|'liquidation'|'bankruptcy'|'restructuring'|'other_situation'} CompanyStatus
 *
 * @typedef {{
 *   businessId: string|null,
 *   euId: string|null,
 *   name: string|null,
 *   parallelNames: string[],
 *   auxiliaryNames: string[],
 *   companyForm: { code: string, abbreviation: string|null, description: string|null } | null,
 *   mainIndustry: { code: string|null, codeSet: string|null, description: string|null } | null,
 *   status: CompanyStatus,
 *   statusDetail: string|null,
 *   vatRegistered: boolean,
 *   website: string|null,
 *   postalAddress: Address|null,
 *   streetAddress: Address|null,
 *   registrationDate: string|null,
 *   endDate: string|null,
 *   lastModified: string|null,
 * }} Company
 *
 * @typedef {'business_id'|'name_exact'|'name_core'|'name_auxiliary'} MatchMethod
 * @typedef {'high'|'medium'|'low'} Confidence
 * @typedef {'ok'|'not_found'|'ambiguous'|'invalid_input'|'error'} RowStatus
 *
 * @typedef {{ businessId: string|null, name: string|null, status: CompanyStatus, city: string|null }} Candidate
 *
 * @typedef {{
 *   line: number,
 *   input: { businessId: string|null, name: string|null },
 *   status: RowStatus,
 *   matchMethod?: MatchMethod,
 *   confidence?: Confidence,
 *   company?: Company,
 *   customer?: object,
 *   candidates?: Candidate[],
 *   error?: string,
 *   retriable?: boolean,
 *   warnings: string[],
 * }} RowResult
 *
 * @typedef {{
 *   getByBusinessId(id: string): Promise<any|null>,
 *   searchByName(name: string): Promise<{ totalResults: number, companies: any[] }>,
 * }} CompanyRegistry
 */

export {};
