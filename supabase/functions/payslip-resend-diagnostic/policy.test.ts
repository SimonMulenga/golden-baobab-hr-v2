import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { diagnosticGatesDisabled, diagnosticRecipient, diagnosticSubject, diagnosticText, validDiagnosticConfiguration } from './policy.ts'

Deno.test('diagnostic accepts only the fixed owner recipient and verified sender address', () => {
  assertEquals(diagnosticRecipient, 'simonmulenga155@gmail.com')
  assert(validDiagnosticConfiguration('SIMONMULENGA155@gmail.com', 'Golden Baobab HR <payslips@luskamtravelagents.com>'))
  assertEquals(validDiagnosticConfiguration('other@example.test', 'Golden Baobab HR <payslips@luskamtravelagents.com>'), false)
  assertEquals(validDiagnosticConfiguration('', 'Golden Baobab HR <payslips@luskamtravelagents.com>'), false)
  assertEquals(validDiagnosticConfiguration(diagnosticRecipient, 'unverified@example.test'), false)
})

Deno.test('diagnostic is blocked if either payslip delivery gate is enabled', () => {
  assertEquals(diagnosticGatesDisabled('false', 'false'), true)
  assertEquals(diagnosticGatesDisabled(undefined, 'false'), true)
  assertEquals(diagnosticGatesDisabled('true', 'false'), false)
  assertEquals(diagnosticGatesDisabled('false', 'true'), false)
})

Deno.test('diagnostic message is fixed, plain text, and contains no payroll data', () => {
  assertEquals(diagnosticSubject, '[Golden Baobab HR] Resend infrastructure diagnostic')
  assert(diagnosticText.includes('contains no employee, payroll, or payslip information'))
  assertEquals(diagnosticText.includes('<'), false)
})
