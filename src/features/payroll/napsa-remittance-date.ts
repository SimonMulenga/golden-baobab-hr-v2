/** NAPSA contributions relate to a calendar month and are remitted by the 10th of the next month. */
export function napsaRemittanceDeadline(periodEnd: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(periodEnd)
  if (!match) return ''
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const parsed = new Date(Date.UTC(year, month - 1, day))
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return ''
  return new Date(Date.UTC(year, month, 10)).toISOString().slice(0, 10)
}
