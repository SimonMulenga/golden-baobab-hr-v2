import ExcelJS from 'exceljs'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = process.cwd()
const fieldDefinition = JSON.parse(await readFile(resolve(root, 'src/features/employees/employee-template-columns.json'), 'utf8'))
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

await workbook.xlsx.writeFile(resolve(root, 'public/employee-template.xlsx'))
