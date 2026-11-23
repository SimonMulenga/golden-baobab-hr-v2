import { assert, assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { PDFDocument } from 'npm:@cantoo/pdf-lib@2.11.1'
import { encryptPayslipPdf, isBirthYearEncryptedPdf } from './encryption.ts'

Deno.test('AES-256 payslip PDF opens with birth year and rejects an incorrect year', async () => {
  const source = await PDFDocument.create()
  source.addPage().drawText('Synthetic payroll QA document')
  const encrypted = await encryptPayslipPdf(await source.save(), '1995')
  const inspection = await PDFDocument.load(encrypted, { ignoreEncryption: true })
  assert(inspection.isEncrypted)
  assert(await isBirthYearEncryptedPdf(encrypted, '1995'))
  assertEquals(await isBirthYearEncryptedPdf(encrypted, '1994'), false)
  await assertRejects(() => PDFDocument.load(encrypted, { password: '1994' }))
  const opened = await PDFDocument.load(encrypted, { password: '1995' })
  assertEquals(opened.getPageCount(), 1)
})

Deno.test('encryption refuses absent or non-four-digit birth-year passwords', async () => {
  const source = await PDFDocument.create()
  source.addPage()
  const bytes = await source.save()
  await assertRejects(() => encryptPayslipPdf(bytes, '95'))
  await assertRejects(() => encryptPayslipPdf(bytes, '19950'))
})
