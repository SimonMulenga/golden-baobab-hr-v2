import { PDFDocument, StandardFonts, rgb } from 'npm:@cantoo/pdf-lib@2.11.1'
import { encryptPayslipPdf } from './encryption.ts'

type Json = Record<string, unknown>
const object = (value: unknown): Json => value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {}
const num = (value: unknown) => { const n = Number(value ?? 0); return Number.isFinite(n) ? n : 0 }
const text = (value: unknown) => typeof value === 'string' ? value : ''
const money = (value: unknown) => `K${num(value).toLocaleString('en-ZM', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const safeText = (value: unknown) => text(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7E]/g, '?')

export async function buildPayslipPdf(snapshot: Json, birthYear: string): Promise<Uint8Array> {
  if (!/^\d{4}$/u.test(birthYear)) throw new Error('EMPLOYEE_BIRTH_YEAR_REQUIRED')
  const pdf = await PDFDocument.create()
  const regular = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const finalized = new Date(text(snapshot.finalized_at))
  if (Number.isFinite(finalized.getTime())) pdf.setCreationDate(finalized)
  pdf.setTitle('Employee payslip')
  pdf.setSubject('Finalized payroll record')
  pdf.setProducer('Golden Baobab HR')

  const width = 595.28, height = 841.89
  const company = object(snapshot.company), employee = object(snapshot.employee), item = object(snapshot.payroll_item)
  const statutory = object(item.statutory_deductions)
  const breakdown = object(item.calculation_breakdown)
  const additional = Array.isArray(breakdown.approved_earning_items) ? breakdown.approved_earning_items.map(object) : []
  const installments = Array.isArray(breakdown.due_deduction_items) ? breakdown.due_deduction_items.map(object) : []
  const leave = object(snapshot.leave)
  const leavePolicies = Array.isArray(leave.policies) ? leave.policies.map(object) : []
  const outstandingDeductions = Array.isArray(snapshot.deductions) ? snapshot.deductions.map(object) : []
  const periodStart = new Date(`${text(snapshot.period_start)}T00:00:00Z`)
  const periodName = Number.isFinite(periodStart.getTime()) ? periodStart.toLocaleDateString('en-ZM', { month: 'long', year: 'numeric', timeZone: 'UTC' }) : 'Payroll period'
  let page = pdf.addPage([width, height])
  let pageNumber = 0
  let y = height - 48

  const addPage = () => {
    if (pageNumber > 0) page = pdf.addPage([width, height])
    pageNumber += 1
    y = height - 48
    page.drawRectangle({ x: 0, y: height - 118, width, height: 118, color: rgb(0.04, 0.24, 0.2) })
    page.drawText('GB', { x: 44, y: height - 65, size: 24, font: bold, color: rgb(1, 1, 1) })
    page.drawText(safeText(company.name || 'Company').slice(0, 60), { x: 96, y: height - 56, size: 17, font: bold, color: rgb(1, 1, 1) })
    page.drawText('Golden Baobab HR  |  PAYSLIP', { x: 96, y: height - 80, size: 9, font: regular, color: rgb(0.84, 0.92, 0.89) })
    page.drawText(safeText([company.address, company.town, company.province].filter(Boolean).join(', ')).slice(0, 80), { x: 44, y: height - 103, size: 8, font: regular, color: rgb(0.9, 0.94, 0.92) })
    page.drawText('Confidential employee payroll statement', { x: 44, y: 27, size: 7, font: regular, color: rgb(0.45, 0.48, 0.5) })
    page.drawText(`Page ${pageNumber}`, { x: width - 82, y: 27, size: 7, font: regular, color: rgb(0.45, 0.48, 0.5) })
    y = height - 153
  }
  const ensureSpace = (points = 20) => { if (y - points < 62) addPage() }
  const write = (value: unknown, x = 44, size = 10, font = regular, color = rgb(0.13, 0.17, 0.2)) => {
    ensureSpace(size + 5)
    page.drawText(safeText(value).slice(0, 110), { x, y, size, font, color })
  }
  const line = () => {
    ensureSpace(22)
    page.drawLine({ start: { x: 44, y: y - 8 }, end: { x: width - 44, y: y - 8 }, thickness: 0.7, color: rgb(0.84, 0.87, 0.88) })
    y -= 20
  }
  const row = (label: string, value: unknown) => {
    ensureSpace(20)
    write(label, 48)
    write(money(value), width - 135, 10, bold)
    y -= 18
  }

  addPage()
  write(`${periodName} salary statement`, 44, 18, bold); y -= 28
  write(`Reference: GBHR-${text(snapshot.payroll_run_id).slice(0, 8).toUpperCase()}-${text(employee.employee_number)}`, 44, 9); y -= 24
  write(`Employee: ${[employee.first_name, employee.middle_name, employee.last_name].filter(Boolean).join(' ')}`, 44, 11, bold); y -= 18
  write(`Number: ${employee.employee_number}     Role: ${employee.job_title}     Department: ${employee.department}`, 44, 9); y -= 16
  write(`Branch: ${object(snapshot.branch).name}`, 44, 9); y -= 24
  ensureSpace(40)
  write('LEAVE ENTITLEMENT AND BALANCE', 44, 10, bold, rgb(0.04, 0.35, 0.28)); y -= 22
  if (leavePolicies.length) {
    for (const policy of leavePolicies) {
      ensureSpace(40)
      const leaveLabel = text(policy.leave_type).replaceAll('_', ' ')
      write(`${leaveLabel} · monthly entitlement`, 48, 9)
      write(statementDays(policy.monthly_entitlement_days), width - 150, 9, bold)
      y -= 16
      write(`${leaveLabel} · balance at period end`, 48, 9)
      write(statementDays(policy.balance_days), width - 150, 9, bold)
      y -= 18
    }
  } else {
    write('No paid leave accrual policy applies to this period.', 48, 9); y -= 18
  }
  y -= 8
  ensureSpace(40)
  write('EARNINGS', 44, 10, bold, rgb(0.04, 0.35, 0.28)); y -= 22
  row('Basic salary', item.basic_pay)
  row('Housing allowance', item.housing_allowance)
  row('Meal allowance', item.meal_allowance)
  row('Transport allowance', item.transport_allowance)
  row('Other allowances', item.other_allowances)
  if (num(item.attendance_deduction)) {
    ensureSpace(20)
    write('Unpaid leave adjustment (already reflected in gross)', 48)
    write(`(${money(item.attendance_deduction)})`, width - 135, 10, bold)
    y -= 18
  }
  if (num(item.overtime)) row('Approved overtime', item.overtime)
  if (num(item.bonuses_and_other_earnings) && !additional.length) row('Bonuses and other earnings', item.bonuses_and_other_earnings)
  for (const earning of additional) row(text(earning.earning_type).replaceAll('_', ' '), earning.amount)
  row('Gross earnings', item.gross_pay); line()
  ensureSpace(40)
  write('DEDUCTIONS', 44, 10, bold, rgb(0.04, 0.35, 0.28)); y -= 22
  row('PAYE', statutory.PAYE)
  row('NAPSA employee', statutory.NAPSA_EMPLOYEE)
  row('NHIMA employee', statutory.NHIMA_EMPLOYEE)
  for (const deduction of installments) row(text(deduction.deduction_type).replaceAll('_', ' '), deduction.scheduled_amount)
  const known = installments.reduce((sum, deduction) => sum + Math.round(num(deduction.scheduled_amount) * 100), 0) / 100
  const other = Math.max(0, num(item.voluntary_deductions) - known)
  if (other > 0) row('Other approved deductions', other)
  const statutoryTotal = num(statutory.PAYE) + num(statutory.NAPSA_EMPLOYEE) + num(statutory.NHIMA_EMPLOYEE)
  row('Total deductions', statutoryTotal + num(item.voluntary_deductions)); line()
  ensureSpace(40)
  write('GENERAL DEDUCTION BALANCES', 44, 10, bold, rgb(0.04, 0.35, 0.28)); y -= 22
  if (outstandingDeductions.length) {
    for (const deduction of outstandingDeductions) {
      ensureSpace(40)
      const description = text(deduction.description) || text(deduction.deduction_type).replaceAll('_', ' ')
      write(description, 48, 8, bold); y -= 14
      write(`Total ${money(deduction.total_amount)}   Recovered ${money(deduction.amount_recovered)}   Balance ${money(deduction.balance)}`, 58, 8)
      y -= 17
    }
  } else {
    write('No outstanding approved advance or loan balance at period end.', 48, 9); y -= 18
  }
  ensureSpace(52)
  y -= 4
  page.drawRectangle({ x: 44, y: y - 38, width: width - 88, height: 46, color: rgb(0.91, 0.96, 0.94) })
  page.drawText('NET SALARY', { x: 54, y: y - 19, size: 11, font: bold, color: rgb(0.04, 0.24, 0.2) })
  page.drawText(money(item.net_pay), { x: width - 150, y: y - 20, size: 14, font: bold, color: rgb(0.04, 0.24, 0.2) })
  page.drawText(`Finalized payroll version ${snapshot.payroll_version}. This statement is not proof of bank payment.`, { x: 44, y: 42, size: 8, font: regular, color: rgb(0.38, 0.42, 0.44) })
  return encryptPayslipPdf(await pdf.save({ useObjectStreams: true }), birthYear)
}

function statementDays(value: unknown) { return `${num(value).toFixed(2)} days` }
