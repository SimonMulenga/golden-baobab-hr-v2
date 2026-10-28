export type ZambiaPayrollBreakdown = {
  grossCents: number; taxablePayCents: number; payeCents: number; napsaEmployeeCents: number
  napsaEmployerCents: number; nhimaEmployeeCents: number; nhimaEmployerCents: number
  totalEmployeeDeductionsCents: number; netPayCents: number; employerContributionCents: number
  warnings: string[]; productionFinalizationAllowed: false
}

const percent = (baseCents: number, rate: number) => Math.round(baseCents * rate)

/** Illustrative 2026 Zambia payroll preview. The provided PAYE bands are progressive.
 * The statutory bases and exemptions listed in warnings are deliberately unverified.
 */
export function calculateZambiaIllustrativePayroll(input: { basicCents: number; taxableAllowanceCents: number; napsaBaseCents?: number; nhimaEmployeeBaseCents?: number; nhimaEmployerBaseCents?: number }): ZambiaPayrollBreakdown {
  for (const [name, value] of Object.entries(input)) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) throw new Error(`${name} must be non-negative integer cents.`)
  }
  const grossCents = input.basicCents + input.taxableAllowanceCents
  if (!Number.isSafeInteger(grossCents)) throw new Error('Gross pay exceeds the supported integer range.')
  const taxablePayCents = grossCents
  const bands = [
    { limit: 510_000, rate: 0 },
    { limit: 710_000, rate: 0.2 },
    { limit: 920_000, rate: 0.3 },
    { limit: Number.POSITIVE_INFINITY, rate: 0.37 },
  ]
  let previous = 510_000
  let payeCents = 0
  for (const band of bands.slice(1)) {
    const bandAmount = Math.max(0, Math.min(taxablePayCents, band.limit) - previous)
    payeCents += percent(bandAmount, band.rate)
    previous = band.limit
  }
  const napsaBase = input.napsaBaseCents ?? grossCents
  const nhimaEmployeeBase = input.nhimaEmployeeBaseCents ?? input.basicCents
  const nhimaEmployerBase = input.nhimaEmployerBaseCents ?? input.basicCents
  const napsaEmployeeCents = percent(napsaBase, 0.05)
  const napsaEmployerCents = percent(napsaBase, 0.05)
  const nhimaEmployeeCents = percent(nhimaEmployeeBase, 0.01)
  const nhimaEmployerCents = percent(nhimaEmployerBase, 0.01)
  const totalEmployeeDeductionsCents = payeCents + napsaEmployeeCents + nhimaEmployeeCents
  return {
    grossCents, taxablePayCents, payeCents, napsaEmployeeCents, napsaEmployerCents, nhimaEmployeeCents, nhimaEmployerCents,
    totalEmployeeDeductionsCents, netPayCents: Math.max(0, grossCents - totalEmployeeDeductionsCents),
    employerContributionCents: napsaEmployerCents + nhimaEmployerCents,
    warnings: ['Illustrative only. Confirm taxable emoluments, NAPSA and NHIMA bases/caps/exemptions, employee coverage, and effective dates against current authoritative rules.'],
    productionFinalizationAllowed: false,
  }
}

export const zambiaPayrollFormulaNotes = {
  napsa: 'Proposed illustration: employee 5% and employer 5% of a configured contribution base; cap, exclusions, and eligibility must be confirmed for the applicable effective date.',
  nhima: 'Requested illustration: employee 1% and employer 1%; the applicable base differs between published NHIMA material and requires confirmation before activation.',
  gratuity: 'Proposed contract rule: 25% of basic pay earned over an eligible long-term contract, prorated at termination where applicable; eligibility and interaction with other benefits require legal review.',
  overtime: 'Proposed statutory reference: 1.5× hourly basic rate for qualifying hours above ordinary limits; 2× for qualifying public holiday/rest-day work. Confirm employee coverage, normal hours, divisor, and contract terms.',
  annualLeave: 'Illustrative Employment Code formula: full pay × accrued leave days ÷ 26; confirm applicability and payroll treatment for each leave/payment case.',
} as const

