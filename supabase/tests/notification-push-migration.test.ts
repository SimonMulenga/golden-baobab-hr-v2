import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(resolve(process.cwd(), 'supabase/migrations/20261121006100_realtime_and_web_push_notifications.sql'), 'utf8')
const baseMigration = readFileSync(resolve(process.cwd(), 'supabase/migrations/20261029003000_workspace_notifications_and_settings.sql'), 'utf8')
const edgeFunction = readFileSync(resolve(process.cwd(), 'supabase/functions/notification-push/index.ts'), 'utf8')

describe('private realtime and web push contracts', () => {
  it('adds only the private inbox table to Realtime and preserves recipient RLS', () => {
    expect(migration).toContain("tablename = 'user_notifications'")
    expect(baseMigration).toContain("using(recipient_id=auth.uid())")
    expect(migration).not.toMatch(/alter publication supabase_realtime add table public\.(?!user_notifications)/)
  })

  it('keeps push endpoints inaccessible to browser SQL and binds registration to auth.uid()', () => {
    expect(migration).toMatch(/revoke all on public\.user_push_subscriptions from public, anon, authenticated/i)
    expect(migration).toMatch(/values\(auth\.uid\(\),p_endpoint,p_p256dh,p_auth_secret\)/i)
    expect(migration).toContain("where public.user_push_subscriptions.user_id=auth.uid()")
    expect(migration).toContain("where user_id=auth.uid() and endpoint=p_endpoint")
  })

  it('queues generic delivery and has bounded retry/error logging without sensitive payload fields', () => {
    expect(migration).toContain('notification_push_outbox')
    expect(migration).toContain('vault.decrypted_secrets')
    expect(migration).toContain("'x-gbhr-dispatch-secret'")
    expect(edgeFunction).toContain('attempt <= 3')
    expect(edgeFunction).toContain("path: '/notifications'")
    expect(edgeFunction).not.toMatch(/employee_number|bank_account|nrc_number|salary_amount/i)
    expect(edgeFunction).toContain('SUPABASE_SERVICE_ROLE_KEY')
    expect(edgeFunction).toContain('PUSH_DISPATCH_SECRET')
  })
})
