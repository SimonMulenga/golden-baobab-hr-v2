import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(resolve(process.cwd(), 'supabase/migrations/20261123006900_encrypt_payslip_pdf_artifacts.sql'), 'utf8')

describe('encrypted payslip artifact migration', () => {
  it('marks old documents for conversion and requires a trusted post-validation mark for new PDFs', () => {
    expect(migration).toContain('add column if not exists encryption_version integer not null default 0')
    expect(migration).toContain('payslip_document_mark_encrypted')
    expect(migration).toContain("app_private.payslip_actor_has_permission(p_actor_id,'payslip.issue'")
    expect(migration).toContain("o.bucket_id='gb-payslips' and o.name=v_doc.storage_path")
  })

  it('keeps DOB and PDF passwords server-only and tenant scoped', () => {
    expect(migration).toContain('payslip_issue_birth_year')
    expect(migration).toContain('payslip_document_birth_year')
    expect(migration).toContain('to_char(e.date_of_birth, \'YYYY\')')
    expect(migration).toContain('e.company_id=v_doc.company_id and e.portfolio_id=v_doc.portfolio_id')
    expect(migration).toContain('revoke all on function public.payslip_issue_birth_year')
    expect(migration).toContain('to service_role')
  })

  it('uses atomic encrypted artifact swaps and retains old private objects', () => {
    expect(migration).toContain('for update')
    expect(migration).toContain('v_doc.encryption_version=1')
    expect(migration).toContain('update public.payslip_documents set storage_path=p_new_storage_path,content_sha256=p_new_content_sha256,encryption_version=1')
    expect(migration).toContain("'PAYSLIP_DOCUMENT_ENCRYPTED'")
    expect(migration).not.toMatch(/delete\s+from\s+storage\.objects/iu)
    expect(migration).not.toMatch(/delete\s+from\s+public\.payroll/iu)
  })
})
