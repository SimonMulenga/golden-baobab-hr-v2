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
}

const instructions = workbook.addWorksheet('Instructions')
instructions.columns = [{ header: 'Topic', width: 28 }, { header: 'Guidance', width: 110 }]
instructions.addRows([
  ['Employee workbook', 'Enter one employee per row on the Employees worksheet. Keep the column headings unchanged. Columns marked * are mandatory. Employee Number is optional and is generated securely when blank.'],
  ['Required onboarding fields', 'First Name, Last Name, Company, Branch, Department, and a positive Basic Salary are required. A blank or zero Basic Salary is not valid. Optional allowance cells can be blank or zero.'],
  ['Multiple companies', 'Rows in one upload may belong to different registered companies, branches, and departments. Enter the organization for every row. The application checks every row against your authorized registered structure.'],
  ['Company', 'Enter the exact registered company name. Spaces and letter casing are normalized. Unknown, inactive, ambiguous, or unauthorized companies must be corrected; no company is created automatically.'],
  ['Branch', 'Enter an active branch that belongs to the selected company. A branch from another company is rejected. Do not rely on spreadsheet dropdowns; the application database is authoritative.'],
  ['Department', 'Enter an active department registered for the selected company. Departments are company-scoped in this system. Do not create departments by editing this workbook.'],
  ['Import review', 'Each row is checked separately. Valid rows may continue while invalid rows remain available for correction. Review the accepted/rejected preview and fix every required organization or earnings error before submitting.'],
  ['Optional information', 'DOB, gender, NRC, nationality, address, phone, email, emergency contact, bank/payment, tax identifiers, employment type, contract dates, job title, and salary frequency may be added later. Leave unknown values blank; never invent them.'],
  ['Accepted dates', 'Use a real date in Excel or enter an unambiguous YYYY-MM-DD date. Dates are checked again by the server.'],
  ['Accepted amounts', 'Use ZMW numbers with up to two decimal places; commas and a leading K are accepted by the import review. Negative values and nonnumeric text are rejected.'],
  ['Contract Type', 'Enter the type shown in the signed employment contract. This field is text in the current database, not a fixed enum.'],
  ['Salary Frequency', 'Optional at onboarding. If provided, use Monthly, Fortnightly, Weekly, or Daily. Payroll setup requires the appropriate frequency before payroll processing.'],
  ['Housing allowance', 'The default proposal is 30% of Basic Salary. The workbook formula recalculates when opened in Excel. HR reviews differences from an approved contractual amount.'],
  ['Gross pay', 'Gross Pay is a compensation preview equal to Basic Salary plus the listed allowances. It is not the statutory taxable or pensionable base.'],
  ['Payment information', 'Bank and mobile money details are optional for onboarding. Payment processing requires valid payment details for the selected payment method. Account numbers are text; preserve leading zeros.'],
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
  ['gender', 'GenderValues'],
  ['employment_type', 'EmploymentTypeValues'],
  ['salary_frequency', 'SalaryFrequencyValues'],
  ['payment_method', 'PaymentMethodValues'],
  ['bank_name', 'BankNameValues'],
  ['mobile_money_provider', 'MobileMoneyProviderValues'],
]
for (const [key, name] of validationRows) {
  const column = fieldDefinition.findIndex((field) => field.key === key) + 1
  if (column <= 0) continue
  const start = worksheet.getCell(2, column).address
  const end = worksheet.getCell(preparedInputRows + 1, column).address
  worksheet.dataValidations.add(`${start}:${end}`, {
    type: 'list', allowBlank: true, formulae: [`=${name}`], showErrorMessage: true,
    errorStyle: 'warning', errorTitle: 'Review this value', error: 'Choose a listed value or leave it for HR review.',
  })
}
const salaryStart = worksheet.getCell(2, basicSalaryColumn).address
const salaryEnd = worksheet.getCell(preparedInputRows + 1, basicSalaryColumn).address
worksheet.dataValidations.add(`${salaryStart}:${salaryEnd}`, {
  type: 'decimal', operator: 'greaterThan', formulae: [0], allowBlank: false,
  showErrorMessage: true, errorStyle: 'stop', errorTitle: 'Positive basic salary required',
  error: 'Enter a positive amount with no more than two decimal places.',
})
// Keep formula cells intact, but leave sheet navigation and all input cells
// available in Excel. Sheet protection caused Tab from column Y to wrap to A.
worksheet.protection = undefined

await workbook.xlsx.writeFile(resolve(root, 'public/employee-template.xlsx'))
