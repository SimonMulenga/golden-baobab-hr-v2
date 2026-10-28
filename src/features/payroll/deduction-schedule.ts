export type RepaymentMethod = 'ONE_TIME' | 'FIXED_AMOUNT' | 'EQUAL_INSTALLMENTS' | 'MANUAL'
export type InstallmentFrequency = 'WEEKLY' | 'FORTNIGHTLY' | 'MONTHLY'
export type DeductionInstallment = { sequence: number; periodStart: string; amountCents: number }

export type DeductionScheduleInput = {
  principal: string | number
  startPeriod: string
  method: RepaymentMethod
  frequency?: InstallmentFrequency
  installmentAmount?: string | number
  installmentCount?: number
  manualInstallments?: Array<{ periodStart: string; amount: string | number }>
}

export function parseMoneyCents(value: string | number): number {
  const source = String(value).trim()
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(source)
  if (!match) throw new Error('Enter a non-negative amount with no more than two decimal places.')
  const cents = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0') || 0)
  if (!Number.isSafeInteger(cents)) throw new Error('Amount is outside the supported range.')
  return cents
}

function validPeriod(period: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(period)) throw new Error('Payroll periods must use YYYY-MM-DD.')
  const date = new Date(`${period}T00:00:00.000Z`)
  if (!Number.isFinite(date.valueOf()) || date.toISOString().slice(0, 10) !== period) throw new Error('Enter a valid payroll period start date.')
  return date
}

function advancePeriod(period: string, frequency: InstallmentFrequency): string {
  const date = validPeriod(period)
  if (frequency === 'WEEKLY' || frequency === 'FORTNIGHTLY') {
    date.setUTCDate(date.getUTCDate() + (frequency === 'WEEKLY' ? 7 : 14))
    return date.toISOString().slice(0, 10)
  }
  const day = date.getUTCDate()
  date.setUTCDate(1)
  date.setUTCMonth(date.getUTCMonth() + 1)
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate()
  date.setUTCDate(Math.min(day, lastDay))
  return date.toISOString().slice(0, 10)
}

function equalParts(totalCents: number, count: number): number[] {
  if (!Number.isInteger(count) || count < 1 || count > 120) throw new Error('Installment count must be between 1 and 120.')
  const base = Math.floor(totalCents / count)
  return Array.from({ length: count }, (_, index) => index === count - 1 ? totalCents - base * (count - 1) : base)
}

export function buildDeductionSchedule(input: DeductionScheduleInput): DeductionInstallment[] {
  const principal = parseMoneyCents(input.principal)
  if (principal <= 0) throw new Error('Principal must be greater than zero.')
  validPeriod(input.startPeriod)

  let amounts: number[]
  if (input.method === 'ONE_TIME') {
    amounts = [principal]
  } else if (input.method === 'EQUAL_INSTALLMENTS') {
    if (!input.installmentCount) throw new Error('Enter the number of installments.')
    amounts = equalParts(principal, input.installmentCount)
  } else if (input.method === 'FIXED_AMOUNT') {
    const installment = parseMoneyCents(input.installmentAmount ?? '')
    if (installment <= 0) throw new Error('Installment amount must be greater than zero.')
    const count = Math.ceil(principal / installment)
    if (count > 120) throw new Error('A schedule cannot exceed 120 installments.')
    amounts = Array.from({ length: count }, (_, index) => index === count - 1 ? principal - installment * (count - 1) : installment)
  } else {
    const manual = input.manualInstallments ?? []
    if (!manual.length || manual.length > 120) throw new Error('Provide between 1 and 120 manual installments.')
    if (manual[0].periodStart < input.startPeriod) throw new Error('Manual installments cannot start before the selected payroll period.')
    let previous = ''
    amounts = manual.map((item) => {
      validPeriod(item.periodStart)
      if (item.periodStart <= previous) throw new Error('Manual installment periods must be unique and in ascending order.')
      previous = item.periodStart
      return parseMoneyCents(item.amount)
    })
    if (amounts.some((amount) => amount <= 0) || amounts.reduce((sum, amount) => sum + amount, 0) !== principal) {
      throw new Error('Manual installments must be positive and total exactly the principal.')
    }
  }

  const frequency = input.frequency ?? 'MONTHLY'
  let periodStart = input.method === 'MANUAL' ? input.manualInstallments?.[0]?.periodStart ?? input.startPeriod : input.startPeriod
  return amounts.map((amountCents, index) => {
    const installment = { sequence: index + 1, periodStart, amountCents }
    if (index < amounts.length - 1 && input.method !== 'MANUAL') periodStart = advancePeriod(periodStart, frequency)
    else if (input.method === 'MANUAL' && input.manualInstallments) periodStart = input.manualInstallments[index + 1]?.periodStart ?? periodStart
    return installment
  })
}

export type ShortfallPolicy = 'BLOCK' | 'PARTIAL_NO_CARRY'
export function applyShortfallPolicy(scheduledCents: number, availablePayCents: number, policy: ShortfallPolicy) {
  if (!Number.isSafeInteger(scheduledCents) || scheduledCents < 0 || !Number.isSafeInteger(availablePayCents) || availablePayCents < 0) {
    throw new Error('Scheduled amount and available pay must be non-negative integer cents.')
  }
  const appliedCents = scheduledCents <= availablePayCents ? scheduledCents : policy === 'BLOCK' ? 0 : availablePayCents
  return { scheduledCents, appliedCents, shortfallCents: scheduledCents - appliedCents, carryForwardCents: 0 }
}

export type DeductionLedger = { balanceCents: number; finalizedPayrollRunIds: string[] }
export function postFinalizedDeductionPayment(
  ledger: DeductionLedger,
  payment: { payrollRunId: string; payrollStatus: 'DRAFT' | 'CALCULATED' | 'REJECTED' | 'CANCELED' | 'FINALIZED'; scheduledCents: number; availablePayCents: number; shortfallPolicy: ShortfallPolicy },
) {
  if (ledger.finalizedPayrollRunIds.includes(payment.payrollRunId)) return { ledger, appliedCents: 0, alreadyPosted: true }
  if (payment.payrollStatus !== 'FINALIZED') throw new Error('Deduction repayments can only post from finalized payroll.')
  if (!Number.isSafeInteger(ledger.balanceCents) || ledger.balanceCents < 0) throw new Error('Outstanding balance must be non-negative integer cents.')
  const eligibleSchedule = Math.min(payment.scheduledCents, ledger.balanceCents)
  const result = applyShortfallPolicy(eligibleSchedule, payment.availablePayCents, payment.shortfallPolicy)
  return {
    ledger: {
      balanceCents: ledger.balanceCents - result.appliedCents,
      finalizedPayrollRunIds: [...ledger.finalizedPayrollRunIds, payment.payrollRunId],
    },
    appliedCents: result.appliedCents,
    alreadyPosted: false,
  }
}
