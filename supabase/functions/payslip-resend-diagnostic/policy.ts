export const diagnosticSubject = '[Golden Baobab HR] Resend infrastructure diagnostic'
export const diagnosticRecipient = 'simonmulenga155@gmail.com'
export const diagnosticText = [
  'This is a one-time Golden Baobab HR Resend infrastructure diagnostic.',
  'It contains no employee, payroll, or payslip information.',
  'No reply or action is required.',
].join('\n')

export function validDiagnosticConfiguration(recipient: string, sender: string): boolean {
  return recipient.trim().toLowerCase() === diagnosticRecipient
    && sender.endsWith('<payslips@luskamtravelagents.com>')
}

export function diagnosticGatesDisabled(liveDelivery: string | undefined, firstLiveApproval: string | undefined): boolean {
  return liveDelivery?.trim().toLowerCase() !== 'true'
    && firstLiveApproval?.trim().toLowerCase() !== 'true'
}
