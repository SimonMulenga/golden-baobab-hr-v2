import { useCallback, useEffect, useState } from 'react'
import { Check, RefreshCw, RotateCcw } from 'lucide-react'
import { useWorkspace } from '../companies/WorkspaceContext'
import { getSupabaseClient } from '../../lib/supabase/client'
import { createLiveBusinessServices, type PayrollRunRecord } from '../../services/live-business-services'
import './live-payroll-approvals.css'

const money = (value: number | undefined) => value == null ? '—' : `K${Number(value).toLocaleString('en-ZM', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export function LivePayrollApprovals({ allowOwnApproval = false }: { allowOwnApproval?: boolean }) {
  const { companies } = useWorkspace()
  const [rows, setRows] = useState<PayrollRunRecord[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [userId, setUserId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const result = await createLiveBusinessServices(getSupabaseClient()).payroll.pendingApprovals({ page, pageSize: 25 })
      setRows(result.items)
      setTotal(result.total)
    } catch {
      setError('Pending payroll approvals could not be loaded. Check your payroll review access and try again.')
    } finally { setLoading(false) }
  }, [page])

  useEffect(() => {
    let active = true
    void getSupabaseClient().auth.getUser().then(({ data, error: authError }) => {
      if (active && !authError) setUserId(data.user?.id ?? null)
    }).catch(() => { if (active) setUserId(null) })
    return () => { active = false }
  }, [])

  useEffect(() => { void load() }, [load])

  const decide = async (run: PayrollRunRecord, action: 'APPROVE' | 'RETURN') => {
    let reason: string | undefined
    if (action === 'RETURN') {
      reason = window.prompt('Reason for returning this payroll for correction')?.trim() || undefined
      if (!reason) return
    } else if (!window.confirm(`Approve payroll version ${run.version} for ${periodLabel(run)}? This records approval but does not finalize or pay it.`)) return
    setBusy(true); setError(''); setNotice('')
    try {
      await createLiveBusinessServices(getSupabaseClient()).payroll.reviewSubmission(run.id, action, run.version, reason)
      setNotice(action === 'APPROVE' ? `Payroll ${run.id.slice(0, 8)} approved. Finalization remains a separate step.` : `Payroll ${run.id.slice(0, 8)} returned for correction.`)
      window.dispatchEvent(new Event('gbhr-payroll-approvals-changed'))
      await load()
    } catch (cause) {
      const code = (cause as { code?: string } | null)?.code
      const actionError = code === '42501'
        ? 'This action was denied. Confirm your approval role and company scope; preparers cannot approve their own runs unless the signed-in role is Overall HR Manager.'
        : 'This payroll changed or was reviewed by another user. Refresh the queue and review the current version.'
      await load()
      setError(actionError)
    } finally { setBusy(false) }
  }

  return <section className="live-payroll-approvals">
    <header className="payroll-approvals-heading"><div><div className="section-eyebrow">PAYROLL WORKFLOW</div><h1>Pending payroll approval</h1><p>Review submitted payroll for companies and branches available to your account.</p></div><button type="button" className="secondary-button" onClick={() => void load()} disabled={loading || busy}><RefreshCw size={16}/> Refresh</button></header>
    {notice && <div className="payroll-approvals-message success" role="status">{notice}</div>}
    {error && <div className="payroll-approvals-message error" role="alert">{error}</div>}
    {loading ? <div className="panel payroll-approvals-state" role="status">Loading pending payroll…</div>
      : rows.length === 0 ? <div className="panel payroll-approvals-state"><h2>No payroll is waiting for approval</h2><p>Submitted payroll for your authorized companies and branches will appear here.</p></div>
      : <div className="payroll-approval-list">{rows.map((run) => {
        const company = companies.find((item) => item.id === run.company_id)
        const branch = company?.branches.find((item) => item.id === run.branch_id)
        const ownRun = Boolean(userId && run.created_by === userId)
        const canApproveThisRun = !ownRun || allowOwnApproval
        const totals = run.calculations?.totals
        return <article className="panel payroll-approval-card" key={run.id}>
          <div className="payroll-approval-card-heading"><div><span className={`approval-status status-${run.status.toLowerCase()}`}>{run.status.replaceAll('_', ' ')}</span><h2>{company?.name ?? 'Authorized company'} <span>·</span> {branch?.name ?? 'Authorized branch'}</h2><p>{periodLabel(run)} · Ref {run.id.slice(0, 8)} · Version {run.version}</p></div><span className="payroll-approval-created">Submitted {new Date(run.created_at).toLocaleDateString('en-ZM')}</span></div>
          {totals ? <dl className="payroll-approval-totals"><div><dt>Employees</dt><dd>{totals.employee_count}</dd></div><div><dt>Gross pay</dt><dd>{money(totals.gross_earnings)}</dd></div><div><dt>PAYE</dt><dd>{money(totals.paye)}</dd></div><div><dt>Net pay</dt><dd>{money(totals.net_pay)}</dd></div><div><dt>Employer cost</dt><dd>{money(totals.total_employer_cost)}</dd></div></dl> : <p className="payroll-approval-warning">Calculation summary is unavailable. Open Payroll and refresh the saved calculation before deciding.</p>}
          {ownRun && <p className="payroll-approval-warning">{allowOwnApproval ? 'Overall HR can approve this run in the authorized portfolio. Returning a payroll you prepared requires another reviewer.' : 'You prepared this run. Another authorized reviewer must decide.'}</p>}
          <footer><button className="secondary-button" type="button" disabled={busy || ownRun} onClick={() => void decide(run, 'RETURN')}><RotateCcw size={16}/> Return for correction</button><button className="primary-button" type="button" disabled={busy || !canApproveThisRun || !totals} onClick={() => void decide(run, 'APPROVE')}><Check size={16}/> Approve version {run.version}</button></footer>
        </article>
      })}</div>}
    {!loading && total > 25 && <footer className="payroll-approval-pagination"><button className="secondary-button" disabled={page <= 1 || busy} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</button><span>Page {page} of {Math.ceil(total / 25)} · {total} pending</span><button className="secondary-button" disabled={page >= Math.ceil(total / 25) || busy} onClick={() => setPage((value) => value + 1)}>Next</button></footer>}
  </section>
}

function periodLabel(run: PayrollRunRecord) {
  const start = run.payroll_periods?.period_start
  const end = run.payroll_periods?.period_end
  return start && end ? `${start} to ${end}` : `Payroll period ${run.payroll_period_id.slice(0, 8)}`
}
