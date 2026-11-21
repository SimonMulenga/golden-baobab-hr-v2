import { useCallback, useEffect, useState } from 'react'
import { Bell, ChevronLeft, ChevronRight, Clock3, Settings2, ShieldCheck } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useCompanySelection, useWorkspace, type WorkspacePreferences } from '../companies/WorkspaceContext'
import { getSupabaseClient } from '../../lib/supabase/client'
import { createLiveOperationsServices, type UserNotificationRecord, type WorkspaceSettingsRecord } from '../../services/live-operations-services'
import { getNotificationPreference, notificationsInAppText, playNotificationChime, setNotificationPreference } from '../notifications/notification-preferences'
import { currentPushSubscription, disablePush, enablePush, pushAvailability, sendPushTest } from '../notifications/web-push'
import './live-operations.css'
import '../../module-modernization.css'

const PAGE_SIZE = 25
const routeFor = (item: UserNotificationRecord) => item.source_type === 'EMPLOYEE' ? `/employees/${encodeURIComponent(item.source_id)}` : item.action_path

export function LiveNotifications({ userId }: { userId?: string }) {
  const [page, setPage] = useState(1)
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [items, setItems] = useState<UserNotificationRecord[]>([])
  const [total, setTotal] = useState(0)
  const [unreadTotal, setUnreadTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [soundEnabled, setSoundEnabled] = useState(() => userId ? getNotificationPreference(userId, 'sound') : false)
  const [systemEnabled, setSystemEnabled] = useState(() => userId ? getNotificationPreference(userId, 'system') : false)
  const [permission, setPermission] = useState<NotificationPermission>(() => typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'denied')
  const [pushEnabled, setPushEnabled] = useState(false)
  const [pushBusy, setPushBusy] = useState(false)
  const [pushAvailabilityState] = useState(() => pushAvailability())
  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const response = await createLiveOperationsServices(getSupabaseClient()).notifications.list({ page, pageSize: PAGE_SIZE, unreadOnly })
      setItems(response.items); setTotal(response.total); setUnreadTotal(response.unreadTotal)
    } catch { setError('Your notification inbox could not be loaded. Check your session and retry.') }
    finally { setLoading(false) }
  }, [page, unreadOnly])
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    let mounted = true
    if (userId && pushAvailabilityState.supported) void currentPushSubscription().then((subscription) => { if (mounted) setPushEnabled(Boolean(subscription)) }).catch(() => undefined)
    return () => { mounted = false }
  }, [userId, pushAvailabilityState.supported])
  const changePush = async () => {
    if (!userId || pushBusy) return
    setPushBusy(true); setError(''); setNotice('')
    try {
      if (pushEnabled) {
        await disablePush(getSupabaseClient())
        setPushEnabled(false)
        setNotice('Background notifications are disabled for this device.')
      } else {
        await enablePush(getSupabaseClient())
        setPermission(Notification.permission)
        setPushEnabled(true)
        setNotice('Background notifications are enabled for this device.')
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Background notifications could not be updated.') }
    finally { setPushBusy(false) }
  }
  const testPush = async () => {
    if (!pushEnabled || pushBusy) return
    setPushBusy(true); setError(''); setNotice('')
    try {
      const sent = await sendPushTest(getSupabaseClient())
      setNotice(sent > 0 ? 'A test notification was sent to this device.' : 'No active push subscription was found for this account.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The test notification could not be sent.') }
    finally { setPushBusy(false) }
  }
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
    {userId && <section className="panel pwa-settings" aria-label="Notification preferences">
      <div><strong>Notification preferences</strong><p>Choose how this device lets you know when one of your workflows changes.</p></div>
      <div className="pwa-setting-row"><div className="pwa-setting-copy"><strong>Notification sound</strong><span>A short, quiet chime plays for new in-app workflow updates.</span></div><button className="button-secondary" type="button" aria-pressed={soundEnabled} onClick={() => { const enabled = !soundEnabled; setSoundEnabled(enabled); setNotificationPreference(userId, 'sound', enabled); if (enabled) void playNotificationChime() }}>{soundEnabled ? 'Sound on' : 'Sound off'}</button></div>
      <div className="pwa-setting-row"><div className="pwa-setting-copy"><strong>Desktop and device notifications</strong><span>System alerts use generic text and never include employee or payroll details.</span></div><button className="button-secondary" type="button" aria-pressed={systemEnabled && permission === 'granted'} disabled={permission === 'denied'} onClick={async () => { if (permission === 'granted') { const enabled = !systemEnabled; setSystemEnabled(enabled); setNotificationPreference(userId, 'system', enabled); return } if (!('Notification' in window)) return; const result = await Notification.requestPermission(); setPermission(result); const enabled = result === 'granted'; setSystemEnabled(enabled); setNotificationPreference(userId, 'system', enabled) }}>{permission === 'granted' ? (systemEnabled ? 'Device alerts on' : 'Device alerts off') : permission === 'denied' ? 'Blocked in browser' : 'Enable device alerts'}</button></div>
      {permission === 'denied' && <span className="pwa-permission-note">Notifications are blocked in this browser. Change the site permission in browser settings, then return here.</span>}
      <div className="pwa-setting-row"><div className="pwa-setting-copy"><strong>Background notifications</strong><span>{pushAvailabilityState.supported ? 'Receive generic workflow alerts when this app is minimized or closed.' : pushAvailabilityState.reason}</span></div><div className="live-notification-actions"><button className="button-secondary" type="button" disabled={!pushAvailabilityState.supported || permission === 'denied' || pushBusy} aria-pressed={pushEnabled} onClick={() => void changePush()}>{pushBusy ? 'Working…' : pushEnabled ? 'Disable on this device' : 'Enable background notifications'}</button><button className="button-secondary" type="button" disabled={!pushEnabled || pushBusy} onClick={() => void testPush()}>Test notification</button></div></div>
      {permission === 'denied' && pushAvailabilityState.supported && <span className="pwa-permission-note">Background notifications are blocked by browser settings. Allow notifications for this site, then return here.</span>}
    </section>}
    {error && <p className="live-error" role="alert">{error}</p>}{notice && <p className="live-notice" role="status">{notice}</p>}
    <div className="live-notification-tabs"><button className={!unreadOnly ? 'active' : ''} onClick={() => { setPage(1); setUnreadOnly(false) }}>All</button><button className={unreadOnly ? 'active' : ''} onClick={() => { setPage(1); setUnreadOnly(true) }}>Unread ({unreadTotal})</button></div>
    <section className="panel live-notification-list" aria-label="Notifications">
      {loading ? <div className="live-notification-empty" role="status">Loading your notifications…</div> : items.length ? items.map((item) => { const safeText = notificationsInAppText(item.source_type); return <article className={item.read_at ? '' : 'unread'} key={item.id}><span className="live-notification-icon"><Bell size={17}/></span><div className="live-notification-copy"><strong>{safeText.title}</strong><p>{safeText.message}</p><small><Clock3 size={12}/> {new Date(item.created_at).toLocaleString()} · {item.source_type}</small></div><div className="live-notification-actions"><Link className="button-secondary" to={routeFor(item)}>Open</Link><button className="button-secondary" disabled={busyId === item.id} onClick={() => void setRead(item, !item.read_at)}>{item.read_at ? 'Mark unread' : 'Mark read'}</button></div></article> }) : <div className="live-notification-empty"><Bell size={22}/><strong>{unreadOnly ? 'No unread notifications' : 'No workflow updates yet'}</strong><span>Updates appear when a workflow you started changes.</span></div>}
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
