/** Development display helper. The trusted PostgreSQL RPC is authoritative. */
export type ZambiaPayrollBreakdown = {
  grossCents: number
  taxablePayCents: number
  payeCents: number
  napsaEmployeeCents: number
  napsaEmployerCents: number
  nhimaEmployeeCents: number
  nhimaEmployerCents: number
  otherDeductionsCents: number
  totalEmployeeDeductionsCents: number
  netPayCents: number
  employerContributionCents: number
  employerCostCents: number
  warnings: string[]
  productionFinalizationAllowed: false
}

// All inputs and intermediate percentages use integer cents/BigInt. PostgreSQL
// NUMERIC is authoritative in LIVE mode and uses the same half-away-from-zero rule.
const percent = (cents: number, basisPoints: bigint) => {
  const numerator = BigInt(cents) * basisPoints
  return Number((numerator + 5_000n) / 10_000n)
}

export type ZambiaPayrollInput = {
  basicCents: number
  taxableAllowanceCents?: number
  nonTaxableAllowanceCents?: number
  napsaBaseCents?: number
  nhimaEmployeeBaseCents?: number
  nhimaEmployerBaseCents?: number
  otherDeductionsCents?: number
}

/** Computes the owner-approved 2026 ordinary monthly configuration for UI examples. */
export function calculateZambiaIllustrativePayroll(input: ZambiaPayrollInput): ZambiaPayrollBreakdown {
  for (const [name, value] of Object.entries(input)) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) throw new Error(`${name} must be non-negative integer cents.`)
  }
  const taxableAllowances = input.taxableAllowanceCents ?? 0
  const nonTaxableAllowances = input.nonTaxableAllowanceCents ?? 0
  const grossCents = input.basicCents + taxableAllowances + nonTaxableAllowances
  if (!Number.isSafeInteger(grossCents)) throw new Error('Gross pay exceeds the supported integer range.')
  const taxablePayCents = input.basicCents + taxableAllowances
  const limits = [510_000, 710_000, 920_000]
  const rates = [0n, 2_000n, 3_000n, 3_700n]
  let lower = 0
  let payeCents = 0
  for (let index = 0; index < rates.length; index += 1) {
    const upper = limits[index] ?? Number.POSITIVE_INFINITY
    const slice = Math.max(0, Math.min(taxablePayCents, upper) - lower)
    payeCents += percent(slice, rates[index])
    lower = upper
  }
  const napsaBase = input.napsaBaseCents ?? grossCents
  const napsaRaw = percent(napsaBase, 500n)
  const napsaEmployeeCents = Math.min(napsaRaw, 186_180)
  const napsaEmployerCents = Math.min(napsaRaw, 186_180)
  const nhimaEmployeeBase = input.nhimaEmployeeBaseCents ?? input.basicCents
  const nhimaEmployerBase = input.nhimaEmployerBaseCents ?? input.basicCents
  const nhimaEmployeeCents = percent(nhimaEmployeeBase, 100n)
  const nhimaEmployerCents = percent(nhimaEmployerBase, 100n)
  const otherDeductionsCents = input.otherDeductionsCents ?? 0
  const totalEmployeeDeductionsCents = payeCents + napsaEmployeeCents + nhimaEmployeeCents + otherDeductionsCents
  const netPayCents = grossCents - totalEmployeeDeductionsCents
  if (netPayCents < 0) throw new Error('Approved deductions exceed gross pay; negative net pay is not allowed.')
  const employerContributionCents = napsaEmployerCents + nhimaEmployerCents
  return {
    grossCents,
    taxablePayCents,
    payeCents,
    napsaEmployeeCents,
    napsaEmployerCents,
    nhimaEmployeeCents,
    nhimaEmployerCents,
    otherDeductionsCents,
    totalEmployeeDeductionsCents,
    netPayCents,
    employerContributionCents,
    employerCostCents: grossCents + employerContributionCents,
    warnings: ['UI example only; the trusted Supabase PostgreSQL payroll RPC is authoritative.'],
    productionFinalizationAllowed: false,
  }
}

export const zambiaPayrollFormulaNotes = {
  paye: 'Progressive monthly 2026 bands on taxable gross earnings; employee NAPSA/NHIMA are not subtracted before PAYE.',
  napsa: 'Employee and employer 5% each on gross monthly earnings, each capped at K1,861.80 for 2026.',
  nhima: 'Employee and employer 1% each on basic salary only, with no configured ceiling.',
  gratuity: 'Not included in ordinary monthly payroll without applicable contract and verified event rules.',
  overtime: 'Requires approved overtime inputs and applicable employee/contract rule; unsupported records block live calculation.',
  leave: 'Approved paid leave preserves salary; unpaid leave requires an applicable verified formula and blocks calculation while absent.',
} as const
