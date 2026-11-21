# Payslip email distribution

This feature creates PDFs from finalized payroll snapshots. It does not recalculate payroll, attach PDFs to email, or send email while the explicit live-delivery switch is off.

## Release prerequisites

1. Review and apply `20261121006400_secure_payslip_distribution_and_access.sql` to Supabase project `jssuaebiizjcoqmngxzk` after confirming the remote migration history.
2. Deploy the `payslip-artifacts`, `payslip-access`, and `resend-payslip-webhook` Edge Functions.
3. Keep the existing Supabase URL, anon key, and service-role key in the Supabase-managed function environment. Never copy the service-role key to Vercel or browser code.
4. Configure these Supabase function secrets:
   - `RESEND_API_KEY`
   - `RESEND_WEBHOOK_SECRET`
   - `PAYSLIP_FROM_EMAIL=Golden Baobab HR <payslips@luskamtravelagents.com>`
   - `PAYSLIP_PUBLIC_APP_URL=https://goldenbaobab.luskamtravelagents.com`
   - `PAYSLIP_ACCESS_TOKEN_SECRET` with at least 32 random characters
   - `APPROVED_APP_ORIGINS` with the approved production and preview origins as needed
5. Verify `luskamtravelagents.com` in Resend and confirm its SPF, DKIM, and DMARC configuration before setting `PAYSLIP_SENDER_DOMAIN_VERIFIED=true`.
6. Keep `PAYSLIP_LIVE_DELIVERY_ENABLED` and `PAYSLIP_FIRST_LIVE_SEND_APPROVED` unset/false until the owner explicitly approves the first live send. Both must be explicitly `true` before the function can call Resend.
7. Configure the Resend webhook to `https://jssuaebiizjcoqmngxzk.supabase.co/functions/v1/resend-payslip-webhook` for sent, delivered, bounced, failed, and delayed events.

The webhook verifies the Svix signature over the exact raw request body. It filters to messages tagged `product=golden-baobab-payslip`. Events arriving before the provider response is committed are retained and reconciled after the provider message ID is recorded.

## Access and retention behavior

Email contains a 48-hour private link, not a PDF attachment or public Storage URL. The recipient must provide their employee number and date of birth. The token is high entropy, stored only as an HMAC hash, rate-limited to five verification attempts, and revocable by an authorized payroll issuer. PDF delivery status is distinct from employee approval and payroll finalization.

`SENT` means Resend accepted the message. `DELIVERED` and `BOUNCED` are set from verified provider webhooks. Failed messages have a bounded retry count; delivered messages cannot be resent through the retry operation.
