export type PayrollComponent = { code: string; label: string; amountCents: number }
export type StatutoryRuleSet = {
  version: string
  verified: boolean
  effectiveFrom: string
  effectiveThrough?: string
  employeeDeductions: PayrollComponent[]
  employerContributions: PayrollComponent[]
}

export type PayrollCalculationInput = {
  periodStart: string
  earnings: PayrollComponent[]
  voluntaryDeductions: PayrollComponent[]
  statutoryRules?: StatutoryRuleSet
}

export type PayrollCalculation = {
  grossPayCents: number
  earnings: PayrollComponent[]
  employeeDeductions: PayrollComponent[]
  employerContributions: PayrollComponent[]
  employerCostCents: number
  netPayCents: number | null
  canFinalize: boolean
  warnings: string[]
  statutoryRuleVersion?: string
}

function validDate(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false
  const parsed = new Date(`${date}T00:00:00.000Z`)
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === date
}

function validateComponents(components: PayrollComponent[], group: string) {
  for (const component of components) {
    if (!component.code.trim() || !component.label.trim() || !Number.isSafeInteger(component.amountCents) || component.amountCents < 0) {
      throw new Error(`${group} must have a code, label, and non-negative integer cents.`)
    }
  }
}

export function calculatePayroll(input: PayrollCalculationInput): PayrollCalculation {
  if (!validDate(input.periodStart)) throw new Error('Payroll period must be a valid YYYY-MM-DD date.')
  validateComponents(input.earnings, 'Earnings')
  validateComponents(input.voluntaryDeductions, 'Voluntary deductions')
  const grossPayCents = input.earnings.reduce((total, item) => total + item.amountCents, 0)
  if (!Number.isSafeInteger(grossPayCents)) throw new Error('Gross pay exceeds the supported integer range.')

  const warnings: string[] = []
  const rules = input.statutoryRules
  const effective = Boolean(rules && validDate(rules.effectiveFrom) && (!rules.effectiveThrough || validDate(rules.effectiveThrough)) && input.periodStart >= rules.effectiveFrom && (!rules.effectiveThrough || input.periodStart <= rules.effectiveThrough))
  const verified = Boolean(rules?.verified && effective)
  if (!rules) warnings.push('No statutory rule set is configured for this calculation.')
  else if (!effective) warnings.push('The statutory rule set is not effective for this payroll period.')
  else if (!rules.verified) warnings.push('The statutory rule set is not verified; payroll finalization is blocked.')

  const statutoryDeductions = verified ? rules!.employeeDeductions : []
  const employerContributions = verified ? rules!.employerContributions : []
  validateComponents(statutoryDeductions, 'Statutory deductions')
  validateComponents(employerContributions, 'Employer contributions')
  const employeeDeductions = [...statutoryDeductions, ...input.voluntaryDeductions]
  const totalDeductions = employeeDeductions.reduce((total, item) => total + item.amountCents, 0)
  if (!Number.isSafeInteger(totalDeductions)) throw new Error('Total deductions exceed the supported integer range.')
  const net = grossPayCents - totalDeductions
  if (net < 0) warnings.push('Deductions exceed gross pay; payroll finalization is blocked.')

  const employerContributionTotal = employerContributions.reduce((total, item) => total + item.amountCents, 0)
  const employerCostCents = grossPayCents + employerContributionTotal
  const canFinalize = verified && net >= 0 && Number.isSafeInteger(employerCostCents)
  return {
    grossPayCents,
    earnings: [...input.earnings],
    employeeDeductions,
    employerContributions: [...employerContributions],
    employerCostCents,
    netPayCents: verified ? Math.max(0, net) : null,
    canFinalize,
    warnings,
    ...(verified ? { statutoryRuleVersion: rules!.version } : {}),
  }
}

