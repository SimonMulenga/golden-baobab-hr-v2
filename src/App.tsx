import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { BrowserRouter, Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { Activity, Bell, BriefcaseBusiness, Building2, CalendarDays, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, ClipboardCheck, Clock3, FileBarChart2, FileText, Fingerprint, LayoutDashboard, Menu, Moon, MoreHorizontal, Search, Settings, ShieldCheck, Sun, Users, Wallet, X } from 'lucide-react'
import { WorkspaceContext, defaultWorkspacePreferences, useWorkspace, type WorkspacePreferences } from './features/companies/WorkspaceContext'
import { AuthProvider } from './features/auth/AuthContext'
import { useAuth } from './features/auth/auth-context'
import { getAuthGateDecision } from './features/auth/auth-routing'
import { mergeWorkspaceRoles, roleCanOpenPath, visibleWorkspaceRoutes, type WorkspaceRole } from './features/auth/workspace-access'
import { isLiveMode } from './lib/data-mode'
import { getSupabaseClient } from './lib/supabase/client'
import { createLiveCompanyServices } from './services/live-company-services'
import { createLiveBusinessServices } from './services/live-business-services'
import { createLiveOperationsServices } from './services/live-operations-services'
import { loadDashboardMetrics, type DashboardMetrics } from './services/live-dashboard-services'
import type { Company } from './features/companies/types'
import { RouteErrorBoundary } from './components/RouteErrorBoundary'
import { PwaPrompts, PwaInstallMenuAction } from './features/pwa/PwaControls'
import { PwaProvider } from './features/pwa/pwa-runtime'
import { useRealtimeNotifications } from './features/notifications/useRealtimeNotifications'
import type { UserNotificationRecord } from './services/live-operations-services'
const { CompanyDirectory, CompanyForm, CompanyProfile, BranchManagement } = { CompanyDirectory: lazy(() => import('./features/companies/CompanyScreens').then((module) => ({ default: module.CompanyDirectory }))), CompanyForm: lazy(() => import('./features/companies/CompanyScreens').then((module) => ({ default: module.CompanyForm }))), CompanyProfile: lazy(() => import('./features/companies/CompanyScreens').then((module) => ({ default: module.CompanyProfile }))), BranchManagement: lazy(() => import('./features/companies/CompanyScreens').then((module) => ({ default: module.BranchManagement }))) }
const LiveEmployeeDirectory = lazy(() => import('./features/employees/LiveEmployeeScreens').then((module) => ({ default: module.LiveEmployeeDirectory })))
const LiveEmployeeApprovals = lazy(() => import('./features/employees/LiveEmployeeScreens').then((module) => ({ default: module.LiveEmployeeApprovals })))
const LiveEmployeeForm = lazy(() => import('./features/employees/LiveEmployeeScreens').then((module) => ({ default: module.LiveEmployeeForm })))
const LiveEmployeeProfile = lazy(() => import('./features/employees/LiveEmployeeScreens').then((module) => ({ default: module.LiveEmployeeProfile })))
const LiveEmployeeImport = lazy(() => import('./features/employees/LiveEmployeeImport').then((module) => ({ default: module.LiveEmployeeImport })))
const LiveAttendance = lazy(() => import('./features/people-ops/LiveAttendance').then((module) => ({ default: module.LiveAttendance })))
const LiveLeave = lazy(() => import('./features/people-ops/LiveLeave').then((module) => ({ default: module.LiveLeave })))
const LivePayrollInputs = lazy(() => import('./features/payroll/LivePayrollInputs').then((module) => ({ default: module.LivePayrollInputs })))
const LivePayrollApprovals = lazy(() => import('./features/payroll/LivePayrollApprovals').then((module) => ({ default: module.LivePayrollApprovals })))
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
import './design-system.css'
import './premium-system.css'

const nav = [
  { label: 'OVERVIEW', items: [{ name: 'Dashboard', path: '/', icon: LayoutDashboard }] },
  { label: 'PEOPLE & OPERATIONS', items: [{ name: 'Companies', path: '/companies', icon: Building2 }, { name: 'Branches', path: '/branches', icon: Building2 }, { name: 'Employees', path: '/employees', icon: Users }, { name: 'Employee Import', path: '/employees/import', icon: FileText }, { name: 'Employee Approvals', path: '/employee-approvals', icon: ShieldCheck }, { name: 'Departments', path: '/departments', icon: Building2 }, { name: 'Job roles', path: '/job-roles', icon: BriefcaseBusiness }, { name: 'Attendance', path: '/attendance', icon: Clock3 }, { name: 'Leave Management', path: '/leave', icon: CalendarDays }] },
  { label: 'PAYROLL & INSIGHTS', items: [{ name: 'Payroll', path: '/payroll', icon: Wallet }, { name: 'Pending payroll approval', path: '/payroll-approvals', icon: ClipboardCheck }, { name: 'Payslips', path: '/payslips', icon: FileText }, { name: 'Payout Reconciliation', path: '/reconciliation', icon: CircleHelp }, { name: 'Deductions & Advances', path: '/deductions', icon: Wallet }, { name: 'Statutory Deductions', path: '/statutory', icon: ShieldCheck }, { name: 'Reports', path: '/reports', icon: FileBarChart2 }] },
  { label: 'ADMINISTRATION', items: [{ name: 'Users & Permissions', path: '/users', icon: Fingerprint }, { name: 'Audit Logs', path: '/audit', icon: Activity }, { name: 'Notifications', path: '/notifications', icon: Bell }, { name: 'Settings', path: '/settings', icon: Settings }] },
]
function AppShell() {
  const auth = useAuth()
  const authUserId = auth.user?.id
  const [dark, setDark] = useState(() => localStorage.getItem('golden-baobab-hr-theme') === 'dark')
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const mobileMenuButton = useRef<HTMLButtonElement>(null)
  const searchInput = useRef<HTMLInputElement>(null)
  const mobileWasOpen = useRef(false)
  const [companies, setCompanies] = useState<Company[]>([])
  const [companiesOwnerId, setCompaniesOwnerId] = useState<string | null>(null)
  const [roleContext, setRoleContext] = useState<{ roles: WorkspaceRole[]; loading: boolean }>({ roles: [], loading: true })
  const companiesLoading = isLiveMode && auth.user?.id !== companiesOwnerId
  const [workspaceError, setWorkspaceError] = useState('')
  const [activeCompanyId, setActiveCompanyId] = useState('all')
  const [workspacePreferences, setWorkspacePreferences] = useState<{ companyId: string; value: WorkspacePreferences } | null>(null)
  const [unreadNotifications, setUnreadNotifications] = useState(0)
  const [realtimeNotification, setRealtimeNotification] = useState<UserNotificationRecord | null>(null)
  const navigate = useNavigate()
  const [pendingPayrollApprovals, setPendingPayrollApprovals] = useState(0)
  const [pendingEmployeeApprovals, setPendingEmployeeApprovals] = useState(0)
  const [authActionError, setAuthActionError] = useState('')
  const location = useLocation()
  const notificationClient = useMemo(() => isLiveMode && authUserId ? getSupabaseClient() : null, [authUserId])
  useRealtimeNotifications(notificationClient, authUserId, setRealtimeNotification)
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    const handleWorkerMessage = (event: MessageEvent) => {
      if (event.data?.type === 'GBHR_OPEN_NOTIFICATIONS') navigate('/notifications')
    }
    navigator.serviceWorker.addEventListener('message', handleWorkerMessage)
    return () => navigator.serviceWorker.removeEventListener('message', handleWorkerMessage)
  }, [navigate])
  const routeName = nav.flatMap((section) => section.items).find((item) => item.path === location.pathname)?.name
  const currentName = routeName ?? (location.pathname === '/companies/new' ? 'Add company' : location.pathname.endsWith('/edit') ? 'Edit company' : location.pathname.startsWith('/companies/') ? 'Company details' : location.pathname === '/employees/new' ? 'Add employee' : location.pathname.endsWith('/correct') ? 'Review employee' : location.pathname.startsWith('/employees/import') ? 'Employee import' : location.pathname.startsWith('/employees/') ? 'Employee profile' : location.pathname === '/auth/login' ? 'Sign in' : location.pathname === '/job-roles' ? 'Job roles' : 'Page not found')
  const currentCompany = companies.find((company) => company.id === activeCompanyId)
  const workspaceName = activeCompanyId === 'all' ? 'All companies' : currentCompany?.name ?? 'Company workspace'
  const allowedRoutes = useMemo(() => visibleWorkspaceRoutes(roleContext.roles), [roleContext.roles])
  const canOpenPayrollApprovals = allowedRoutes.has('/payroll-approvals')
  const canOpenEmployeeApprovals = allowedRoutes.has('/employee-approvals')
  const visibleNav = useMemo(() => nav.map((section) => ({ ...section, items: section.items.filter((item) => allowedRoutes.has(item.path)) })).filter((section) => section.items.length), [allowedRoutes])
  const searchItems = useMemo(() => visibleNav.flatMap((section) => section.items).filter((item) => item.name.toLowerCase().includes(searchQuery.trim().toLowerCase())), [visibleNav, searchQuery])
  const branchOnly = roleContext.roles.includes('BRANCH_MANAGER') && !roleContext.roles.some((role) => ['PORTFOLIO_ADMIN', 'PORTFOLIO_COMPANY_ADMIN', 'OVERALL_HR_MANAGER'].includes(role))
  const maySelectCompany = !branchOnly && companies.length > 1
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
  useEffect(() => {
    if (!authUserId || !canOpenPayrollApprovals) { setPendingPayrollApprovals(0); return }
    let cancelled = false
    const loadCount = async () => {
      try {
        const count = await createLiveBusinessServices(getSupabaseClient()).payroll.pendingApprovalCount()
        if (!cancelled) setPendingPayrollApprovals(count)
      } catch { if (!cancelled) setPendingPayrollApprovals(0) }
    }
    void loadCount()
    window.addEventListener('gbhr-payroll-approvals-changed', loadCount)
    const interval = window.setInterval(() => void loadCount(), 60_000)
    return () => { cancelled = true; window.clearInterval(interval); window.removeEventListener('gbhr-payroll-approvals-changed', loadCount) }
  }, [authUserId, canOpenPayrollApprovals, location.pathname])
  useEffect(() => {
    if (!authUserId || !canOpenEmployeeApprovals) { setPendingEmployeeApprovals(0); return }
    let cancelled = false
    const loadCount = async () => {
      try {
        const summary = await createLiveBusinessServices(getSupabaseClient()).employees.approvalQueueSummary(activeCompanyId !== 'all' ? activeCompanyId : undefined)
        if (!cancelled) setPendingEmployeeApprovals(summary.total_pending)
      } catch { if (!cancelled) setPendingEmployeeApprovals(0) }
    }
    void loadCount()
    window.addEventListener('gbhr-employee-approvals-changed', loadCount)
    const interval = window.setInterval(() => void loadCount(), 60_000)
    return () => { cancelled = true; window.clearInterval(interval); window.removeEventListener('gbhr-employee-approvals-changed', loadCount) }
  }, [authUserId, canOpenEmployeeApprovals, activeCompanyId, location.pathname])
  useEffect(() => { setMobileOpen(false); setProfileMenuOpen(false) }, [location.pathname])
  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setSearchOpen(true) }
      if (event.key === 'Escape') { setSearchOpen(false); setProfileMenuOpen(false) }
    }
    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [])
  useEffect(() => { if (searchOpen) searchInput.current?.focus() }, [searchOpen])
  useEffect(() => {
    if (!mobileOpen) {
      if (mobileWasOpen.current) mobileMenuButton.current?.focus()
      mobileWasOpen.current = false
      return
    }
    mobileWasOpen.current = true
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [mobileOpen])
  useEffect(() => {
    if (!authUserId) return
    let cancelled = false
    createLiveCompanyServices(getSupabaseClient(), authUserId).list()
      .then((items) => { if (!cancelled) { setCompanies(items); setActiveCompanyId((current) => items.some((item) => item.id === current) ? current : 'all'); setWorkspaceError('') } })
      .catch(() => { if (!cancelled) setWorkspaceError('Company data could not be loaded. Check your access or try again.') })
      .finally(() => { if (!cancelled) setCompaniesOwnerId(authUserId) })
    return () => { cancelled = true }
  }, [authUserId])
  useEffect(() => {
    if (!authUserId) { setRoleContext({ roles: [], loading: false }); return }
    let cancelled = false
    setRoleContext((current) => ({ ...current, loading: true }))
    const client = getSupabaseClient()
    void Promise.all([
      client.from('portfolio_memberships').select('role').eq('user_id', authUserId).is('revoked_at', null),
      client.from('company_memberships').select('role').eq('user_id', authUserId).is('revoked_at', null),
    ]).then(([portfolio, company]) => {
      if (cancelled) return
      const portfolioRoles = (portfolio.data ?? []).map((row) => row.role)
      const companyRoles = (company.data ?? []).map((row) => row.role)
      const roles = mergeWorkspaceRoles(portfolioRoles, companyRoles)
      setRoleContext({ roles, loading: false })
    }).catch(() => { if (!cancelled) setRoleContext({ roles: [], loading: false }) })
    return () => { cancelled = true }
  }, [authUserId])
  useEffect(() => {
    if (!authUserId || companiesOwnerId !== authUserId || companies.length !== 1) return
    setActiveCompanyId((current) => current === 'all' ? companies[0].id : current)
  }, [authUserId, companiesOwnerId, companies])
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
    saveCompanyLogo: async (companyId: string, file: File | null) => {
      const saved = await createLiveCompanyServices(getSupabaseClient(), authUserId ?? '').saveLogo(companyId, file)
      setCompanies((items) => items.map((item) => item.id === saved.id ? saved : item))
      return saved
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
  if (authGate === 'loading') return <main className="auth-prototype" aria-live="polite"><div className="route-loading"><span className="route-loading-mark">GB</span><span>Securing your session…</span></div></main>
  if (authGate === 'recovery') return <Navigate to="/auth/reset" replace />
  if (authGate === 'login') return <Navigate to="/auth/login" replace />
  const routeAllowed = roleCanOpenPath(allowedRoutes, location.pathname)
  const knownRoute = nav.flatMap((section) => section.items).some((item) => item.path === location.pathname)
    || /^\/(employees|companies)\/[^/]+(?:\/(edit|correct))?$/.test(location.pathname)
    || location.pathname.startsWith('/employees/import/')
  if (isLiveMode && knownRoute && !roleContext.loading && !companiesLoading && location.pathname !== '/' && !routeAllowed) return <Navigate to="/" replace />
  if (location.pathname.startsWith('/auth/')) return <Suspense fallback={<div className="route-loading">Opening sign-in…</div>}><Routes><Route path="/auth/:screen" element={<AuthPrototype/>}/></Routes></Suspense>
  return <WorkspaceContext.Provider value={data}><div className={`app-shell ${collapsed ? 'is-collapsed' : ''}`}><a className="skip-to-content" href="#main-content">Skip to content</a>{mobileOpen && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
    <aside id="workspace-navigation" className={`sidebar ${mobileOpen ? 'mobile-open' : ''}`}>
      <div className="brand"><div className="brand-mark" aria-hidden="true"><span>GB</span></div><span className="brand-word">Golden Baobab <span>HR</span></span><button className="icon-button mobile-close" onClick={() => setMobileOpen(false)} aria-label="Close menu"><X size={18} /></button></div>
      <div className="workspace-selector"><div className="workspace-avatar">{isLiveMode ? initials(workspaceName) : 'MH'}</div><div className="workspace-copy"><strong>{workspaceName}</strong><span>{roleContext.roles.includes('PORTFOLIO_COMPANY_ADMIN') ? 'Portfolio Administrator' : roleContext.roles.includes('PORTFOLIO_ADMIN') ? 'Platform Super Administrator' : branchOnly ? (companies[0]?.branches.length === 1 ? companies[0].branches[0].name : 'Assigned branches') : roleContext.roles.includes('OVERALL_HR_MANAGER') ? 'Overall HR Manager' : 'Company workspace'}</span></div>{maySelectCompany && <ChevronDown size={15} />}</div>
      <nav className="side-nav" aria-label="Primary navigation">{visibleNav.map((section) => <div className="nav-section" key={section.label}><div className="nav-label">{section.label}</div>{section.items.map(({ name, path, icon: Icon }) => <NavLink key={path} to={path} end={path === '/' || path === '/employees'} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} title={collapsed ? name : undefined} onClick={() => setMobileOpen(false)}><Icon size={17} strokeWidth={1.8} /><span>{name}</span>{name === 'Notifications' && unreadNotifications > 0 && <span className="nav-count">{unreadNotifications > 99 ? '99+' : unreadNotifications}</span>}{name === 'Employee Approvals' && pendingEmployeeApprovals > 0 && <span className="nav-count" aria-label={`${pendingEmployeeApprovals} pending employee approvals`}>{pendingEmployeeApprovals > 99 ? '99+' : pendingEmployeeApprovals}</span>}{name === 'Pending payroll approval' && pendingPayrollApprovals > 0 && <span className="nav-count" aria-label={`${pendingPayrollApprovals} pending payroll approvals`}>{pendingPayrollApprovals > 99 ? '99+' : pendingPayrollApprovals}</span>}</NavLink>)}</div>)}</nav>
      <div className="sidebar-bottom">{!isLiveMode && <div className="help-card"><div className="help-icon"><CircleHelp size={16} /></div><div><strong>Need a hand?</strong><span>Visit our help centre</span></div><ChevronRight size={15} /></div>}<div className="profile-row"><div className="profile-avatar">{isLiveMode ? initials(profileName) : 'CM'}</div><div className="profile-copy"><strong>{profileName}</strong><span>{isLiveMode ? 'Signed-in account' : 'Workspace admin'}</span></div>{!isLiveMode && <MoreHorizontal size={18} />}</div></div>
      <PwaInstallMenuAction />
      <button className="collapse-button" onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'} aria-pressed={collapsed}><ChevronLeft size={15} /></button>
    </aside>
    <div className="main-column"><header className="topbar"><div className="top-left"><button ref={mobileMenuButton} className="icon-button mobile-menu" onClick={() => setMobileOpen(true)} aria-expanded={mobileOpen} aria-controls="workspace-navigation" aria-label="Open menu"><Menu size={20} /></button><div className="breadcrumb"><span>Workspace</span><ChevronRight size={14} /><strong>{currentName}</strong></div></div><div className="top-actions">{maySelectCompany ? <label className="company-switch"><Building2 size={15} /><select value={activeCompanyId} onChange={(event) => setActiveCompanyId(event.target.value)} aria-label="Select company"><option value="all">All authorized companies</option>{companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select><ChevronDown size={14} /></label> : companies.length === 1 && <div className="company-switch company-context" aria-label="Assigned company"><Building2 size={15}/><span>{companies[0].name}</span></div>}<button className="icon-button theme-toggle" onClick={() => setDark(!dark)} aria-label={`Switch to ${dark ? 'light' : 'dark'} theme`}>{dark ? <Sun size={17} /> : <Moon size={17} />}</button><button className="icon-button search-trigger" aria-label="Search pages" aria-haspopup="dialog" aria-expanded={searchOpen} onClick={() => { setSearchQuery(""); setSearchOpen(true) }}><Search size={17} /><kbd>âŒ˜ K</kbd></button><Link className="icon-button notification-button" to="/notifications" aria-label={unreadNotifications ? `Notifications, ${unreadNotifications} unread` : 'Notifications'}><Bell size={17} />{unreadNotifications > 0 && <span className="notification-badge" aria-hidden="true">{unreadNotifications > 99 ? '99+' : unreadNotifications}</span>}</Link><div className="account-menu-anchor" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setProfileMenuOpen(false) }}><button className="account-menu-trigger" type="button" aria-haspopup="menu" aria-expanded={profileMenuOpen} aria-label={"Account menu for " + profileName} onClick={() => setProfileMenuOpen((open) => !open)}><span className="top-avatar">{isLiveMode ? (auth.user?.email?.slice(0, 2).toUpperCase() ?? 'HR') : 'CM'}</span><ChevronDown size={14}/></button>{profileMenuOpen && <div className="account-menu" role="menu"><div className="account-menu-identity"><strong>{profileName}</strong><span>{isLiveMode ? auth.user?.email : 'Workspace administrator'}</span></div><button role="menuitem" type="button" onClick={() => { setDark((value) => !value); setProfileMenuOpen(false) }}>{dark ? <Sun size={15}/> : <Moon size={15}/>} {dark ? 'Use light theme' : 'Use dark theme'}</button>{isLiveMode && <button role="menuitem" type="button" onClick={async () => { setAuthActionError(''); try { await auth.signOut() } catch { setAuthActionError('We could not sign you out. Please try again.') } finally { setProfileMenuOpen(false) } }}><X size={15}/> Sign out</button>}</div>}</div></div></header>
      {searchOpen && <div className="quick-search-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSearchOpen(false) }}><section className="quick-search" role="dialog" aria-modal="true" aria-label="Search workspace pages"><label htmlFor="workspace-page-search"><Search size={17}/><input ref={searchInput} id="workspace-page-search" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Find an authorized page…" /></label><div role="listbox" aria-label="Available pages">{searchItems.length ? searchItems.map(({ name, path, icon: Icon }) => <Link role="option" aria-selected="false" key={path} to={path} onClick={() => setSearchOpen(false)}><Icon size={16}/><span>{name}</span><ChevronRight size={14}/></Link>) : <p>No accessible pages match that search.</p>}</div><footer><span>Only pages available to your account are shown.</span><button className="button-secondary" onClick={() => setSearchOpen(false)}>Close</button></footer></section></div>}
      {authActionError && <div className="auth-shell-error" role="alert">{authActionError}</div>}{workspaceError && <div className="auth-shell-error" role="alert">{workspaceError}</div>}
      <main id="main-content" className="page-content" tabIndex={-1}><RouteErrorBoundary key={location.pathname}><Suspense fallback={<div className="route-loading"><span className="route-loading-mark">GB</span><span>Opening workspace…</span></div>}><Routes>
          <Route path="/" element={<LiveDashboard companies={companies} loading={companiesLoading} canCreateCompany={roleContext.roles.some((role) => ['PORTFOLIO_ADMIN', 'PORTFOLIO_COMPANY_ADMIN'].includes(role))} availableRoutes={allowedRoutes} />} />
          <Route path="/companies" element={<CompanyDirectory />} />
          <Route path="/companies/new" element={<CompanyForm mode="create" />} />
          <Route path="/companies/:companyId/edit" element={<CompanyForm mode="edit" />} />
          <Route path="/companies/:companyId" element={<CompanyProfile />} />
          <Route path="/branches" element={<BranchManagement />} />
          <Route path="/employees" element={<LiveEmployeeDirectory />} />
          <Route path="/employee-approvals" element={<LiveEmployeeApprovals roles={roleContext.roles} />} />
          <Route path="/employees/new" element={<LiveEmployeeForm />} />
          <Route path="/employees/import" element={<LiveEmployeeImport />} />
          <Route path="/employees/import/staging" element={<Navigate to="/employee-approvals" replace />} />
          <Route path="/employees/:employeeId/correct" element={<LiveEmployeeForm />} />
          <Route path="/employees/:employeeId" element={<LiveEmployeeProfile />} />
          <Route path="/attendance" element={<LiveAttendance />} />
          <Route path="/leave" element={<LiveLeave />} />
          <Route path="/departments" element={<LiveHrCatalog type="departments" />} />
          <Route path="/job-roles" element={<LiveHrCatalog type="jobRoles" />} />
          <Route path="/payroll" element={<LivePayrollInputs allowOwnApproval={roleContext.roles.includes('OVERALL_HR_MANAGER')} />} />
          <Route path="/payroll-approvals" element={<LivePayrollApprovals allowOwnApproval={roleContext.roles.includes('OVERALL_HR_MANAGER')} />} />
          <Route path="/payslips" element={<LivePayslips />} />
          <Route path="/reconciliation" element={<LivePayrollReconciliation />} />
          <Route path="/deductions" element={<LiveDeductions />} />
          <Route path="/statutory" element={<LiveStatutoryFilings />} />
          <Route path="/reports" element={<LivePayrollReports />} />
          <Route path="/users" element={<LiveUserAdmin portfolioCompanyAdmin={roleContext.roles.includes('PORTFOLIO_COMPANY_ADMIN')} portfolioWideAdministrator={roleContext.roles.some((role) => ['PORTFOLIO_ADMIN', 'PORTFOLIO_COMPANY_ADMIN'].includes(role))} companyScopedAdministrator={roleContext.roles.includes('COMPANY_ADMIN') && !roleContext.roles.some((role) => ['PORTFOLIO_ADMIN', 'PORTFOLIO_COMPANY_ADMIN'].includes(role))} />} />
          <Route path="/audit" element={<LiveAuditLogs />} />
          <Route path="/notifications" element={<LiveNotifications userId={authUserId} />} />
          <Route path="/settings" element={<LiveSettings />} />
          <Route path="*" element={<main className="not-found" role="status"><span>404</span><h1>Page not found</h1><p>This workspace route does not exist or is no longer available.</p><Link className="button-primary" to="/">Return to overview</Link></main>} />
        </Routes></Suspense></RouteErrorBoundary></main>
      <footer className="app-footer"><span>Â© 2026 Golden Baobab HR</span><span>Built for the way Zambia works <span className="footer-sun">âœ³</span></span><span>People and payroll workspace</span></footer>
    <PwaPrompts notification={realtimeNotification} onDismissNotification={() => setRealtimeNotification(null)} />
    </div>
  </div></WorkspaceContext.Provider>
}
function LiveDashboard({ companies, loading, canCreateCompany, availableRoutes }: { companies: Company[]; loading: boolean; canCreateCompany: boolean; availableRoutes: Set<string> }) {
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
    <section className="welcome-row"><div><div className="eyebrow"><span className="eyebrow-line" /> Workforce overview</div><h1>Company overview</h1><p>Workforce, payroll and people operations for your authorized workspace.</p></div>{canCreateCompany && <div className="welcome-actions"><Link className="button-primary" to="/companies/new"><Building2 size={15}/> Add company</Link></div>}</section>
    {loading ? <div className="panel empty-state" role="status">Loading your companies…</div> : companies.length === 0 ? <div className="panel empty-state"><h2>{canCreateCompany ? 'Set up your first company' : 'No company access yet'}</h2><p>{canCreateCompany ? 'Add a company to begin setting up branches and HR access.' : 'Ask your company administrator to grant access to a company.'}</p></div> : metricsError ? <div className="auth-shell-error" role="alert">{metricsError}</div> : metricsLoading || !metrics ? <div className="panel empty-state" role="status">Loading company overview…</div> : <section className="metrics-grid">
      <Metric icon={<Building2 />} tone="teal" label="Companies in scope" value={String(scopeCompanies.length)} note={selectedCompany?.name ?? 'Authorized companies'} />
      <Metric icon={<Users />} tone="blue" label="Employees" value={String(metrics.employees)} note={`${metrics.activeEmployees} active`} />
      <Metric icon={<Wallet />} tone="amber" label="Finalized payroll" value={money} note={metrics.finalizedPayrollTotal == null ? 'Restricted by your access' : 'Net pay in finalized runs'} />
      <Metric icon={<ClipboardCheck />} tone="rose" label="Items awaiting approval" value={String(metrics.pendingApprovals)} note="Employee, leave, attendance and payroll" />
    </section>}
    {!loading && companies.length > 0 && <section className="dashboard-quick-actions" aria-label="Quick actions"><div><h2>Quick actions</h2><p>Go straight to a common task.</p></div><div className="dashboard-action-links">{availableRoutes.has('/employees') && <Link to="/employees/new"><Users size={17}/><span><strong>Add employee</strong><small>Create an employee record</small></span><ChevronRight size={16}/></Link>}{availableRoutes.has('/employees/import') && <Link to="/employees/import"><FileText size={17}/><span><strong>Import employees</strong><small>Upload an employee workbook</small></span><ChevronRight size={16}/></Link>}{availableRoutes.has('/employee-approvals') && <Link to="/employee-approvals"><ShieldCheck size={17}/><span><strong>Review approvals</strong><small>{metrics?.pendingApprovals ?? 0} items awaiting action</small></span><ChevronRight size={16}/></Link>}{availableRoutes.has('/payroll') && <Link to="/payroll"><Wallet size={17}/><span><strong>Open payroll</strong><small>Prepare an authorized payroll run</small></span><ChevronRight size={16}/></Link>}{availableRoutes.has('/reports') && <Link to="/reports"><FileBarChart2 size={17}/><span><strong>View reports</strong><small>Open available workforce reports</small></span><ChevronRight size={16}/></Link>}</div></section>}
    {metrics && !metricsLoading && metrics.employees === 0 && !metricsError && <div className="panel empty-state"><h2>Start with your employee directory</h2><p>Your company overview will fill in as you add employees and complete HR workflows.</p><Link className="button-primary" to="/employees/new"><Users size={15}/> Add employee</Link></div>}
  </>
}

function Metric({ icon, tone, label, value, note }: { icon: React.ReactNode; tone: string; label: string; value: string; note: string }) { return <article className="metric-card"><div className="metric-top"><div className={`metric-icon ${tone}`}>{icon}</div></div><div className="metric-label">{label}</div><div className="metric-value">{value}</div><div className="metric-bottom"><span>{note}</span></div></article> }

function App() { return <PwaProvider><BrowserRouter><AuthProvider><AppShell /></AuthProvider></BrowserRouter></PwaProvider> }
export default App
