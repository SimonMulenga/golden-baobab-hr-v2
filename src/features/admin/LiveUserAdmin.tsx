import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Building2, LoaderCircle, ShieldCheck, UserPlus } from 'lucide-react'
import { getSupabaseClient } from '../../lib/supabase/client'
import { createLiveBusinessServices, type CompanyAdminRecord, type PortfolioMemberRecord } from '../../services/live-business-services'
import { formatWorkspaceDate, useCompanySelection, useWorkspace } from '../companies/WorkspaceContext'
import { RowActionsMenu, StatusBadge } from '../../components/RowActionsMenu'
import './live-user-admin.css'
import './live-branch-picker.css'

const companyRoleLabel = (role: string) => role === 'COMPANY_ADMIN'
  ? 'Company Administrator'
  : role.replaceAll('_', ' ')

const portfolioRoleLabel = (role: string) => role === 'COMPANY_ADMIN'
  ? 'Company Administrator'
  : role === 'PORTFOLIO_ADMIN'
    ? 'Portfolio Administrator'
    : role.replaceAll('_', ' ')

type ManagedPortfolioRole = Extract<PortfolioMemberRecord['role'], 'PORTFOLIO_ADMIN' | 'COMPANY_ADMIN' | 'OVERALL_HR_MANAGER'>
type ManagedCompanyRole = Extract<PortfolioMemberRecord['role'], 'COMPANY_ADMIN' | 'COMPANY_PAYROLL_PREPARER' | 'COMPANY_PAYROLL_APPROVER' | 'COMPANY_PAYROLL_REVIEWER'>
type AssignmentEditor = { member: PortfolioMemberRecord; action: 'EDIT' | 'REACTIVATE' }

// Keep the legacy prop accepted while administrator UI capability checks move
// to the same server-enforced permission model for both admin role labels.
export function LiveUserAdmin({ portfolioCompanyAdmin = false, portfolioWideAdministrator = false, companyScopedAdministrator = false }: { portfolioCompanyAdmin?: boolean; portfolioWideAdministrator?: boolean; companyScopedAdministrator?: boolean } = {}) {
  const canManagePortfolio = portfolioWideAdministrator || portfolioCompanyAdmin
  const { companies, preferences } = useWorkspace()
  const { companyId, setCompanyId } = useCompanySelection()
  const [members, setMembers] = useState<CompanyAdminRecord[]>([])
  const [portfolioMembers, setPortfolioMembers] = useState<PortfolioMemberRecord[]>([])
  const [editor, setEditor] = useState<AssignmentEditor | null>(null)
  const [editName, setEditName] = useState('')
  const [editRole, setEditRole] = useState('')
  const [editCompanyId, setEditCompanyId] = useState('')
  const [editBranches, setEditBranches] = useState<string[]>([])
  const [editReason, setEditReason] = useState('')
  const [userId, setUserId] = useState('')
  const [portfolioRole, setPortfolioRole] = useState<PortfolioMemberRecord['role']>('BRANCH_MANAGER')
  const [selectedBranches, setSelectedBranches] = useState<string[]>([])
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState(companyScopedAdministrator ? 'BRANCH_MANAGER' : 'OVERALL_HR_MANAGER')
  const [inviteBranches, setInviteBranches] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [portfolioError, setPortfolioError] = useState('')
  const selectedCompany = companies.find((company) => company.id === companyId) ?? (!companyId ? companies[0] : undefined)

  const load = useCallback(async () => {
    if (!selectedCompany?.portfolioId) { setMembers([]); return }
    setLoading(true); setError('')
    try {
      const services = createLiveBusinessServices(getSupabaseClient())
      const admins = await services.companyAdmins.list(selectedCompany.portfolioId, selectedCompany.id)
      setMembers(admins)
    } catch {
      setMembers([])
      setError('Company access could not be loaded. Your account may not have users.manage permission for this company.')
    } finally { setLoading(false) }
  }, [selectedCompany])

  const loadPortfolioMembers = useCallback(async () => {
    if (!selectedCompany?.portfolioId) { setPortfolioMembers([]); return }
    try {
      const portfolioUsers = createLiveBusinessServices(getSupabaseClient()).portfolioUsers
      const result = await portfolioUsers.listForCompany(selectedCompany.portfolioId, selectedCompany.id)
      setPortfolioMembers(result); setPortfolioError('')
    } catch {
      setPortfolioMembers([]); setPortfolioError('Company account administration is not authorized for this account.')
    }
  }, [selectedCompany])

  useEffect(() => { const timer = window.setTimeout(() => { void load(); void loadPortfolioMembers() }, 0); return () => window.clearTimeout(timer) }, [load, loadPortfolioMembers])

  const assign = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(''); setNotice('')
    if (!selectedCompany?.portfolioId || !userId.trim()) { setBusy(false); setError("Select a company and enter an activated user's account UUID."); return }
    try {
      await createLiveBusinessServices(getSupabaseClient()).companyAdmins.assign(selectedCompany.portfolioId, selectedCompany.id, userId.trim())
      setUserId(''); setNotice('Company Administrator access was assigned. The user must sign in again to refresh access claims.')
      await load()
    } catch { setError('Access was not assigned. Confirm the target account is activated, is not your own account, and you can manage users for this company.') }
    finally { setBusy(false) }
  }

  const beginEdit = (member: PortfolioMemberRecord, action: 'EDIT' | 'REACTIVATE' = 'EDIT') => {
    setEditor({ member, action })
    setEditName(member.display_name ?? '')
    setEditRole(member.role)
    setEditCompanyId(member.company_id ?? selectedCompany?.id ?? '')
    setEditBranches(member.assignment_status === 'INACTIVE' ? [] : member.branch_ids ?? [])
    setEditReason('')
    setError(''); setNotice('')
  }

  const updateAssignmentStatus = async (member: PortfolioMemberRecord, action: 'REVOKE' | 'REMOVE') => {
    const actionLabel = action === 'REMOVE' ? 'Remove' : 'Revoke'
    if (!selectedCompany?.portfolioId || !window.confirm(`${actionLabel} ${portfolioRoleLabel(member.role)} access for ${member.email}? The Auth account and all HR, payroll, and audit history will remain.`)) return
    const reason = window.prompt('Reason for deactivating this role assignment:')
    if (!reason?.trim()) return
    setBusy(true); setError(''); setNotice('')
    try {
      const service = createLiveBusinessServices(getSupabaseClient())
      const companyId = member.company_id ?? selectedCompany.id
      if (member.scope_type === 'BRANCH' && ['BRANCH_MANAGER', 'PAYROLL_PROCESSOR'].includes(member.role)) {
        await service.portfolioUsers.manageBranchAssignment({ portfolioId: selectedCompany.portfolioId, companyId, userId: member.user_id, currentRole: member.role as 'BRANCH_MANAGER' | 'PAYROLL_PROCESSOR', action, reason: reason.trim() })
      } else if (member.scope_type === 'PORTFOLIO' && ['PORTFOLIO_ADMIN', 'COMPANY_ADMIN', 'OVERALL_HR_MANAGER'].includes(member.role)) {
        await service.portfolioUsers.managePortfolioAssignment({ portfolioId: selectedCompany.portfolioId, userId: member.user_id, currentRole: member.role as ManagedPortfolioRole, action, reason: reason.trim() })
      } else if (member.scope_type === 'COMPANY' && member.role === 'COMPANY_ADMIN') {
        await service.companyAdmins.manageAssignment({ portfolioId: selectedCompany.portfolioId, companyId, userId: member.user_id, action, reason: reason.trim() })
      } else if (member.scope_type === 'COMPANY') {
        await service.portfolioUsers.manageCompanyAssignment({ portfolioId: selectedCompany.portfolioId, companyId, userId: member.user_id, currentRole: member.role as ManagedCompanyRole, action, reason: reason.trim() })
      } else throw new Error('Unsupported assignment scope')
      setNotice(action === 'REMOVE' ? 'Role assignment was removed from active access. The account and history remain.' : 'Role access was revoked. The account and history remain available to authorized users.')
      await loadPortfolioMembers()
    } catch { setError('Role access could not be deactivated. The server checks your scope, role hierarchy, and last-administrator protection.') }
    finally { setBusy(false) }
  }

  const reactivateAssignment = async (member: PortfolioMemberRecord) => {
    if (member.scope_type === 'BRANCH') { beginEdit(member, 'REACTIVATE'); return }
    if (!selectedCompany?.portfolioId || !window.confirm(`Reactivate ${portfolioRoleLabel(member.role)} for ${member.email}?`)) return
    const reason = window.prompt('Reason for reactivating this role assignment:')
    if (!reason?.trim()) return
    setBusy(true); setError(''); setNotice('')
    try {
      const service = createLiveBusinessServices(getSupabaseClient())
      const companyId = member.company_id ?? selectedCompany.id
      if (member.scope_type === 'PORTFOLIO' && ['PORTFOLIO_ADMIN', 'COMPANY_ADMIN', 'OVERALL_HR_MANAGER'].includes(member.role)) {
        await service.portfolioUsers.managePortfolioAssignment({ portfolioId: selectedCompany.portfolioId, userId: member.user_id, currentRole: member.role as ManagedPortfolioRole, action: 'REACTIVATE', reason: reason.trim() })
      } else if (member.scope_type === 'COMPANY' && member.role === 'COMPANY_ADMIN') {
        await service.companyAdmins.manageAssignment({ portfolioId: selectedCompany.portfolioId, companyId, userId: member.user_id, action: 'REACTIVATE', reason: reason.trim() })
      } else if (member.scope_type === 'COMPANY') {
        await service.portfolioUsers.manageCompanyAssignment({ portfolioId: selectedCompany.portfolioId, companyId, userId: member.user_id, currentRole: member.role as ManagedCompanyRole, action: 'REACTIVATE', reason: reason.trim() })
      } else throw new Error('Unsupported assignment scope')
      setNotice('Role assignment was reactivated and audited.')
      await loadPortfolioMembers()
    } catch { setError('Role access could not be reactivated. Confirm the selected company and scope are still authorized.') }
    finally { setBusy(false) }
  }

  const saveAssignmentEdit = async (event: FormEvent) => {
    event.preventDefault()
    if (!editor || !selectedCompany?.portfolioId) return
    if (editName.trim().length < 1 || editName.trim().length > 120) { setError('Enter a display name between 1 and 120 characters.'); return }
    if (editReason.trim().length < 3) { setError('Enter a reason for this access change.'); return }
    if (editor.member.scope_type === 'BRANCH' && editBranches.length === 0) { setError('Select at least one active branch for this assignment.'); return }
    setBusy(true); setError(''); setNotice('')
    try {
      const service = createLiveBusinessServices(getSupabaseClient())
      const member = editor.member
      if (member.scope_type === 'BRANCH') {
        await service.portfolioUsers.manageBranchAssignment({
          portfolioId: selectedCompany.portfolioId, companyId: member.company_id ?? selectedCompany.id,
          newCompanyId: editCompanyId, userId: member.user_id,
          currentRole: member.role as 'BRANCH_MANAGER' | 'PAYROLL_PROCESSOR', action: editor.action,
          newRole: editRole as 'BRANCH_MANAGER' | 'PAYROLL_PROCESSOR', branchIds: editBranches,
          reason: editReason.trim(), displayName: editName.trim(),
        })
      } else if (member.scope_type === 'PORTFOLIO') {
        await service.portfolioUsers.managePortfolioAssignment({ portfolioId: selectedCompany.portfolioId, userId: member.user_id,
          currentRole: member.role as ManagedPortfolioRole, action: editor.action,
          newRole: editRole as ManagedPortfolioRole, reason: editReason.trim(), displayName: editName.trim() })
      } else if (member.scope_type === 'COMPANY' && member.role === 'COMPANY_ADMIN') {
        await service.companyAdmins.manageAssignment({ portfolioId: selectedCompany.portfolioId, companyId: member.company_id ?? selectedCompany.id,
          newCompanyId: editCompanyId, userId: member.user_id, action: editor.action,
          reason: editReason.trim(), displayName: editName.trim() })
      } else if (member.scope_type === 'COMPANY') {
        await service.portfolioUsers.manageCompanyAssignment({ portfolioId: selectedCompany.portfolioId, companyId: member.company_id ?? selectedCompany.id,
          userId: member.user_id, currentRole: member.role as ManagedCompanyRole, action: editor.action,
          newRole: editRole as ManagedCompanyRole, reason: editReason.trim(), displayName: editName.trim() })
      } else throw new Error('Unsupported assignment scope')
      setNotice(editor.action === 'REACTIVATE' ? 'Role assignment was reactivated and audited.' : 'User assignment changes were saved and audited.')
      setEditor(null)
      await loadPortfolioMembers()
    } catch { setError('User changes were not saved. The server enforces company/branch scope, role hierarchy, and last-administrator protection.') }
    finally { setBusy(false) }
  }

  const assignmentActions = (member: PortfolioMemberRecord) => {
    if (!(canManagePortfolio || companyScopedAdministrator)) return []
    const inactive = member.assignment_status === 'INACTIVE' || member.revoked_at !== null
    if (inactive) return [
      { label: 'Edit assignment', onSelect: () => beginEdit(member) },
      { label: 'Reactivate', onSelect: () => void reactivateAssignment(member) },
    ]
    return [
      { label: 'Edit assignment', onSelect: () => beginEdit(member) },
      { label: 'Revoke role', tone: 'danger' as const, onSelect: () => void updateAssignmentStatus(member, 'REVOKE') },
      { label: 'Remove assignment', tone: 'danger' as const, onSelect: () => void updateAssignmentStatus(member, 'REMOVE') },
    ]
  }

  const companyAdminMember = (member: CompanyAdminRecord): PortfolioMemberRecord => ({
    ...member,
    branch_ids: [],
    scope_type: 'COMPANY',
    company_id: selectedCompany?.id,
    assignment_status: member.revoked_at ? 'INACTIVE' : 'ACTIVE',
  })

  const sendInvitation = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(''); setNotice('')
    if (!selectedCompany?.portfolioId) { setBusy(false); setError('Choose a company in the target portfolio first.'); return }
    if (companyScopedAdministrator && ['OVERALL_HR_MANAGER', 'PORTFOLIO_ADMIN', 'PORTFOLIO_COMPANY_ADMIN'].includes(inviteRole)) { setBusy(false); setError('Portfolio-wide administrator and HR access requires portfolio administrator authority.'); return }
    if (['BRANCH_MANAGER', 'PAYROLL_PROCESSOR'].includes(inviteRole) && inviteBranches.length === 0) { setBusy(false); setError('Select at least one branch for this role.'); return }
    try {
      const { data, error: invokeError } = await getSupabaseClient().functions.invoke('invite-user', { body: {
        email: inviteEmail.trim(), portfolioId: selectedCompany.portfolioId, role: inviteRole,
        companyId: ['OVERALL_HR_MANAGER', 'PORTFOLIO_ADMIN', 'PORTFOLIO_COMPANY_ADMIN'].includes(inviteRole) ? null : selectedCompany.id, branchIds: inviteBranches,
      } })
      if (invokeError) throw invokeError
      if (data?.invited !== true) {
        setError('The invitation service did not confirm that an invitation was created. Check the service response before retrying.')
        return
      }
      if (data?.accessAssigned !== true) {
        setError('The invitation email was sent, but role assignment did not complete. This account has no business access. Contact an authorized administrator to finish assignment after activation.')
        return
      }
      setInviteEmail(''); setInviteBranches([])
      setNotice(`Invitation sent to ${inviteEmail}. Scoped role access was assigned and remains unavailable until the user activates their account.`)
      await load(); await loadPortfolioMembers()
    } catch {
      setError('We could not confirm the invitation. Check your access, invitation settings, and approved return address before retrying.')
    } finally { setBusy(false) }
  }

  const assignPortfolioRole = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(''); setNotice('')
    if (!selectedCompany?.portfolioId || !userId.trim()) { setBusy(false); setError('Choose a company and enter an activated account UUID.'); return }
    const branchScoped = portfolioRole === 'BRANCH_MANAGER' || portfolioRole === 'PAYROLL_PROCESSOR'
    if (companyScopedAdministrator && !branchScoped) { setBusy(false); setError('Company administrators can assign only roles limited to their company and branches.'); return }
    if (branchScoped && selectedBranches.length === 0) { setBusy(false); setError('Select one or more branches for this role.'); return }
    try {
      const service = createLiveBusinessServices(getSupabaseClient()).portfolioUsers
      const existing = portfolioMembers.some((member) => member.user_id === userId.trim() && member.role === portfolioRole && !member.revoked_at)
      if (branchScoped && existing) await service.replaceBranchAssignments(selectedCompany.portfolioId, selectedCompany.id, userId.trim(), portfolioRole, selectedBranches)
      else await service.assign(selectedCompany.portfolioId, userId.trim(), portfolioRole, branchScoped ? selectedBranches : [])
      setNotice(`${portfolioRole.replaceAll('_', ' ')} assignment was saved and audited.`)
      setSelectedBranches([]); await loadPortfolioMembers()
    } catch { setError('Role assignment failed. Verify the account is activated, your portfolio-level users.manage access, and the selected active branches.') }
    finally { setBusy(false) }
  }

  return <div className="admin-screen live-user-admin">
    <header className="admin-page-heading"><div><div className="eyebrow"><span className="eyebrow-line"/> COMPANY ACCESS</div><h1>Users & permissions</h1><p>Manage administrator, HR and branch access for your authorized workspace.</p></div></header>
    <div className="live-data-notice"><ShieldCheck size={15}/> {companyScopedAdministrator ? 'This account can manage users assigned to this company and its branches.' : 'Role assignments remain limited to authorized company and branch scopes.'} Invitations send an email to the address entered.</div>
    {error && <div className="auth-shell-error" role="alert">{error}</div>}{notice && <div className="import-success" role="status">{notice}</div>}
    <section className="panel admin-table-panel"><header><div><div className="section-eyebrow">COMPANY SCOPE</div><h2>Choose a company</h2></div><label className="live-admin-company"><Building2 size={15}/><select aria-label="Company" value={companyId} onChange={(event) => setCompanyId(event.target.value)}><option value="">Select company</option>{companies.map((company) => <option value={company.id} key={company.id}>{company.name}</option>)}</select></label></header>
      {selectedCompany && <form className="live-admin-assign" onSubmit={(event) => void sendInvitation(event)}><label>Invite email address<input type="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="person@company.com" required /></label><label>Invitation access level<select value={inviteRole} onChange={(event) => { setInviteRole(event.target.value); setInviteBranches([]) }}>{canManagePortfolio && <><option value="PORTFOLIO_ADMIN">Portfolio Administrator</option><option value="PORTFOLIO_COMPANY_ADMIN">Company Administrator (all portfolio companies)</option><option value="OVERALL_HR_MANAGER">Overall HR Manager (portfolio-wide)</option></>}<option value="BRANCH_MANAGER">Branch Manager (selected branches)</option><option value="PAYROLL_PROCESSOR">Payroll Processor (selected branches)</option><option value="COMPANY_ADMIN">Company Administrator (selected company)</option></select></label>{['BRANCH_MANAGER', 'PAYROLL_PROCESSOR'].includes(inviteRole) && <fieldset className="live-branch-picker"><legend>Assigned branches</legend>{selectedCompany.branches.filter((branch) => branch.status === 'Active').map((branch) => <label key={branch.id}><input type="checkbox" checked={inviteBranches.includes(branch.id)} onChange={(event) => setInviteBranches((current) => event.target.checked ? [...current, branch.id] : current.filter((id) => id !== branch.id))}/>{branch.name}</label>)}</fieldset>}<button className="button-primary" disabled={busy}><UserPlus size={15}/>{busy ? 'Sending...' : 'Send invitation'}</button><small>The user receives an activation link. Role access is assigned only after the trusted function verifies your company or portfolio authority.</small></form>}
      {selectedCompany && <form className="live-admin-assign" onSubmit={(event) => void assign(event)}><label>Company Administrator account UUID<input value={userId} onChange={(event) => setUserId(event.target.value)} placeholder="Account ID" required minLength={36} maxLength={36} pattern="[0-9a-fA-F-]{36}" /></label><button className="button-primary" disabled={busy}><UserPlus size={15}/> {busy ? 'Saving...' : 'Assign Company Administrator'}</button><small>Use this only when the account is already activated and its invitation is complete.</small></form>}
      {loading ? <div className="employee-empty" role="status"><LoaderCircle size={16}/> Loading company access...</div> : members.length ? <div className="table-scroll"><table className="admin-table"><thead><tr><th>ACCOUNT</th><th>ROLE</th><th>ASSIGNED</th><th>STATUS</th><th>Actions</th></tr></thead><tbody>{members.map((member) => { const assignment = companyAdminMember(member); return <tr key={member.user_id}><td><strong>{member.display_name || 'Activated user'}</strong><small>{member.email || member.user_id}</small></td><td>{companyRoleLabel(member.role)}</td><td>{formatWorkspaceDate(member.created_at, preferences)}</td><td><StatusBadge status={member.revoked_at ? 'INACTIVE' : 'ACTIVE'}/></td><td><RowActionsMenu label={`${member.email || member.user_id} actions`} actions={assignmentActions(assignment).map((action) => ({ ...action, disabled: busy }))}/></td></tr> })}</tbody></table></div> : !error && <div className="employee-empty"><strong>No company administrator assignments</strong><span>No access assignments are available to display.</span></div>}
    </section>
    <section className="panel admin-table-panel live-portfolio-roles"><header><div><div className="section-eyebrow">COMPANY ADMINISTRATION</div><h2>HR and branch roles</h2><p>Assign authorized portfolio and branch roles.</p></div></header>
      {portfolioError ? <div className="auth-shell-error" role="status">{portfolioError}</div> : <>
        <form className="live-admin-assign" onSubmit={(event) => void assignPortfolioRole(event)}><label>User account UUID<input value={userId} onChange={(event) => setUserId(event.target.value)} placeholder="Account ID" required minLength={36} maxLength={36} pattern="[0-9a-fA-F-]{36}" /></label><label>Role access level<select value={portfolioRole} onChange={(event) => { setPortfolioRole(event.target.value as PortfolioMemberRecord['role']); setSelectedBranches([]) }}>{canManagePortfolio && <><option value="PORTFOLIO_ADMIN">Portfolio Administrator</option><option value="COMPANY_ADMIN">Company Administrator (all portfolio companies)</option><option value="OVERALL_HR_MANAGER">Overall HR Manager (portfolio-wide)</option></>}<option value="BRANCH_MANAGER">Branch Manager (selected branches)</option><option value="PAYROLL_PROCESSOR">Payroll Processor (selected branches)</option></select></label>{['BRANCH_MANAGER', 'PAYROLL_PROCESSOR'].includes(portfolioRole) && <fieldset className="live-branch-picker"><legend>Branches at {selectedCompany?.name ?? 'selected company'}</legend>{selectedCompany?.branches.filter((branch) => branch.status === 'Active').map((branch) => <label key={branch.id}><input type="checkbox" checked={selectedBranches.includes(branch.id)} onChange={(event) => setSelectedBranches((current) => event.target.checked ? [...current, branch.id] : current.filter((id) => id !== branch.id))}/>{branch.name}</label>)}</fieldset>}<button className="button-primary" disabled={busy}>Save role assignment</button><small>Overall HR Managers receive portfolio-wide access. Branch and payroll roles are limited to the selected company branches; the database enforces these boundaries.</small></form>
        {editor && <form className="panel live-assignment-editor" onSubmit={(event) => void saveAssignmentEdit(event)}>
          <header><div><div className="section-eyebrow">{editor.action === 'REACTIVATE' ? 'REACTIVATE ACCESS' : 'EDIT ACCESS'}</div><h3>{editor.member.email}</h3></div></header>
          <label>Display name<input value={editName} maxLength={120} onChange={(event) => setEditName(event.target.value)} required/></label>
          {editor.member.scope_type === 'PORTFOLIO' && <label>Portfolio role<select value={editRole} onChange={(event) => setEditRole(event.target.value)}><option value="PORTFOLIO_ADMIN">Portfolio Administrator</option><option value="COMPANY_ADMIN">Company Administrator (all portfolio companies)</option><option value="OVERALL_HR_MANAGER">Overall HR Manager</option></select></label>}
          {editor.member.scope_type === 'COMPANY' && editor.member.role !== 'COMPANY_ADMIN' && <label>Company role<select value={editRole} onChange={(event) => setEditRole(event.target.value)}><option value="COMPANY_PAYROLL_PREPARER">Payroll Preparer</option><option value="COMPANY_PAYROLL_REVIEWER">Payroll Reviewer</option><option value="COMPANY_PAYROLL_APPROVER">Payroll Approver</option><option value="COMPANY_ADMIN">Company Administrator</option></select></label>}
          {(editor.member.scope_type === 'COMPANY' || editor.member.scope_type === 'BRANCH') && <label>Company<select value={editCompanyId} onChange={(event) => { setEditCompanyId(event.target.value); setEditBranches([]) }}><option value="">Select company</option>{companies.filter((company) => company.portfolioId === selectedCompany?.portfolioId).map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select></label>}
          {editor.member.scope_type === 'BRANCH' && <><label>Branch role<select value={editRole} onChange={(event) => setEditRole(event.target.value)}><option value="BRANCH_MANAGER">Branch Manager</option><option value="PAYROLL_PROCESSOR">Payroll Processor</option></select></label><fieldset className="live-branch-picker"><legend>Assigned branches</legend>{companies.find((company) => company.id === editCompanyId)?.branches.filter((branch) => branch.status === 'Active').map((branch) => <label key={branch.id}><input type="checkbox" checked={editBranches.includes(branch.id)} onChange={(event) => setEditBranches((current) => event.target.checked ? [...current, branch.id] : current.filter((id) => id !== branch.id))}/>{branch.name}</label>)}</fieldset></>}
          <label>Reason for change<textarea value={editReason} maxLength={500} onChange={(event) => setEditReason(event.target.value)} required minLength={3}/></label>
          <footer><button type="button" className="button-secondary" disabled={busy} onClick={() => setEditor(null)}>Cancel</button><button className="button-primary" disabled={busy}>{busy ? 'Saving…' : editor.action === 'REACTIVATE' ? 'Reactivate assignment' : 'Save assignment'}</button></footer>
        </form>}
        <div className="table-scroll"><table className="admin-table"><thead><tr><th>ACCOUNT</th><th>ROLE</th><th>ASSIGNED BRANCHES</th><th>STATUS</th><th>Actions</th></tr></thead><tbody>{portfolioMembers.map((member) => <tr key={`${member.user_id}-${member.role}-${member.scope_type}`}><td><strong>{member.display_name || 'Activated user'}</strong><small>{member.email}</small></td><td>{portfolioRoleLabel(member.role)}</td><td>{member.scope_label ?? (member.branch_ids.length ? member.branch_ids.map((branchId) => companies.flatMap((company) => company.branches).find((branch) => branch.id === branchId)?.name ?? 'Branch unavailable').join(', ') : ['PORTFOLIO_ADMIN','COMPANY_ADMIN','OVERALL_HR_MANAGER'].includes(member.role) ? 'All authorized branches' : 'No branch assigned')}</td><td><StatusBadge status={member.assignment_status ?? (member.revoked_at ? 'INACTIVE' : 'ACTIVE')}/></td><td><RowActionsMenu label={`${member.email} ${member.role} actions`} actions={assignmentActions(member).map((action) => ({ ...action, disabled: busy }))}/></td></tr>)}</tbody></table></div>
      </>}
    </section>
    <div className="live-data-notice">Company access and branch assignments are managed here. Invitations require an approved return address.</div>
  </div>
}
