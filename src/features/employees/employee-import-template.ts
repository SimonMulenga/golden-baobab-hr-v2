export function downloadEmployeeTemplate(): void {
  const anchor = document.createElement('a')
  anchor.href = '/employee-template.xlsx'
  anchor.download = 'Golden_Baobab_Employee_Import_Template.xlsx'
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

export function calculateGrossEarningsPreview(values: Record<string, string>, includeMedical = true): { total: string | null; incomplete: string[] } {
  const keys = ['basic_pay', 'housing_allowance', 'meal_allowance', 'transport_allowance', 'other_allowances', ...(includeMedical ? ['medical_allowance'] : [])]
  const incomplete = keys.filter((key) => !String(values[key] ?? '').trim())
  if (!String(values.basic_pay ?? '').trim()) return { total: null, incomplete }
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
