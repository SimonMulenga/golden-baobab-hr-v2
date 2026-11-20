import ExcelJS from 'exceljs'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = process.cwd()
const fieldDefinition = JSON.parse(await readFile(resolve(root, 'src/features/employees/employee-template-columns.json'), 'utf8'))
const validValues = JSON.parse(await readFile(resolve(root, 'src/features/employees/employee-template-values.json'), 'utf8'))
const workbook = new ExcelJS.Workbook()
workbook.creator = 'Golden Baobab HR'
workbook.subject = 'Blank employee import template'
workbook.title = 'Golden Baobab Employee Template'
workbook.company = 'Golden Baobab'
workbook.calcProperties = { calcMode: 'auto', fullCalcOnLoad: true, forceFullCalc: true }

const worksheet = workbook.addWorksheet('Employees', {
  views: [{ state: 'frozen', ySplit: 1, activeCell: 'A2', topLeftCell: 'A2' }],
})
const currencyFormat = '"K"#,##0.00;[Red]-"K"#,##0.00;""'
worksheet.columns = fieldDefinition.map(({ heading, format }) => ({
  header: heading,
  width: Math.min(36, Math.max(17, heading.length + 3)),
  style: { numFmt: format === 'text' ? '@' : format === 'date' ? 'dd/mm/yyyy' : format === 'currency' ? currencyFormat : 'General' },
}))
worksheet.getRow(1).height = 34
worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 }
worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF173F35' } }
worksheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'left', wrapText: true }
worksheet.getRow(1).border = { bottom: { style: 'medium', color: { argb: 'FFD4A84F' } } }

const preparedInputRows = 500
worksheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: preparedInputRows + 1, column: fieldDefinition.length } }
const basicSalaryColumn = fieldDefinition.findIndex(({ key }) => key === 'basic_pay') + 1
const housingAllowanceColumn = fieldDefinition.findIndex(({ key }) => key === 'housing_allowance') + 1
const grossPayColumn = fieldDefinition.findIndex(({ key }) => key === 'gross_pay') + 1
worksheet.getColumn(housingAllowanceColumn).width = 34
worksheet.getColumn(grossPayColumn).width = 39
for (let row = 2; row <= preparedInputRows + 1; row++) {
  const salaryAddress = worksheet.getCell(row, basicSalaryColumn).address
  const housingCell = worksheet.getCell(row, housingAllowanceColumn)
  housingCell.value = { formula: `IF(${salaryAddress}="","",ROUND(${salaryAddress}*30%,2))`, result: null }
  housingCell.numFmt = currencyFormat
  const grossPayCell = worksheet.getCell(row, grossPayColumn)
  grossPayCell.value = { formula: `IF(${salaryAddress}="","",SUM(${worksheet.getCell(row, basicSalaryColumn).address}:${worksheet.getCell(row, grossPayColumn - 1).address}))`, result: null }
  grossPayCell.numFmt = currencyFormat
  worksheet.getRow(row).eachCell({ includeEmpty: true }, (cell, columnNumber) => {
    cell.protection = { locked: columnNumber === housingAllowanceColumn || columnNumber === grossPayColumn }
  })
}

const instructions = workbook.addWorksheet('Instructions')
instructions.columns = [{ header: 'Topic', width: 28 }, { header: 'Guidance', width: 110 }]
instructions.addRows([
  ['Employee workbook', 'Enter one employee per row on the Employees worksheet. Keep the approved column headings unchanged.'],
  ['Incomplete information', 'Blank mandatory details are accepted into secure HR staging. HR will request or enter corrections before approval. Do not invent personal or employment details.'],
  ['Company and branch', 'Use the registered company name. Branch may be blank during upload. HR must assign an active branch before approval.'],
  ['Department', 'Enter the department name if known. HR will map it to an active department in the selected company. Do not create departments by editing this workbook.'],
  ['Contract Type', 'Enter the type shown in the signed employment contract. This field is text in the current database, not a fixed enum.'],
  ['Salary Frequency', 'Select Monthly, Fortnightly, Weekly, or Daily. These are the values supported by the compensation database.'],
  ['Housing allowance', 'The default proposal is 30% of Basic Salary. The workbook formula recalculates when opened in Excel. HR reviews differences from an approved contractual amount.'],
  ['Gross pay', 'Gross Pay is a compensation preview equal to Basic Salary plus the listed allowances. It is not the statutory taxable or pensionable base.'],
  ['Bank transfer', 'Bank name, account name, and account number are required before final approval. Account numbers are text; preserve leading zeros.'],
  ['Mobile money', 'Choose Airtel Money, MTN MoMo, or Zamtel Kwacha and provide the mobile money number before final approval.'],
  ['Cash', 'Bank and mobile money fields are not required for cash payment unless company policy says otherwise.'],
  ['Sensitive information', 'Upload only through the authenticated Golden Baobab HR application. Never send the workbook through public links or email.'],
])
instructions.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
instructions.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF123D49' } }
instructions.getRow(1).height = 24
instructions.views = [{ state: 'frozen', ySplit: 1 }]

const validSheet = workbook.addWorksheet('Valid Values')
const lists = [
  { name: 'GenderValues', title: 'Gender', values: validValues.gender },
  { name: 'EmploymentTypeValues', title: 'Employment Type', values: validValues.employmentType },
  { name: 'SalaryFrequencyValues', title: 'Salary Frequency', values: validValues.salaryFrequency },
  { name: 'PaymentMethodValues', title: 'Payment Method', values: validValues.paymentMethod },
  { name: 'BankNameValues', title: 'Supported Bank', values: validValues.banks },
  { name: 'MobileMoneyProviderValues', title: 'Mobile Money Provider', values: validValues.mobileMoneyProvider },
]
for (const [columnIndex, list] of lists.entries()) {
  const column = validSheet.getColumn(columnIndex + 1)
  column.width = Math.max(24, list.title.length + 4)
  validSheet.getCell(1, columnIndex + 1).value = list.title
  validSheet.getCell(1, columnIndex + 1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
  validSheet.getCell(1, columnIndex + 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF123D49' } }
  list.values.forEach((value, index) => { validSheet.getCell(index + 2, columnIndex + 1).value = value })
  const letter = validSheet.getColumn(columnIndex + 1).letter
  workbook.definedNames.add(`'Valid Values'!$${letter}$2:$${letter}$${list.values.length + 1}`, list.name)
}
validSheet.views = [{ state: 'frozen', ySplit: 1, activeCell: 'A2', topLeftCell: 'A2' }]
validSheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(...lists.map((list) => list.values.length)) + 1, column: lists.length } }

const validationRows = [
  ['F2:F501', 'GenderValues'],
  ['Q2:Q501', 'EmploymentTypeValues'],
  ['T2:T501', 'SalaryFrequencyValues'],
  ['AA2:AA501', 'PaymentMethodValues'],
  ['AB2:AB501', 'BankNameValues'],
  ['AE2:AE501', 'MobileMoneyProviderValues'],
]
for (const [range, name] of validationRows) {
  const [start, end] = range.split(':')
  worksheet.dataValidations.add(`${start}:${end}`, {
    type: 'list', allowBlank: true, formulae: [`=${name}`], showErrorMessage: true,
    errorStyle: 'warning', errorTitle: 'Review this value', error: 'Choose a listed value or leave it for HR review.',
  })
}
worksheet.protect('', { selectLockedCells: false, selectUnlockedCells: true, autoFilter: true, sort: true })

await workbook.xlsx.writeFile(resolve(root, 'public/employee-template.xlsx'))
