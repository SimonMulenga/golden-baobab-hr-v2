import { PDFDocument } from 'npm:@cantoo/pdf-lib@2.11.1'

function ownerPassword() {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')
}

function assertBirthYear(value: string) {
  if (!/^\d{4}$/u.test(value)) throw new Error('EMPLOYEE_BIRTH_YEAR_REQUIRED')
}

export async function encryptPayslipPdf(bytes: Uint8Array, birthYear: string): Promise<Uint8Array> {
  assertBirthYear(birthYear)
  const document = await PDFDocument.load(bytes)
  document.encrypt({
    userPassword: birthYear,
    ownerPassword: ownerPassword(),
    permissions: { printing: 'highResolution', modifying: false, copying: false, annotating: false },
  })
  return document.save({ useObjectStreams: true })
}

export async function isBirthYearEncryptedPdf(bytes: Uint8Array, birthYear: string): Promise<boolean> {
  assertBirthYear(birthYear)
  try {
    const inspection = await PDFDocument.load(bytes, { ignoreEncryption: true })
    if (!inspection.isEncrypted) return false
    await PDFDocument.load(bytes, { password: birthYear })
    return true
  } catch {
    return false
  }
}
