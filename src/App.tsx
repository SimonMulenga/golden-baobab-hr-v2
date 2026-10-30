import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { BrowserRouter, Link, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Activity, Bell, Building2, CalendarDays, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, Clock3, FileBarChart2, FileText, Fingerprint, LayoutDashboard, Menu, Moon, MoreHorizontal, Search, Settings, ShieldCheck, Sun, Users, Wallet, X } from 'lucide-react'
import { WorkspaceContext, defaultWorkspacePreferences, useWorkspace, type WorkspacePreferences } from './features/companies/WorkspaceContext'
import { AuthProvider } from './features/auth/AuthContext'
import { useAuth } from './features/auth/auth-context'
import { getAuthGateDecision } from './features/auth/auth-routing'
import { isLiveMode } from './lib/data-mode'
import { getSupabaseClient } from './lib/supabase/client'
import { createLiveCompanyServices } from './services/live-company-services'
import { createLiveOperationsServices } from './services/live-operations-services'
import { loadDashboardMetrics, type DashboardMetrics } from './services/live-dashboard-services'
import type { Company } from './features/companies/types'
const { CompanyDirectory, CompanyForm, CompanyProfile, BranchManagement } = { CompanyDirectory: lazy(() => import('./features/companies/CompanyScreens').then((module) => ({ default: module.CompanyDirectory }))), CompanyForm: lazy(() => import('./features/companies/CompanyScreens').then((module) => ({ default: module.CompanyForm }))), CompanyProfile: lazy(() => import('./features/companies/CompanyScreens').then((module) => ({ default: module.CompanyProfile }))), BranchManagement: lazy(() => import('./features/companies/CompanyScreens').then((module) => ({ default: module.BranchManagement }))) }
const LiveEmployeeDirectory = lazy(() => import('./features/employees/LiveEmployeeScreens').then((module) => ({ default: module.LiveEmployeeDirectory })))
const LiveEmployeeApprovals = lazy(() => import('./features/employees/LiveEmployeeScreens').then((module) => ({ default: module.LiveEmployeeApprovals })))
const LiveEmployeeForm = lazy(() => import('./features/employees/LiveEmployeeScreens').then((module) => ({ default: module.LiveEmployeeForm })))
const LiveEmployeeProfile = lazy(() => import('./features/employees/LiveEmployeeScreens').then((module) => ({ default: module.LiveEmployeeProfile })))
const LiveEmployeeImport = lazy(() => import('./features/employees/LiveEmployeeImport').then((module) => ({ default: module.LiveEmployeeImport })))
const LiveAttendance = lazy(() => import('./features/people-ops/LiveAttendance').then((module) => ({ default: module.LiveAttendance })))
const LiveLeave = lazy(() => import('./features/people-ops/LiveLeave').then((module) => ({ default: module.LiveLeave })))
const LivePayrollInputs = lazy(() => import('./features/payroll/LivePayrollInputs').then((module) => ({ default: module.LivePayrollInputs })))
const LivePayrollReconciliation = lazy(() => import('./features/payroll/LivePayrollReconciliation').then((module) => ({ default: module.LivePayrollReconciliation })))
const LivePayslips = lazy(() => import('./features/payroll/LivePayslips').then((module) => ({ default: module.LivePayslips })))
const LivePayrollReports = lazy(() => import('./features/payroll/LivePayrollReports').then((module) => ({ default: module.LivePayrollReports })))
const LiveStatutoryFilings = lazy(() => import('./features/payroll/LiveStatutoryFilings').then((module) => ({ default: module.LiveStatutoryFilings })))
const LiveDeductions = lazy(() => import('./features/payroll/LiveDeductions').then((module) => ({ default: module.LiveDeductions })))
const LiveUserAdmin = lazy(() => import('./features/admin/LiveUserAdmin').then((module) => ({ default: module.LiveUserAdmin })))
const LiveAuditLogs = lazy(() => import('./features/admin/LiveAuditLogs').then((module) => ({ default: module.LiveAuditLogs })))
const LiveHrCatalog = lazy(() => import('./features/admin/LiveHrCatalog').then((module) => ({ default: module.LiveHrCatalog })))
const LiveNotifications = lazy(() => import('./features/admin/LiveOperations').then((module) => ({ default: module.LiveNotifications })))
const LiveSettings = lazy(() => import('./features/admin/LiveOperations').then((module) => ({ default: module.LiveSettings })))
const AuthPrototype = lazy(() => import('./features/auth/AuthPrototype').then((module) => ({ default: module.AuthPrototype })))
import './index.css'
import './client-ui.css'
import './enterprise-ui.css'

const nav = [
  { label: 'OVERVIEW', items: [{ name: 'Dashboard', path: '/', icon: LayoutDashboard }] },
  { label: 'PEOPLE & OPERATIONS', items: [{ name: 'Companies', path: '/companies', icon: Building2 }, { name: 'Branches', path: '/branches', icon: Building2 }, { name: 'Employees', path: '/employees', icon: Users }, { name: 'Employee Approvals', path: '/employee-approvals', icon: ShieldCheck }, { name: 'Departments', path: '/departments', icon: Building2 }, { name: 'Attendance', path: '/attendance', icon: Clock3 }, { name: 'Leave Management', path: '/leave', icon: CalendarDays }] },
  { label: 'PAYROLL & INSIGHTS', items: [{ name: 'Payroll', path: '/payroll', icon: Wallet }, { name: 'Payslips', path: '/payslips', icon: FileText }, { name: 'Payout Reconciliation', path: '/reconciliation', icon: CircleHelp }, { name: 'Deductions & Advances', path: '/deductions', icon: Wallet }, { name: 'Statutory Deductions', path: '/statutory', icon: ShieldCheck }, { name: 'Reports', path: '/reports', icon: FileBarChart2 }] },
  { label: 'ADMINISTRATION', items: [{ name: 'Users & Permissions', path: '/users', icon: Fingerprint }, { name: 'Audit Logs', path: '/audit', icon: Activity }, { name: 'Notifications', path: '/notifications', icon: Bell }, { name: 'Settings', path: '/settings', icon: Settings }] },
]
function AppShell() {
  const auth = useAuth()
  const authUserId = auth.user?.id
  const [dark, setDark] = useState(() => localStorage.getItem('golden-baobab-hr-theme') === 'dark')
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [companies, setCompanies] = useState<Company[]>([])
  const [companiesOwnerId, setCompaniesOwnerId] = useState<string | null>(null)
  const companiesLoading = isLiveMode && auth.user?.id !== companiesOwnerId
  const [workspaceError, setWorkspaceError] = useState('')
  const [activeCompanyId, setActiveCompanyId] = useState('all')
  const [workspacePreferences, setWorkspacePreferences] = useState<{ companyId: string; value: WorkspacePreferences } | null>(null)
  const [unreadNotifications, setUnreadNotifications] = useState(0)
  const [authActionError, setAuthActionError] = useState('')
  const location = useLocation()
  const currentName = nav.flatMap((section) => section.items).find((item) => item.path === location.pathname)?.name ?? 'Dashboard'
  const currentCompany = companies.find((company) => company.id === activeCompanyId)
  const workspaceName = activeCompanyId === 'all' ? 'All companies' : currentCompany?.name ?? 'Company workspace'
  const profileName = typeof auth.user?.user_metadata?.full_name === 'string' ? auth.user.user_metadata.full_name : auth.user?.email ?? 'Signed-in account'
  const initials = (value: string) => value.split(/[@\s.]+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'GB'
  useEffect(() => { document.documentElement.classList.toggle('dark', dark); localStorage.setItem('golden-baobab-hr-theme', dark ? 'dark' : 'light') }, [dark])
  useEffect(() => {
    if (!authUserId || activeCompanyId === 'all') { setWorkspacePreferences(null); return }
    let cancelled = false
    createLiveOperationsServices(getSupabaseClient()).settings.get(activeCompanyId)
      .then((row) => { if (!cancelled) setWorkspacePreferences({ companyId: activeCompanyId, value: row ? { timezone: row.timezone, date_format: row.date_format, currency_code: row.currency_code, payroll_cutoff_day: row.payroll_cutoff_day } : defaultWorkspacePreferences }) })
      .catch(() => { if (!cancelled) setWorkspacePreferences(null) })
    return () => { cancelled = true }
  }, [activeCompanyId, authUserId])
  useEffect(() => {
    if (!authUserId) { setUnreadNotifications(0); return }
    let cancelled = false
    const loadUnread = async () => {
      try {
        const count = await createLiveOperationsServices(getSupabaseClient()).notifications.unreadCount()
        if (!cancelled) setUnreadNotifications(count)
      } catch { if (!cancelled) setUnreadNotifications(0) }
    }
    void loadUnread()
    window.addEventListener('gbhr-notifications-changed', loadUnread)
    const interval = window.setInterval(() => void loadUnread(), 60_000)
    return () => { cancelled = true; window.clearInterval(interval); window.removeEventListener('gbhr-notifications-changed', loadUnread) }
  }, [authUserId, location.pathname])
  useEffect(() => { setMobileOpen(false) }, [location.pathname])
  useEffect(() => {
    if (!authUserId) return
    let cancelled = false
    createLiveCompanyServices(getSupabaseClient(), authUserId).list()
      .then((items) => { if (!cancelled) { setCompanies(items); setActiveCompanyId((current) => items.some((item) => item.id === current) ? current : 'all'); setWorkspaceError('') } })
      .catch(() => { if (!cancelled) setWorkspaceError('Company data could not be loaded. Check your access or try again.') })
      .finally(() => { if (!cancelled) setCompaniesOwnerId(authUserId) })
    return () => { cancelled = true }
  }, [authUserId])
  const data = useMemo(() => ({
    companies, loading: companiesLoading, error: workspaceError, live: true,
    saveCompany: async (company: Company) => {
      setWorkspaceError('')
      const previous = companies.find((item) => item.id === company.id)
      try {
        const saved = await createLiveCompanyServices(getSupabaseClient(), authUserId ?? '').save(company, previous)
        setCompanies((items) => items.some((item) => item.id === saved.id) ? items.map((item) => item.id === saved.id ? saved : item) : [saved, ...items])
        return saved
      } catch {
        setWorkspaceError('Company changes were not fully saved. Review your access and reload before retrying.')
        throw new Error('Company changes were not saved.')
      }
    },
    deleteCompany: async (id: string) => {
      await createLiveCompanyServices(getSupabaseClient(), authUserId ?? '').deactivate(id)
      setCompanies((items) => items.map((item) => item.id === id ? { ...item, status: 'Inactive' } : item))
      if (activeCompanyId === id) setActiveCompanyId('all')
    },
    setActiveCompany: setActiveCompanyId, activeCompanyId,
    preferences: workspacePreferences?.companyId === activeCompanyId ? workspacePreferences.value : null,
    setPreferences: (companyId: string, preferences: WorkspacePreferences) => setWorkspacePreferences({ companyId, value: preferences }),
  }), [companies, companiesLoading, workspaceError, authUserId, activeCompanyId, workspacePreferences])
  const authGate = getAuthGateDecision({ live: isLiveMode, loading: auth.loading, authenticated: auth.isAuthenticated, recoveryRequired: auth.recoveryRequired, pathname: location.pathname })
  if (authGate === 'loading') return <main className="auth-prototype" aria-live="polite"><div className="route-loading"><span className="route-loading-mark">GB</span><span>Securing your sessionâ€¦</span></div></main>
  if (authGate === 'recovery') return <Navigate to="/auth/reset" replace />
  if (authGate === 'login') return <Navigate to="/auth/login" replace />
  if (location.pathname.startsWith('/auth/')) return <Suspense fallback={<div className="route-loading">Opening sign-in…</div>}><Routes><Route path="/auth/:screen" element={<AuthPrototype/>}/></Routes></Suspense>
  return <WorkspaceContext.Provider value={data}><div className={`app-shell ${collapsed ? 'is-collapsed' : ''}`}>    {mobileOpen && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
    <aside className={`sidebar ${mobileOpen ? 'mobile-open' : ''}`}>
      <div className="brand"><div className="brand-mark" aria-hidden="true"><span>GB</span></div><span className="brand-word">Golden Baobab <span>HR</span></span><button className="icon-button mobile-close" onClick={() => setMobileOpen(false)} aria-label="Close menu"><X size={18} /></button></div>
      <div className="workspace-selector"><div className="workspace-avatar">{isLiveMode ? initials(workspaceName) : 'MH'}</div><div className="workspace-copy"><strong>{workspaceName}</strong><span>{isLiveMode ? 'Company workspace' : 'Enterprise workspace'}</span></div><ChevronDown size={15} /></div>
      <nav className="side-nav">{nav.map((section) => <div className="nav-section" key={section.label}><div className="nav-label">{section.label}</div>{section.items.map(({ name, path, icon: Icon }) => <NavLink key={path} to={path} end={path === '/'} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} title={collapsed ? name : undefined}><Icon size={17} strokeWidth={1.8} /><span>{name}</span>{name === 'Notifications' && unreadNotifications > 0 && <span className="nav-count">{unreadNotifications > 99 ? '99+' : unreadNotifications}</span>}</NavLink>)}</div>)}</nav>
      <div className="sidebar-bottom">{!isLiveMode && <div className="help-card"><div className="help-icon"><CircleHelp size={16} /></div><div><strong>Need a hand?</strong><span>Visit our help centre</span></div><ChevronRight size={15} /></div>}<div className="profile-row"><div className="profile-avatar">{isLiveMode ? initials(profileName) : 'CM'}</div><div className="profile-copy"><strong>{profileName}</strong><span>{isLiveMode ? 'Signed-in account' : 'Workspace admin'}</span></div>{!isLiveMode && <MoreHorizontal size={18} />}</div></div>
      <button className="collapse-button" onClick={() => setCollapsed(!collapsed)} aria-label="Collapse sidebar"><ChevronLeft size={15} /></button>
    </aside>
    <div className="main-column"><header className="topbar"><div className="top-left"><button className="icon-button mobile-menu" onClick={() => setMobileOpen(true)} aria-label="Open menu"><Menu size={20} /></button><div className="breadcrumb"><span>Workspace</span><ChevronRight size={14} /><strong>{currentName}</strong></div></div><div className="top-actions"><label className="company-switch"><Building2 size={15} /><select value={activeCompanyId} onChange={(event) => setActiveCompanyId(event.target.value)} aria-label="Select company"><option value="all">All companies</option>{companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select><ChevronDown size={14} /></label><button className="icon-button theme-toggle" onClick={() => setDark(!dark)} aria-label={`Switch to ${dark ? 'light' : 'dark'} theme`}>{dark ? <Sun size={17} /> : <Moon size={17} />}</button><button className="icon-button search-trigger" aria-label="Search"><Search size={17} /><kbd>âŒ˜ K</kbd></button><Link className="icon-button notification-button" to="/notifications" aria-label={unreadNotifications ? `Notifications, ${unreadNotifications} unread` : 'Notifications'}><Bell size={17} />{unreadNotifications > 0 && <span className="notification-badge" aria-hidden="true">{unreadNotifications > 99 ? '99+' : unreadNotifications}</span>}</Link>{isLiveMode && <button className="auth-signout" onClick={async () => { setAuthActionError(''); try { await auth.signOut() } catch { setAuthActionError('We could not sign you out. Please try again.') } }}>Sign out</button>}<div className="top-avatar" title={isLiveMode ? auth.user?.email ?? '' : 'Chola Mwansa'}>{isLiveMode ? (auth.user?.email?.slice(0, 2).toUpperCase() ?? 'HR') : 'CM'}</div></div></header>
      {authActionError && <div className="auth-shell-error" role="alert">{authActionError}</div>}{workspaceError && <div className="auth-shell-error" role="alert">{workspaceError}</div>}
      <main className="page-content"><Suspense fallback={<div className="route-loading"><span className="route-loading-mark">GB</span><span>Opening workspaceâ€¦</span></div>}><Routes>
          <Route path="/" element={<LiveDashboard companies={companies} loading={companiesLoading} />} />
          <Route path="/companies" element={<CompanyDirectory />} />
          <Route path="/companies/new" element={<CompanyForm mode="create" />} />
          <Route path="/companies/:companyId/edit" element={<CompanyForm mode="edit" />} />
          <Route path="/companies/:companyId" element={<CompanyProfile />} />
          <Route path="/branches" element={<BranchManagement />} />
          <Route path="/employees" element={<LiveEmployeeDirectory />} />
          <Route path="/employee-approvals" element={<LiveEmployeeApprovals />} />
          <Route path="/employees/new" element={<LiveEmployeeForm />} />
          <Route path="/employees/import" element={<LiveEmployeeImport />} />
          <Route path="/employees/:employeeId/correct" element={<LiveEmployeeForm />} />
          <Route path="/employees/:employeeId" element={<LiveEmployeeProfile />} />
          <Route path="/attendance" element={<LiveAttendance />} />
          <Route path="/leave" element={<LiveLeave />} />
          <Route path="/departments" element={<LiveHrCatalog type="departments" />} />
          <Route path="/job-roles" element={<LiveHrCatalog type="jobRoles" />} />
          <Route path="/payroll" element={<LivePayrollInputs />} />
          <Route path="/payslips" element={<LivePayslips />} />
          <Route path="/reconciliation" element={<LivePayrollReconciliation />} />
          <Route path="/deductions" element={<LiveDeductions />} />
          <Route path="/statutory" element={<LiveStatutoryFilings />} />
          <Route path="/reports" element={<LivePayrollReports />} />
          <Route path="/users" element={<LiveUserAdmin />} />
          <Route path="/audit" element={<LiveAuditLogs />} />
          <Route path="/notifications" element={<LiveNotifications />} />
          <Route path="/settings" element={<LiveSettings />} />
          <Route path="*" element={<LiveDashboard companies={companies} loading={companiesLoading} />} />
        </Routes></Suspense></main>
      <footer className="app-footer"><span>Â© 2026 Golden Baobab HR</span><span>Built for the way Zambia works <span className="footer-sun">âœ³</span></span><span>People and payroll workspace</span></footer>
    </div>
  </div></WorkspaceContext.Provider>
}
function LiveDashboard({ companies, loading }: { companies: Company[]; loading: boolean }) {
  const { activeCompanyId } = useWorkspace()
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null)
  const [metricsLoading, setMetricsLoading] = useState(false)
  const [metricsError, setMetricsError] = useState('')
  const selectedCompany = activeCompanyId === 'all' ? null : companies.find((company) => company.id === activeCompanyId) ?? null
  const scopeCompanies = selectedCompany ? [selectedCompany] : companies
  const branchIds = selectedCompany ? selectedCompany.branches.filter((branch) => branch.status === 'Active').map((branch) => branch.id) : []
  useEffect(() => {
    if (loading || !companies.length) { setMetrics(null); return }
    let cancelled = false
    setMetricsLoading(true); setMetricsError('')
    void loadDashboardMetrics(getSupabaseClient(), scopeCompanies.map((company) => company.id), branchIds)
      .then((value) => { if (!cancelled) setMetrics(value) })
      .catch(() => { if (!cancelled) { setMetrics(null); setMetricsError('Couldn’t load the company overview. Check your access and try again.') } })
      .finally(() => { if (!cancelled) setMetricsLoading(false) })
    return () => { cancelled = true }
  }, [loading, activeCompanyId, companies])
  const money = metrics?.finalizedPayrollTotal == null ? 'Restricted' : `K${metrics.finalizedPayrollTotal.toLocaleString('en-ZM', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  return <>
    <section className="welcome-row"><div><div className="eyebrow"><span className="eyebrow-line" /> Workforce</div><h1>Company Overview</h1><p>Manage your workforce, payroll and HR operations in one place.</p></div><div className="welcome-actions"><Link className="button-primary" to="/companies/new"><Building2 size={15}/> Add company</Link></div></section>
    {loading ? <div className="panel empty-state" role="status">Loading your companies…</div> : companies.length === 0 ? <div className="panel empty-state"><h2>No company access yet</h2><p>Ask your portfolio administrator to grant access to a company.</p></div> : metricsError ? <div className="auth-shell-error" role="alert">{metricsError}</div> : metricsLoading || !metrics ? <div className="panel empty-state" role="status">Loading company overview…</div> : <section className="metrics-grid">
      <Metric icon={<Building2 />} tone="teal" label="Total companies" value={String(scopeCompanies.length)} note={selectedCompany?.name ?? 'All selected companies'} />
      <Metric icon={<Users />} tone="blue" label="Employees" value={String(metrics.employees)} note={`${metrics.activeEmployees} active employees`} />
      <Metric icon={<Wallet />} tone="amber" label="Finalized payroll" value={money} note={metrics.finalizedPayrollTotal == null ? 'Available with payroll access' : 'Net pay in finalized runs'} />
      <Metric icon={<CalendarDays />} tone="rose" label="Pending approvals" value={String(metrics.pendingApprovals)} note={`${metrics.pendingLeave} leave requests awaiting review`} />
    </section>}
    {metrics && !metricsLoading && metrics.employees === 0 && !metricsError && <div className="panel empty-state"><h2>Start with your employee directory</h2><p>Your company overview will fill in as you add employees and complete HR workflows.</p><Link className="button-primary" to="/employees/new"><Users size={15}/> Add employee</Link></div>}
  </>
}

function Metric({ icon, tone, label, value, note }: { icon: React.ReactNode; tone: string; label: string; value: string; note: string }) { return <article className="metric-card"><div className="metric-top"><div className={`metric-icon ${tone}`}>{icon}</div></div><div className="metric-label">{label}</div><div className="metric-value">{value}</div><div className="metric-bottom"><span>{note}</span></div></article> }

function App() { return <BrowserRouter><AuthProvider><AppShell /></AuthProvider></BrowserRouter> }
export default App
