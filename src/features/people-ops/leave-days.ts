export type LeaveDayCountMethod = 'WORKING_DAYS' | 'CALENDAR_DAYS'
export type LeaveCalendarDay = { calendar_date: string; is_working_day: boolean }

export function countRequestedLeaveDays(start: string, end: string, method: LeaveDayCountMethod, exceptions: LeaveCalendarDay[]): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || end < start) return 0
  const overrides = new Map(exceptions.map((item) => [item.calendar_date, item.is_working_day]))
  let count = 0
  for (let cursor = new Date(`${start}T12:00:00Z`); cursor <= new Date(`${end}T12:00:00Z`); cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const date = cursor.toISOString().slice(0, 10)
    const working = overrides.get(date) ?? (cursor.getUTCDay() !== 0 && cursor.getUTCDay() !== 6)
    if (method === 'CALENDAR_DAYS' || working) count++
  }
  return count
}
