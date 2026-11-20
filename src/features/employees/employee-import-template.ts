export function downloadEmployeeTemplate(): void {
  const anchor = document.createElement('a')
  anchor.href = '/employee-template.xlsx'
  anchor.download = 'golden-baobab-employee-template.xlsx'
  anchor.click()
}

export function calculateHousingAllowanceCents(basicSalary: unknown): number | null {
  const raw = String(basicSalary ?? '').trim().replace(/[\s,]/g, '').replace(/^K/i, '')
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) return null
  const [whole, fraction = ''] = raw.split('.')
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  return Math.floor((cents * 30 + 50) / 100)
}

export function formatCurrencyCents(cents: number | null): string {
  if (cents === null) return ''
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`
}

export function calculateGrossEarningsPreview(values: Record<string, string>): { total: string | null; incomplete: string[] } {
  const keys = ['basic_pay', 'housing_allowance', 'meal_allowance', 'transport_allowance', 'medical_allowance', 'other_allowances']
  const incomplete = keys.filter((key) => !String(values[key] ?? '').trim())
  let cents = 0
  for (const key of keys) {
    const raw = String(values[key] ?? '').trim().replace(/[\s,]/g, '').replace(/^K/i, '')
    if (!raw) continue
    if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) return { total: null, incomplete }
    const [whole, fraction = ''] = raw.split('.')
    cents += Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  }
  return { total: formatCurrencyCents(cents), incomplete }
}
