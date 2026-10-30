export type ScheduledDayProration = {
  eligible_scheduled_days?: number
  total_scheduled_days?: number
  basic_pay?: number
  valid_compensation?: boolean
  segments?: Array<{
    effective_from: string
    effective_to: string | null
    monthly_basic_pay: number
    eligible_scheduled_days: number
    prorated_basic_pay: number
  }>
}

const toCents = (value: number) => Math.round(value * 100)

/** Checks the server-generated audit breakdown; payroll amounts remain server-calculated. */
export function isScheduledDayProrationConsistent(value: ScheduledDayProration | null | undefined, itemBasicPay: number | null): boolean {
  if (!value || value.valid_compensation !== true || itemBasicPay == null) return false
  const total = value.total_scheduled_days
  const eligible = value.eligible_scheduled_days
  const segments = value.segments
  if (!Number.isInteger(total) || !Number.isInteger(eligible) || total! <= 0 || eligible! < 0 || eligible! > total! || !segments?.length) return false
  if (segments.some((segment) => !Number.isFinite(segment.monthly_basic_pay) || segment.monthly_basic_pay < 0
    || !Number.isInteger(segment.eligible_scheduled_days) || segment.eligible_scheduled_days < 0
    || !Number.isFinite(segment.prorated_basic_pay))) return false
  const segmentDays = segments.reduce((sum, segment) => sum + segment.eligible_scheduled_days, 0)
  const numerator = segments.reduce((sum, segment) => sum + BigInt(toCents(segment.monthly_basic_pay)) * BigInt(segment.eligible_scheduled_days), 0n)
  const divisor = BigInt(total!)
  const quotient = numerator / divisor
  const remainder = numerator % divisor
  const expectedCents = Number(quotient + (remainder * 2n >= divisor ? 1n : 0n))
  return segmentDays === eligible && expectedCents === toCents(itemBasicPay) && expectedCents === toCents(value.basic_pay ?? Number.NaN)
}
