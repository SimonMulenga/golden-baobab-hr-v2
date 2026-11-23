const daysInMonth = (year: number, month: number) => {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return 0
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28
  return [4, 6, 9, 11].includes(month) ? 30 : 31
}

export function todayInLusaka(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Lusaka', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now)
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value)
  return { year: value('year'), month: value('month'), day: value('day') }
}

export function isValidDateOfBirth(value: unknown, today = todayInLusaka()) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const maxDay = daysInMonth(year, month)
  if (year < 1 || day < 1 || day > maxDay) return false
  return year < today.year || (year === today.year && (month < today.month || (month === today.month && day <= today.day)))
}
