import { useCallback, useEffect, useState } from 'react'
import { Bell, ChevronLeft, ChevronRight, Clock3, Settings2, ShieldCheck } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useCompanySelection, useWorkspace, type WorkspacePreferences } from '../companies/WorkspaceContext'
import { getSupabaseClient } from '../../lib/supabase/client'
import { createLiveOperationsServices, type UserNotificationRecord, type WorkspaceSettingsRecord } from '../../services/live-operations-services'
import './live-operations.css'

const PAGE_SIZE = 25
const routeFor = (item: UserNotificationRecord) => item.source_type === 'EMPLOYEE' ? `/employees/${encodeURIComponent(item.source_id)}` : item.action_path

export function LiveNotifications() {
  const [page, setPage] = useState(1)
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [items, setItems] = useState<UserNotificationRecord[]>([])
  const [total, setTotal] = useState(0)
  const [unreadTotal, setUnreadTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const response = await createLiveOperationsServices(getSupabaseClient()).notifications.list({ page, pageSize: PAGE_SIZE, unreadOnly })
      setItems(response.items); setTotal(response.total); setUnreadTotal(response.unreadTotal)
    } catch { setError('Your notification inbox could not be loaded. Check your session and retry.') }
    finally { setLoading(false) }
  }, [page, unreadOnly])
  useEffect(() => { void load() }, [load])
  const setRead = async (item: UserNotificationRecord, read: boolean) => {
    setBusyId(item.id); setError(''); setNotice('')
    try { await createLiveOperationsServices(getSupabaseClient()).notifications.setRead(item.id, read); await load(); setNotice(read ? 'Notification marked as read.' : 'Notification marked unread.') }
    catch { setError('The notification read state was not changed.') }
    finally { setBusyId('') }
  }
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  return <div className="live-operations-screen">
    <header className="page-heading"><div><div className="eyebrow">WORKSPACE UPDATES</div><h1>Notifications</h1><p>Workflow status updates for records you created. This inbox does not send email or external messages.</p></div><button className="button-secondary" disabled={loading || busyId !== '' || !items.some((item) => !item.read_at)} onClick={async () => { setBusyId('all'); setError(''); try { await createLiveOperationsServices(getSupabaseClient()).notifications.setManyRead(items.filter((row) => !row.read_at).map((row) => row.id), true); await load() } catch { setError('Notifications on this page could not be marked as read.') } finally { setBusyId('') } }}>Mark page read</button></header>
    <div className="live-data-notice"><Bell size={15}/> {unreadTotal} unread notification{unreadTotal === 1 ? '' : 's'} · private to your signed-in account</div>
    {error && <p className="live-error" role="alert">{error}</p>}{notice && <p className="live-notice" role="status">{notice}</p>}
    <div className="live-notification-tabs"><button className={!unreadOnly ? 'active' : ''} onClick={() => { setPage(1); setUnreadOnly(false) }}>All</button><button className={unreadOnly ? 'active' : ''} onClick={() => { setPage(1); setUnreadOnly(true) }}>Unread ({unreadTotal})</button></div>
    <section className="panel live-notification-list" aria-label="Notifications">
      {loading ? <div className="live-notification-empty" role="status">Loading your notifications…</div> : items.length ? items.map((item) => <article className={item.read_at ? '' : 'unread'} key={item.id}><span className="live-notification-icon"><Bell size={17}/></span><div className="live-notification-copy"><strong>{item.title}</strong><p>{item.message}</p><small><Clock3 size={12}/> {new Date(item.created_at).toLocaleString()} · {item.source_type}</small></div><div className="live-notification-actions"><Link className="button-secondary" to={routeFor(item)}>Open</Link><button className="button-secondary" disabled={busyId === item.id} onClick={() => void setRead(item, !item.read_at)}>{item.read_at ? 'Mark unread' : 'Mark read'}</button></div></article>) : <div className="live-notification-empty"><Bell size={22}/><strong>{unreadOnly ? 'No unread notifications' : 'No workflow updates yet'}</strong><span>Updates appear when a workflow you started changes.</span></div>}
      <footer><span>Page {page} of {pageCount} · {total} notifications</span><div><button className="button-secondary" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}><ChevronLeft size={14}/> Previous</button><button className="button-secondary" disabled={page >= pageCount || loading} onClick={() => setPage((value) => value + 1)}>Next <ChevronRight size={14}/></button></div></footer>
    </section>
  </div>
}

const defaultSettings: Omit<WorkspaceSettingsRecord,'portfolio_id'|'company_id'|'updated_by'|'updated_at'> = { timezone: 'Africa/Lusaka', date_format: 'DD/MM/YYYY', currency_code: 'ZMW', payroll_cutoff_day: 25 }
export function LiveSettings() {
  const { companies, setPreferences } = useWorkspace()
  const { companyId, setCompanyId } = useCompanySelection()
  const [settings, setSettings] = useState(defaultSettings)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const load = useCallback(async () => {
    if (!companyId) { setLoading(false); setSettings(defaultSettings); return }
    setLoading(true); setError('')
    try { const row = await createLiveOperationsServices(getSupabaseClient()).settings.get(companyId); setSettings(row ? { timezone: row.timezone, date_format: row.date_format, currency_code: row.currency_code, payroll_cutoff_day: row.payroll_cutoff_day } : defaultSettings) }
    catch { setError('Workspace settings are unavailable under your current company permissions.') }
    finally { setLoading(false) }
  }, [companyId])
  useEffect(() => { void load() }, [load])
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError(''); setNotice('')
    try {
      await createLiveOperationsServices(getSupabaseClient()).settings.save({ companyId, timezone: settings.timezone, dateFormat: settings.date_format, currencyCode: settings.currency_code, payrollCutoffDay: Number(settings.payroll_cutoff_day) })
      setPreferences?.(companyId, settings as WorkspacePreferences)
      setNotice('Company settings saved.')
    } catch { setError('Settings were not saved. Confirm company administrator access and valid values.') }
    finally { setBusy(false) }
  }
  return <div className="live-operations-screen">
    <header className="page-heading"><div><div className="eyebrow">COMPANY CONFIGURATION</div><h1>Workspace settings</h1><p>Manage regional defaults and the planned payroll cut-off for a company.</p></div></header>
    <div className="live-data-notice"><ShieldCheck size={15}/> The planned cut-off date is a reminder and does not authorize or block payroll.</div>
    {error && <p className="live-error" role="alert">{error}</p>}{notice && <p className="live-notice" role="status">{notice}</p>}
    <section className="panel live-settings-panel"><label>Company<select aria-label="Settings company" value={companyId} onChange={(event) => setCompanyId(event.target.value)}><option value="">Choose a company</option>{companies.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      {loading ? <p role="status">Loading settings…</p> : !companyId ? <p>Choose a company to view its settings.</p> : <form onSubmit={(event) => void save(event)}>
        <label>Time zone<select required value={settings.timezone} onChange={(event) => setSettings({ ...settings, timezone: event.target.value })}>{['Africa/Lusaka','Africa/Harare','Africa/Johannesburg','UTC'].map((zone) => <option key={zone}>{zone}</option>)}</select></label>
        <label>Date format<select value={settings.date_format} onChange={(event) => setSettings({ ...settings, date_format: event.target.value as WorkspaceSettingsRecord['date_format'] })}><option value="DD/MM/YYYY">DD/MM/YYYY</option><option value="YYYY-MM-DD">YYYY-MM-DD</option></select></label>
        <label>Currency<input value="ZMW · Zambian Kwacha" readOnly aria-label="Currency"/></label>
        <label>Planned payroll cut-off day<input type="number" min="1" max="28" required value={settings.payroll_cutoff_day} onChange={(event) => setSettings({ ...settings, payroll_cutoff_day: Number(event.target.value) })}/></label>
        <p className="live-settings-note"><Settings2 size={15}/> Payroll processing remains monthly; this planning date is not an authorization rule.</p>
        <footer><button className="button-primary" disabled={busy || !companyId}>{busy ? 'Saving…' : 'Save company settings'}</button></footer>
      </form>}
    </section>
  </div>
}
