export type OvertimeDayType = 'ORDINARY' | 'REST_DAY' | 'PUBLIC_HOLIDAY'
export type OvertimeDivisor = 176 | 208 | 240

/** UI estimate only. PostgreSQL repeats this calculation as the authority. */
export function estimateOvertime(basicPay: number, hours: number, divisor: OvertimeDivisor, dayType: OvertimeDayType) {
  if (![basicPay, hours].every(Number.isFinite) || basicPay < 0 || hours < 0) return null
  const multiplier = dayType === 'ORDINARY' ? 1.5 : 2
  return {
    hourlyRate: basicPay / divisor,
    multiplier,
    amount: Math.round((basicPay * hours * multiplier / divisor + Number.EPSILON) * 100) / 100,
  }
}
