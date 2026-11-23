export type BirthDateParts = { day: string; month: string; year: string }

export function todayInTimeZone(now = new Date(), timeZone = 'Africa/Lusaka') {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? ''
  return { year: Number(part('year')), month: Number(part('month')), day: Number(part('day')) }
}

export function daysInMonth(year: number, month: number) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return 0
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28
  return [4, 6, 9, 11].includes(month) ? 30 : 31
}

export function formatBirthDate(parts: BirthDateParts, today = todayInTimeZone()): string | null {
  if (!/^\d{1,2}$/u.test(parts.day) || !/^\d{1,2}$/u.test(parts.month) || !/^\d{4}$/u.test(parts.year)) return null
  const day = Number(parts.day)
  const month = Number(parts.month)
  const year = Number(parts.year)
  const maxDay = daysInMonth(year, month)
  if (day < 1 || day > maxDay || year < 1) return null
  if (year > today.year || (year === today.year && (month > today.month || (month === today.month && day > today.day)))) return null
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}
