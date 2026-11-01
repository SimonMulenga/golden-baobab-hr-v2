import type { WorkspacePreferences } from '../companies/WorkspaceContext'

function parseCalendarDate(value: string | null | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const [year, month, day] = value.split('-').map(Number)
  const parsed = new Date(Date.UTC(year, month - 1, day))
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day
    ? parsed
    : null
}

export function formatPayrollPeriodRange(
  start: string | null | undefined,
  end: string | null | undefined,
  preferences?: WorkspacePreferences | null,
): string {
  const startDate = parseCalendarDate(start)
  const endDate = parseCalendarDate(end)
  if (!startDate || !endDate || startDate > endDate) return 'Period dates unavailable'

  const locale = preferences?.date_format === 'YYYY-MM-DD' ? 'en-CA' : 'en-GB'
  const options: Intl.DateTimeFormatOptions = { timeZone: 'UTC' }
  return `${startDate.toLocaleDateString(locale, options)} – ${endDate.toLocaleDateString(locale, options)}`
}
