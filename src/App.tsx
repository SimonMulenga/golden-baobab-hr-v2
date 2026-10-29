import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { BrowserRouter, Link, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Activity, ArrowUpRight, Bell, Building2, CalendarDays, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, Clock3, FileBarChart2, FileText, Fingerprint, LayoutDashboard, Menu, Moon, MoreHorizontal, Search, Settings, ShieldCheck, Sun, Users, Wallet, X } from 'lucide-react'
import { Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { WorkspaceContext, defaultWorkspacePreferences, useWorkspace, type WorkspacePreferences } from './features/companies/WorkspaceContext'
import { EmployeeContext } from './features/employees/EmployeeContext'
import { PayrollContext } from './features/payroll/PayrollContext'
import type { DemoDeduction, DemoPayrollRun } from './features/payroll/PayrollContext'
import { AuthProvider } from './features/auth/AuthContext'
import { useAuth } from './features/auth/auth-context'
import { getAuthGateDecision } from './features/auth/auth-routing'
import { isLiveMode } from './lib/data-mode'
import { getSupabaseClient } from './lib/supabase/client'
import { createLiveCompanyServices } from './services/live-company-services'
import { createLiveOperationsServices } from './services/live-operations-services'
import { loadDashboardMetrics, type DashboardMetrics } from './services/live-dashboard-services'
import { mockEmployees } from './features/employees/mockData'
import { mockCompanies } from './features/companies/mockData'
import type { Company } from './features/companies/types'
import type { Employee } from './features/employees/types'
const { CompanyDirectory, CompanyForm, CompanyProfile, BranchManagement } = { CompanyDirectory: lazy(() => import('./features/companies/CompanyScreens').then((module) => ({ default: module.CompanyDirectory }))), CompanyForm: lazy(() => import('./features/companies/CompanyScreens').then((module) => ({ default: module.CompanyForm }))), CompanyProfile: lazy(() => import('./features/companies/CompanyScreens').then((module) => ({ default: module.CompanyProfile }))), BranchManagement: lazy(() => import('./features/companies/CompanyScreens').then((module) => ({ default: module.BranchManagement }))) }
const EmployeeDirectory = lazy(() => import('./features/employees/EmployeeScreens').then((module) => ({ default: module.EmployeeDirectory })))
const EmployeeForm = lazy(() => import('./features/employees/EmployeeScreens').then((module) => ({ default: module.EmployeeForm })))
const EmployeeImport = lazy(() => import('./features/employees/EmployeeImport').then((module) => ({ default: module.EmployeeImport })))
const EmployeeProfile = lazy(() => import('./features/employees/EmployeeScreens').then((module) => ({ default: module.EmployeeProfile })))
const EmployeeApprovals = lazy(() => import('./features/employees/EmployeeApprovals').then((module) => ({ default: module.EmployeeApprovals })))
const LiveEmployeeDirectory = lazy(() => import('./features/employees/LiveEmployeeScreens').then((module) => ({ default: module.LiveEmployeeDirectory })))
const LiveEmployeeApprovals = lazy(() => import('./features/employees/LiveEmployeeScreens').then((module) => ({ default: module.LiveEmployeeApprovals })))
const LiveEmployeeForm = lazy(() => import('./features/employees/LiveEmployeeScreens').then((module) => ({ default: module.LiveEmployeeForm })))
const LiveEmployeeProfile = lazy(() => import('./features/employees/LiveEmployeeScreens').then((module) => ({ default: module.LiveEmployeeProfile })))
const LiveEmployeeImport = lazy(() => import('./features/employees/LiveEmployeeImport').then((module) => ({ default: module.LiveEmployeeImport })))
const AttendanceScreen = lazy(() => import('./features/people-ops/PeopleOpsScreens').then((module) => ({ default: module.AttendanceScreen })))
const LeaveScreen = lazy(() => import('./features/people-ops/PeopleOpsScreens').then((module) => ({ default: module.LeaveScreen })))
const LiveAttendance = lazy(() => import('./features/people-ops/LiveAttendance').then((module) => ({ default: module.LiveAttendance })))
const LiveLeave = lazy(() => import('./features/people-ops/LiveLeave').then((module) => ({ default: module.LiveLeave })))
const LivePayrollInputs = lazy(() => import('./features/payroll/LivePayrollInputs').then((module) => ({ default: module.LivePayrollInputs })))
const LivePayrollReconciliation = lazy(() => import('./features/payroll/LivePayrollReconciliation').then((module) => ({ default: module.LivePayrollReconciliation })))
const LivePayslips = lazy(() => import('./features/payroll/LivePayslips').then((module) => ({ default: module.LivePayslips })))
const LivePayrollReports = lazy(() => import('./features/payroll/LivePayrollReports').then((module) => ({ default: module.LivePayrollReports })))
const LiveStatutoryFilings = lazy(() => import('./features/payroll/LiveStatutoryFilings').then((module) => ({ default: module.LiveStatutoryFilings })))
const CatalogScreen = lazy(() => import('./features/admin/CatalogScreens').then((module) => ({ default: module.CatalogScreen })))
const PayrollScreen = lazy(() => import('./features/payroll/IntegratedPayrollScreen').then((module) => ({ default: module.IntegratedPayrollScreen })))
const EmployeeDeductions = lazy(() => import('./features/payroll/EmployeeDeductions').then((module) => ({ default: module.EmployeeDeductions })))
const LiveDeductions = lazy(() => import('./features/payroll/LiveDeductions').then((module) => ({ default: module.LiveDeductions })))
const StatutoryScreen = lazy(() => import('./features/payroll/PayrollScreens').then((module) => ({ default: module.StatutoryScreen })))
const UsersScreen = lazy(() => import('./features/admin/AdminScreens').then((module) => ({ default: module.UsersScreen })))
const LiveUserAdmin = lazy(() => import('./features/admin/LiveUserAdmin').then((module) => ({ default: module.LiveUserAdmin })))
const LiveAuditLogs = lazy(() => import('./features/admin/LiveAuditLogs').then((module) => ({ default: module.LiveAuditLogs })))
const LiveHrCatalog = lazy(() => import('./features/admin/LiveHrCatalog').then((module) => ({ default: module.LiveHrCatalog })))
const LiveNotifications = lazy(() => import('./features/admin/LiveOperations').then((module) => ({ default: module.LiveNotifications })))
const LiveSettings = lazy(() => import('./features/admin/LiveOperations').then((module) => ({ default: module.LiveSettings })))
const ReportsScreen = lazy(() => import('./features/admin/AdminScreens').then((module) => ({ default: module.ReportsScreen })))
const AuditScreen = lazy(() => import('./features/admin/AdminScreens').then((module) => ({ default: module.AuditScreen })))
const NotificationsScreen = lazy(() => import('./features/admin/AdminScreens').then((module) => ({ default: module.NotificationsScreen })))
const SettingsScreen = lazy(() => import('./features/admin/AdminScreens').then((module) => ({ default: module.SettingsScreen })))
const AuthPrototype = lazy(() => import('./features/auth/AuthPrototype').then((module) => ({ default: module.AuthPrototype })))
import './index.css'
import './client-ui.css'

const nav = [
  { label: 'OVERVIEW', items: [{ name: 'Dashboard', path: '/', icon: LayoutDashboard }] },
  { label: 'PEOPLE & OPERATIONS', items: [{ name: 'Companies', path: '/companies', icon: Building2 }, { name: 'Branches', path: '/branches', icon: Building2 }, { name: 'Employees', path: '/employees', icon: Users }, { name: 'Employee Approvals', path: '/employee-approvals', icon: ShieldCheck }, { name: 'Departments', path: '/departments', icon: Building2 }, { name: 'Attendance', path: '/attendance', icon: Clock3 }, { name: 'Leave Management', path: '/leave', icon: CalendarDays }] },
  { label: 'PAYROLL & INSIGHTS', items: [{ name: 'Payroll', path: '/payroll', icon: Wallet }, { name: 'Payslips', path: '/payslips', icon: FileText }, { name: 'Payout Reconciliation', path: '/reconciliation', icon: CircleHelp }, { name: 'Deductions & Advances', path: '/deductions', icon: Wallet }, { name: 'Statutory Deductions', path: '/statutory', icon: ShieldCheck }, { name: 'Reports', path: '/reports', icon: FileBarChart2 }] },
  { label: 'ADMINISTRATION', items: [{ name: 'Users & Permissions', path: '/users', icon: Fingerprint }, { name: 'Audit Logs', path: '/audit', icon: Activity }, { name: 'Notifications', path: '/notifications', icon: Bell }, { name: 'Settings', path: '/settings', icon: Settings }] },
]
const employees = [{ name: 'Copperbelt Mining Co.', count: 284, color: '#208779' }, { name: 'Lusaka Foods Ltd.', count: 196, color: '#85b8a9' }, { name: 'Zambezi Logistics', count: 142, color: '#d6a85d' }, { name: 'Other companies', count: 216, color: '#d8e4df' }]
const payroll = [{ month: 'May', value: 2.74 }, { month: 'Jun', value: 2.81 }, { month: 'Jul', value: 2.76 }, { month: 'Aug', value: 2.98 }, { month: 'Sep', value: 3.05 }, { month: 'Oct', value: 3.18 }]
const activities = [
  { initials: 'MK', color: 'mint', title: 'New employee onboarded', detail: 'Mwamba Kunda Â· Copperbelt Mining', time: '12 min ago' },
  { initials: 'PN', color: 'peach', title: 'Leave request submitted', detail: 'Precious Nasilele Â· 5 days', time: '48 min ago' },
  { initials: 'TP', color: 'blue', title: 'Payroll draft prepared', detail: 'September 2026 Â· Lusaka Foods', time: '2 hours ago' },
  { initials: 'JM', color: 'lilac', title: 'Employee details updated', detail: 'Joseph Mumba Â· Zambezi Logistics', time: 'Yesterday' },
]
const routeContent: Record<string, { eyebrow: string; description: string; stat: string; statLabel: string; rows: { name: string; detail: string; badge: string }[] }> = {
  Attendance: { eyebrow: 'TIME & ATTENDANCE', description: 'A daily pulse on attendance across every location.', stat: '94.8%', statLabel: 'Present today', rows: [{ name: 'Copperbelt Mining Co.', detail: 'Kitwe Â· 269 of 284 present', badge: 'On track' }, { name: 'Lusaka Foods Ltd.', detail: 'Lusaka Â· 184 of 196 present', badge: '12 away' }, { name: 'Zambezi Logistics', detail: 'Ndola Â· 136 of 142 present', badge: 'On track' }] },
  'Leave Management': { eyebrow: 'TIME AWAY', description: 'Review leave requests and plan coverage across your teams.', stat: '12', statLabel: 'Pending requests', rows: [{ name: 'Precious Nasilele', detail: 'Annual leave Â· 5 days Â· 4â€“8 Nov', badge: 'Needs review' }, { name: 'Chileshe Banda', detail: 'Sick leave Â· 2 days Â· 27â€“28 Oct', badge: 'Needs review' }, { name: 'Mwamba Phiri', detail: 'Annual leave Â· 3 days Â· 3â€“5 Nov', badge: 'Needs review' }] },
  Payroll: { eyebrow: 'PAYROLL OVERVIEW', description: 'Stay ahead of each pay cycle across your companies.', stat: 'K 3.18m', statLabel: 'October estimate', rows: [{ name: 'September 2026', detail: 'All companies Â· 838 employees', badge: 'Paid' }, { name: 'October 2026', detail: 'All companies Â· Draft preview', badge: 'In progress' }, { name: 'November 2026', detail: 'Next scheduled cycle', badge: 'Starts 16 Nov' }] },
  'Statutory Deductions': { eyebrow: 'COMPLIANCE OVERVIEW', description: 'A single place to review your statutory deduction obligations.', stat: '3', statLabel: 'Deduction types', rows: [{ name: 'NAPSA', detail: 'National Pension Scheme Authority', badge: 'Configured' }, { name: 'PAYE', detail: 'Pay As You Earn Â· ZRA', badge: 'Configured' }, { name: 'NHIMA', detail: 'National Health Insurance Management Authority', badge: 'Configured' }] },
  Reports: { eyebrow: 'BUSINESS INTELLIGENCE', description: 'Useful summaries for your people and payroll decisions.', stat: '8', statLabel: 'Ready to explore', rows: [{ name: 'Headcount by company', detail: 'People Â· Updated today', badge: 'People' }, { name: 'Monthly payroll summary', detail: 'Payroll Â· September 2026', badge: 'Payroll' }, { name: 'Leave balance overview', detail: 'Time away Â· Updated today', badge: 'People' }] },
  'Users & Permissions': { eyebrow: 'WORKSPACE ACCESS', description: 'See who has access to your Golden Baobab HR workspace.', stat: '12', statLabel: 'Workspace users', rows: [{ name: 'Chola Mwansa', detail: 'Workspace administrator', badge: 'Admin' }, { name: 'Ruth Zulu', detail: 'People manager Â· 2 companies', badge: 'Manager' }, { name: 'Peter Musonda', detail: 'Payroll specialist Â· 3 companies', badge: 'Payroll' }] },
  'Audit Logs': { eyebrow: 'WORKSPACE HISTORY', description: 'A transparent timeline of activity across your workspace.', stat: '246', statLabel: 'Events this month', rows: [{ name: 'Company profile updated', detail: 'Chola Mwansa Â· Copperbelt Mining Co.', badge: 'Today Â· 09:42' }, { name: 'Leave request reviewed', detail: 'Ruth Zulu Â· Precious Nasilele', badge: 'Today Â· 08:17' }, { name: 'Payroll draft created', detail: 'Peter Musonda Â· October cycle', badge: 'Yesterday' }] },
  Settings: { eyebrow: 'MAKE IT YOURS', description: 'Workspace preferences, localization, and company defaults.', stat: 'Africa/Lusaka', statLabel: 'Workspace time zone', rows: [{ name: 'Workspace profile', detail: 'Name, logo, and contact information', badge: 'Workspace' }, { name: 'Localization', detail: 'Zambian Kwacha Â· English (UK)', badge: 'Regional' }, { name: 'Payroll preferences', detail: 'Pay dates and default settings', badge: 'Payroll' }] },
}

function AppShell() {
  const auth = useAuth()
  const authUserId = auth.user?.id
  const [dark, setDark] = useState(() => localStorage.getItem('golden-baobab-hr-theme') === 'dark')
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [companies, setCompanies] = useState<Company[]>(() => { if (isLiveMode) return []; try { const saved = localStorage.getItem('gbhr-companies'); return saved ? JSON.parse(saved) as Company[] : mockCompanies } catch { return mockCompanies } })
  const [employees, setEmployees] = useState<Employee[]>(() => { if (isLiveMode) return []; try { const saved = localStorage.getItem('gbhr-employees'); return saved ? JSON.parse(saved) as Employee[] : mockEmployees } catch { return mockEmployees } })
  const [companiesOwnerId, setCompaniesOwnerId] = useState<string | null>(null)
  const companiesLoading = isLiveMode && auth.user?.id !== companiesOwnerId
  const [workspaceError, setWorkspaceError] = useState('')
  const [deductions, setDeductions] = useState<DemoDeduction[]>([])
  const [payrollRuns, setPayrollRuns] = useState<DemoPayrollRun[]>([])
  const [activeCompanyId, setActiveCompanyId] = useState(() => isLiveMode ? 'all' : localStorage.getItem('gbhr-active-company') ?? 'all')
  const [workspacePreferences, setWorkspacePreferences] = useState<{ companyId: string; value: WorkspacePreferences } | null>(null)
  const [unreadNotifications, setUnreadNotifications] = useState(0)
  const [authActionError, setAuthActionError] = useState('')
  const location = useLocation()
  const currentName = nav.flatMap((section) => section.items).find((item) => item.path === location.pathname)?.name ?? 'Dashboard'
  const currentCompany = companies.find((company) => company.id === activeCompanyId)
  const workspaceName = isLiveMode ? (activeCompanyId === 'all' ? 'All companies' : currentCompany?.name ?? 'Company workspace') : 'Mukuba Holdings'
  const profileName = isLiveMode
    ? (typeof auth.user?.user_metadata?.full_name === 'string' ? auth.user.user_metadata.full_name : auth.user?.email ?? 'Signed-in account')
    : 'Chola Mwansa'
  const initials = (value: string) => value.split(/[@\s.]+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'GB'
  useEffect(() => { document.documentElement.classList.toggle('dark', dark); localStorage.setItem('golden-baobab-hr-theme', dark ? 'dark' : 'light') }, [dark])
  useEffect(() => { if (!isLiveMode) localStorage.setItem('gbhr-companies', JSON.stringify(companies)) }, [companies])
  useEffect(() => { if (!isLiveMode) localStorage.setItem('gbhr-employees', JSON.stringify(employees)) }, [employees])
  useEffect(() => { if (!isLiveMode) localStorage.setItem('gbhr-active-company', activeCompanyId) }, [activeCompanyId])
  useEffect(() => {
    if (!isLiveMode || !authUserId || activeCompanyId === 'all') { setWorkspacePreferences(null); return }
    let cancelled = false
    createLiveOperationsServices(getSupabaseClient()).settings.get(activeCompanyId)
      .then((row) => { if (!cancelled) setWorkspacePreferences({ companyId: activeCompanyId, value: row ? { timezone: row.timezone, date_format: row.date_format, currency_code: row.currency_code, payroll_cutoff_day: row.payroll_cutoff_day } : defaultWorkspacePreferences }) })
      .catch(() => { if (!cancelled) setWorkspacePreferences(null) })
    return () => { cancelled = true }
  }, [activeCompanyId, authUserId])
  useEffect(() => {
    if (!isLiveMode || !authUserId) { setUnreadNotifications(0); return }
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
    if (!isLiveMode || !authUserId) return
    let cancelled = false
    createLiveCompanyServices(getSupabaseClient(), authUserId).list()
      .then((items) => { if (!cancelled) { setCompanies(items); setActiveCompanyId((current) => items.some((item) => item.id === current) ? current : 'all'); setWorkspaceError('') } })
      .catch(() => { if (!cancelled) setWorkspaceError('Company data could not be loaded. Check your access or try again.') })
      .finally(() => { if (!cancelled) setCompaniesOwnerId(authUserId) })
    return () => { cancelled = true }
  }, [authUserId])
  const data = useMemo(() => ({
    companies, loading: companiesLoading, error: workspaceError, live: isLiveMode,
    saveCompany: async (company: Company) => {
      if (isLiveMode) {
        setWorkspaceError('')
        const previous = companies.find((item) => item.id === company.id)
        try {
          const saved = await createLiveCompanyServices(getSupabaseClient(), authUserId ?? '').save(company, previous)
          setCompanies((items) => items.some((item) => item.id === saved.id) ? items.map((item) => item.id === saved.id ? saved : item) : [saved, ...items])
          return saved
        } catch (error) {
          setWorkspaceError('Company changes were not fully saved. Review your access and reload before retrying.')
          throw error
        }
      }
      setCompanies((items) => items.some((item) => item.id === company.id) ? items.map((item) => item.id === company.id ? company : item) : [company, ...items])
      return company
    },
    deleteCompany: async (id: string) => {
      if (isLiveMode) {
        await createLiveCompanyServices(getSupabaseClient(), authUserId ?? '').deactivate(id)
        setCompanies((items) => items.map((item) => item.id === id ? { ...item, status: 'Inactive' } : item))
      } else setCompanies((items) => items.filter((item) => item.id !== id))
      if (activeCompanyId === id) setActiveCompanyId('all')
    },
    setActiveCompany: setActiveCompanyId, activeCompanyId,
    preferences: workspacePreferences?.companyId === activeCompanyId ? workspacePreferences.value : null,
    setPreferences: (companyId: string, preferences: WorkspacePreferences) => setWorkspacePreferences({ companyId, value: preferences }),
  }), [companies, companiesLoading, workspaceError, authUserId, activeCompanyId, workspacePreferences])
  const employeeData = useMemo(() => ({ employees, saveEmployee: (employee: Employee) => setEmployees((items) => items.some((item) => item.id === employee.id) ? items.map((item) => item.id === employee.id ? employee : item) : [employee, ...items]), saveEmployees: (records: Employee[]) => setEmployees((items) => [...records, ...items]) }), [employees])
  const payrollData = useMemo(() => ({
    deductions,
    runs: payrollRuns,
    saveDeduction: (record: DemoDeduction) => setDeductions((items) => items.some((item) => item.id === record.id) ? items.map((item) => item.id === record.id ? record : item) : [record, ...items]),
    saveRun: (run: DemoPayrollRun) => setPayrollRuns((items) => items.some((item) => item.id === run.id) ? items.map((item) => item.id === run.id ? run : item) : [run, ...items]),
    finalizeRun: (runId: string) => {
      const run = payrollRuns.find((item) => item.id === runId)
      if (!run || run.status !== 'APPROVED') return
      const finalizedAt = new Date().toISOString()
      setPayrollRuns((items) => items.map((item) => item.id === runId && item.status === 'APPROVED' ? { ...item, status: 'FINALIZED', events: [...item.events, { type: 'FINALIZED', at: finalizedAt }] } : item))
      setDeductions((items) => items.map((item) => {
        if (item.status !== 'ACTIVE' || !run.postedDeductionIds.includes(item.id) || item.postedRunIds.includes(runId)) return item
        const installment = item.schedule.find((part) => part.periodStart === run.period)
        if (!installment) return item
        const applied = Math.min(installment.amountCents, item.balanceCents)
        const balanceCents = item.balanceCents - applied
        return { ...item, balanceCents, postedRunIds: [...item.postedRunIds, runId], status: balanceCents === 0 ? 'COMPLETED' : item.status }
      }))
    },
  }), [deductions, payrollRuns])
  const authGate = getAuthGateDecision({ live: isLiveMode, loading: auth.loading, authenticated: auth.isAuthenticated, recoveryRequired: auth.recoveryRequired, pathname: location.pathname })
  if (authGate === 'loading') return <main className="auth-prototype" aria-live="polite"><div className="route-loading"><span className="route-loading-mark">GB</span><span>Securing your sessionâ€¦</span></div></main>
  if (authGate === 'recovery') return <Navigate to="/auth/reset" replace />
  if (authGate === 'login') return <Navigate to="/auth/login" replace />
  if (location.pathname.startsWith('/auth/')) return <EmployeeContext.Provider value={employeeData}><Suspense fallback={<div className="route-loading">Opening prototypeâ€¦</div>}><Routes><Route path="/auth/:screen" element={<AuthPrototype/>}/></Routes></Suspense></EmployeeContext.Provider>
  return <WorkspaceContext.Provider value={data}><EmployeeContext.Provider value={employeeData}><PayrollContext.Provider value={payrollData}><div className={`app-shell ${collapsed ? 'is-collapsed' : ''}`}>
    {mobileOpen && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
    <aside className={`sidebar ${mobileOpen ? 'mobile-open' : ''}`}>
      <div className="brand"><div className="brand-mark" aria-hidden="true"><span>GB</span></div><span className="brand-word">Golden Baobab <span>HR</span></span><button className="icon-button mobile-close" onClick={() => setMobileOpen(false)} aria-label="Close menu"><X size={18} /></button></div>
      <div className="workspace-selector"><div className="workspace-avatar">{isLiveMode ? initials(workspaceName) : 'MH'}</div><div className="workspace-copy"><strong>{workspaceName}</strong><span>{isLiveMode ? 'Company workspace' : 'Enterprise workspace'}</span></div><ChevronDown size={15} /></div>
      <nav className="side-nav">{nav.map((section) => <div className="nav-section" key={section.label}><div className="nav-label">{section.label}</div>{section.items.map(({ name, path, icon: Icon }) => <NavLink key={path} to={path} end={path === '/'} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} title={collapsed ? name : undefined}><Icon size={17} strokeWidth={1.8} /><span>{name}</span>{name === 'Notifications' && unreadNotifications > 0 && <span className="nav-count">{unreadNotifications > 99 ? '99+' : unreadNotifications}</span>}</NavLink>)}</div>)}</nav>
      <div className="sidebar-bottom">{!isLiveMode && <div className="help-card"><div className="help-icon"><CircleHelp size={16} /></div><div><strong>Need a hand?</strong><span>Visit our help centre</span></div><ChevronRight size={15} /></div>}<div className="profile-row"><div className="profile-avatar">{isLiveMode ? initials(profileName) : 'CM'}</div><div className="profile-copy"><strong>{profileName}</strong><span>{isLiveMode ? 'Signed-in account' : 'Workspace admin'}</span></div>{!isLiveMode && <MoreHorizontal size={18} />}</div></div>
      <button className="collapse-button" onClick={() => setCollapsed(!collapsed)} aria-label="Collapse sidebar"><ChevronLeft size={15} /></button>
    </aside>
    <div className="main-column"><header className="topbar"><div className="top-left"><button className="icon-button mobile-menu" onClick={() => setMobileOpen(true)} aria-label="Open menu"><Menu size={20} /></button><div className="breadcrumb"><span>Workspace</span><ChevronRight size={14} /><strong>{currentName}</strong></div></div><div className="top-actions"><label className="company-switch"><Building2 size={15} /><select value={activeCompanyId} onChange={(event) => setActiveCompanyId(event.target.value)} aria-label="Select company"><option value="all">All companies</option>{companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select><ChevronDown size={14} /></label><button className="icon-button theme-toggle" onClick={() => setDark(!dark)} aria-label={`Switch to ${dark ? 'light' : 'dark'} theme`}>{dark ? <Sun size={17} /> : <Moon size={17} />}</button><button className="icon-button search-trigger" aria-label="Search"><Search size={17} /><kbd>âŒ˜ K</kbd></button><Link className="icon-button notification-button" to="/notifications" aria-label={unreadNotifications ? `Notifications, ${unreadNotifications} unread` : 'Notifications'}><Bell size={17} />{unreadNotifications > 0 && <span className="notification-badge" aria-hidden="true">{unreadNotifications > 99 ? '99+' : unreadNotifications}</span>}</Link>{isLiveMode && <button className="auth-signout" onClick={async () => { setAuthActionError(''); try { await auth.signOut() } catch { setAuthActionError('We could not sign you out. Please try again.') } }}>Sign out</button>}<div className="top-avatar" title={isLiveMode ? auth.user?.email ?? '' : 'Chola Mwansa'}>{isLiveMode ? (auth.user?.email?.slice(0, 2).toUpperCase() ?? 'HR') : 'CM'}</div></div></header>
      {authActionError && <div className="auth-shell-error" role="alert">{authActionError}</div>}{workspaceError && <div className="auth-shell-error" role="alert">{workspaceError}</div>}
      <main className="page-content"><Suspense fallback={<div className="route-loading"><span className="route-loading-mark">GB</span><span>Opening workspaceâ€¦</span></div>}><Routes><Route path="/" element={isLiveMode ? <LiveDashboard companies={companies} loading={companiesLoading} /> : <Dashboard />} /><Route path="/companies" element={<CompanyDirectory />} /><Route path="/companies/new" element={<CompanyForm mode="create" />} /><Route path="/companies/:companyId/edit" element={<CompanyForm mode="edit" />} /><Route path="/companies/:companyId" element={<CompanyProfile />} /><Route path="/branches" element={<BranchManagement />} /><Route path="/employees" element={isLiveMode ? <LiveEmployeeDirectory /> : <EmployeeDirectory />} /><Route path="/employee-approvals" element={isLiveMode ? <LiveEmployeeApprovals /> : <EmployeeApprovals />} /><Route path="/employees/new" element={isLiveMode ? <LiveEmployeeForm /> : <EmployeeForm />} /><Route path="/employees/import" element={isLiveMode ? <LiveEmployeeImport /> : <EmployeeImport />} /><Route path="/employees/:employeeId/correct" element={isLiveMode ? <LiveEmployeeForm /> : <EmployeeForm />} /><Route path="/employees/:employeeId" element={isLiveMode ? <LiveEmployeeProfile /> : <EmployeeProfile />} /><Route path="/attendance" element={isLiveMode ? <LiveAttendance /> : <AttendanceScreen />} /><Route path="/leave" element={isLiveMode ? <LiveLeave /> : <LeaveScreen />} /><Route path="/departments" element={isLiveMode ? <LiveHrCatalog type="departments" /> : <CatalogScreen type="departments" />} /><Route path="/job-roles" element={isLiveMode ? <LiveHrCatalog type="jobRoles" /> : <CatalogScreen type="roles" />} /><Route path="/payroll" element={isLiveMode ? <LivePayrollInputs /> : <PayrollScreen />} /><Route path="/payslips" element={isLiveMode ? <LivePayslips /> : <LiveModuleUnavailable name="Payslips" />} /><Route path="/reconciliation" element={isLiveMode ? <LivePayrollReconciliation /> : <LiveModuleUnavailable name="Payout reconciliation" />} /><Route path="/deductions" element={isLiveMode ? <LiveDeductions /> : <EmployeeDeductions />} /><Route path="/statutory" element={isLiveMode ? <LiveStatutoryFilings /> : <StatutoryScreen />} /><Route path="/reports" element={isLiveMode ? <LivePayrollReports /> : <ReportsScreen />} /><Route path="/users" element={isLiveMode ? <LiveUserAdmin /> : <UsersScreen />} /><Route path="/audit" element={isLiveMode ? <LiveAuditLogs /> : <AuditScreen />} /><Route path="/notifications" element={isLiveMode ? <LiveNotifications /> : <NotificationsScreen />} /><Route path="/settings" element={isLiveMode ? <LiveSettings /> : <SettingsScreen/>}/>{nav.flatMap((section) => section.items).filter((item) => !['/', '/companies', '/branches', '/employees', '/employee-approvals', '/attendance', '/leave', '/payroll', '/payslips', '/reconciliation', '/deductions', '/statutory', '/reports', '/users', '/audit', '/notifications', '/settings'].includes(item.path)).map((item) => <Route key={item.path} path={item.path} element={isLiveMode ? <LiveModuleUnavailable name={item.name} /> : <Placeholder name={item.name} />} />)}<Route path="*" element={isLiveMode ? <LiveDashboard companies={companies} loading={companiesLoading} /> : <Dashboard />} /></Routes></Suspense></main>
      <footer className="app-footer"><span>Â© 2026 Golden Baobab HR</span><span>Built for the way Zambia works <span className="footer-sun">âœ³</span></span><span>People and payroll workspace</span></footer>
    </div>
  </div></PayrollContext.Provider></EmployeeContext.Provider></WorkspaceContext.Provider>
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

function LiveModuleUnavailable({ name }: { name: string }) {
  return <section className="welcome-row route-welcome"><div><div className="eyebrow"><span className="eyebrow-line" /> SERVICE UPDATE</div><h1>{name}</h1><p>This service is not available in your workspace yet. No changes have been saved.</p></div></section>
}

function Dashboard() {
  return <><section className="welcome-row"><div><div className="eyebrow"><span className="eyebrow-line" /> TUESDAY, 27 OCTOBER 2026</div><h1>Good morning, Chola <span className="wave">âœ³</span></h1><p>Hereâ€™s whatâ€™s happening across your companies today.</p></div><div className="welcome-actions"><button className="button-secondary"><CalendarDays size={16} /> This month <ChevronDown size={14} /></button><button className="button-primary"><span>ï¼‹</span> Add employee</button></div></section>
    <section className="metrics-grid"><Metric icon={<Building2 />} tone="teal" label="Total companies" value="6" note="Across all companies" trend="+1 this quarter" up /><Metric icon={<Users />} tone="blue" label="Total employees" value="838" note="Across all companies" trend="5.2%" up /><Metric icon={<Wallet />} tone="amber" label="Monthly payroll" value="K 3.18m" note="October estimate" trend="3.8%" up /><Metric icon={<CalendarDays />} tone="rose" label="Pending leave" value="12" note="Across 5 companies" trend="4 need review" /> </section>
    <section className="content-grid"><div className="panel payroll-panel"><div className="panel-heading"><div><div className="section-eyebrow">PAYROLL AT A GLANCE</div><h2>Payroll overview</h2><p>Monthly payroll across your companies</p></div><button className="select-button">2026 <ChevronDown size={14} /></button></div><div className="payroll-summary"><div><span className="summary-amount">K 3,184,250</span><span className="summary-caption">October 2026 estimate</span></div><span className="change-pill"><ArrowUpRight size={14} /> 3.8%</span><span className="summary-vs">vs. last month</span></div><div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><AreaChart data={payroll} margin={{ top: 12, right: 3, left: -18, bottom: 0 }}><defs><linearGradient id="payrollFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#258b7e" stopOpacity={0.2} /><stop offset="100%" stopColor="#258b7e" stopOpacity={0.01} /></linearGradient></defs><CartesianGrid vertical={false} stroke="var(--grid)" strokeDasharray="4 5" /><XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: 'var(--muted-2)', fontSize: 11 }} dy={9} /><YAxis axisLine={false} tickLine={false} tick={{ fill: 'var(--muted-2)', fontSize: 10 }} tickFormatter={(v) => `K${v}`} domain={[2.5, 3.4]} ticks={[2.5, 2.8, 3.1, 3.4]} /><Tooltip contentStyle={{ borderRadius: 10, border: '1px solid var(--border)', background: 'var(--panel)', color: 'var(--text)', fontSize: 12 }} formatter={(value) => [`K ${Number(value).toFixed(2)}m`, 'Payroll']} /><Area type="monotone" dataKey="value" stroke="#278b7d" strokeWidth={2.5} fill="url(#payrollFill)" activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--panel)' }} /></AreaChart></ResponsiveContainer></div><div className="chart-legend"><span><i className="legend-dot teal-dot" /> Total payroll</span><span>Values in ZMW</span></div></div>
      <div className="panel distribution-panel"><div className="panel-heading"><div><div className="section-eyebrow">YOUR PEOPLE</div><h2>Employee distribution</h2><p>Where your people work</p></div><button className="icon-button subtle"><MoreHorizontal size={19} /></button></div><div className="donut-area"><div className="donut-chart"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={employees} dataKey="count" nameKey="name" innerRadius={58} outerRadius={78} startAngle={90} endAngle={-270} paddingAngle={3} stroke="none">{employees.map((entry) => <Cell key={entry.name} fill={entry.color} />)}</Pie><Tooltip contentStyle={{ borderRadius: 10, border: '1px solid var(--border)', background: 'var(--panel)', color: 'var(--text)', fontSize: 12 }} /></PieChart></ResponsiveContainer><div className="donut-center"><strong>838</strong><span>people</span></div></div></div><div className="distribution-legend">{employees.map((item) => <div className="distribution-item" key={item.name}><i style={{ background: item.color }} /><span>{item.name}</span><strong>{item.count}</strong></div>)}</div><a className="text-link" href="/companies">View company breakdown <ArrowUpRight size={14} /></a></div>
    </section>
    <section className="lower-grid"><div className="panel activity-panel"><div className="panel-heading compact"><div><div className="section-eyebrow">YOUR WORKSPACE</div><h2>Recent activity</h2></div><button className="text-button">View all <ArrowUpRight size={14} /></button></div><div className="activity-list">{activities.map((activity) => <div className="activity-row" key={activity.title}><div className={`activity-avatar ${activity.color}`}>{activity.initials}</div><div className="activity-copy"><strong>{activity.title}</strong><span>{activity.detail}</span></div><time>{activity.time}</time></div>)}</div></div><div className="panel dates-panel"><div className="panel-heading compact"><div><div className="section-eyebrow">MARK YOUR CALENDAR</div><h2>Coming up</h2></div><button className="icon-button subtle"><MoreHorizontal size={19} /></button></div><div className="date-list"><DateRow day="31" month="OCT" tone="teal" title="October payroll" detail="Pay day Â· All companies" tag="In 4 days" /><DateRow day="05" month="NOV" tone="amber" title="PAYE submission" detail="Zambia Revenue Authority" tag="In 9 days" /><DateRow day="10" month="NOV" tone="blue" title="NAPSA contributions" detail="September cycle Â· All companies" tag="In 14 days" /></div><a className="text-link" href="/payroll">View payroll calendar <ArrowUpRight size={14} /></a></div><div className="panel company-overview"><div className="panel-heading compact"><div><div className="section-eyebrow">ACROSS YOUR GROUP</div><h2>Company overview</h2></div><button className="icon-button subtle"><MoreHorizontal size={19} /></button></div><div className="company-list">{[{ initials: 'CM', name: 'Copperbelt Mining Co.', category: 'Mining Â· Kitwe', count: '284', color: 'gold' }, { initials: 'LF', name: 'Lusaka Foods Ltd.', category: 'Manufacturing Â· Lusaka', count: '196', color: 'mint' }, { initials: 'ZL', name: 'Zambezi Logistics', category: 'Transport Â· Ndola', count: '142', color: 'blue' }].map((item) => <div className="company-row" key={item.name}><div className={`company-logo ${item.color}`}>{item.initials}</div><div className="company-copy"><strong>{item.name}</strong><span>{item.category}</span></div><strong className="company-count">{item.count}<small> people</small></strong></div>)}</div><a className="text-link" href="/companies">View all 6 companies <ArrowUpRight size={14} /></a></div></section>
    <div className="mock-note"><span className="mock-mark">âœ³</span><span>Preview workspace</span><span className="mock-divider">Â·</span><span>All figures and people shown are synthetic demo data</span><button>Explore company switcher <ArrowUpRight size={13} /></button></div>
  </>
}
function Metric({ icon, tone, label, value, note, trend, up = false }: { icon: React.ReactNode; tone: string; label: string; value: string; note: string; trend?: string; up?: boolean }) { return <article className="metric-card"><div className="metric-top"><div className={`metric-icon ${tone}`}>{icon}</div></div><div className="metric-label">{label}</div><div className="metric-value">{value}</div><div className="metric-bottom"><span>{note}</span>{trend && <span className={up ? 'trend positive' : 'trend neutral'}>{up && <ArrowUpRight size={12} />}{trend}</span>}</div></article> }
function DateRow({ day, month, tone, title, detail, tag }: { day: string; month: string; tone: string; title: string; detail: string; tag: string }) { return <div className="date-row"><div className={`date-box ${tone}`}><strong>{day}</strong><span>{month}</span></div><div className="date-copy"><strong>{title}</strong><span>{detail}</span></div><span className="date-tag">{tag}</span></div> }
function Placeholder({ name }: { name: string }) { const content = routeContent[name] ?? routeContent.Settings; return <><section className="welcome-row route-welcome"><div><div className="eyebrow"><span className="eyebrow-line" /> GOLDEN BAOBAB HR WORKSPACE</div><h1>{name}</h1><p>{content.description}</p></div><div className="welcome-actions"><button className="button-secondary"><CalendarDays size={16} /> Last 30 days <ChevronDown size={14} /></button><button className="button-primary"><span>ï¼‹</span> {name === 'Audit Logs' || name === 'Reports' ? 'Export' : `Add ${name.endsWith('s') ? name.slice(0, -1).toLowerCase() : name.toLowerCase()}`}</button></div></section><div className="placeholder-layout"><section className="panel placeholder-intro"><div className="section-eyebrow">{content.eyebrow}</div><div className="placeholder-stat">{content.stat}</div><div className="placeholder-stat-label">{content.statLabel}</div><div className="placeholder-bar"><span /></div><p>Your Golden Baobab HR workspace brings the information that matters into one clear view. These preview records use synthetic demo data.</p></section><section className="panel placeholder-records"><div className="panel-heading"><div><div className="section-eyebrow">LATEST UPDATES</div><h2>{name} directory</h2><p>A quick look at your workspace</p></div><button className="select-button">All records <ChevronDown size={14} /></button></div><div className="record-search"><Search size={16} /><span>Search {name.toLowerCase()}...</span><kbd>âŒ˜ K</kbd></div><div className="record-list">{content.rows.map((row, index) => <div className="record-row" key={row.name}><div className={`record-mark record-${index + 1}`}>{row.name.split(' ').slice(0, 2).map((word) => word[0]).join('')}</div><div className="record-copy"><strong>{row.name}</strong><span>{row.detail}</span></div><span className="record-badge">{row.badge}</span><button className="icon-button subtle"><MoreHorizontal size={18} /></button></div>)}</div><button className="load-more">View all {name.toLowerCase()} <ArrowUpRight size={14} /></button></section></div><div className="mock-note"><span className="mock-mark">âœ³</span><span>Preview workspace</span><span className="mock-divider">Â·</span><span>All records shown are synthetic demo data</span></div></> }
function App() { return <BrowserRouter><AuthProvider><AppShell /></AuthProvider></BrowserRouter> }
export default App
