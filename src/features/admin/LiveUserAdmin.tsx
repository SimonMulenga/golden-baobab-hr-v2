import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Building2, LoaderCircle, ShieldCheck, UserPlus, UserRoundMinus } from 'lucide-react'
import { getSupabaseClient } from '../../lib/supabase/client'
import { createLiveBusinessServices, type CompanyAdminRecord, type CompanyPayrollApproverRecord, type CompanyPayrollPreparerRecord, type CompanyPayrollReviewerRecord, type PortfolioMemberRecord } from '../../services/live-business-services'
import { formatWorkspaceDate, useCompanySelection, useWorkspace } from '../companies/WorkspaceContext'
import './live-user-admin.css'
import './live-branch-picker.css'

export function LiveUserAdmin() {
  const { companies, preferences } = useWorkspace()
  const { companyId, setCompanyId } = useCompanySelection()
  const [members, setMembers] = useState<CompanyAdminRecord[]>([])
  const [payrollApprovers, setPayrollApprovers] = useState<CompanyPayrollApproverRecord[]>([])
  const [payrollPreparers, setPayrollPreparers] = useState<CompanyPayrollPreparerRecord[]>([])
  const [payrollReviewers, setPayrollReviewers] = useState<CompanyPayrollReviewerRecord[]>([])
  const [payrollApproverReady, setPayrollApproverReady] = useState(false)
  const [payrollPreparerReady, setPayrollPreparerReady] = useState(false)
  const [payrollReviewerReady, setPayrollReviewerReady] = useState(false)
  const [portfolioMembers, setPortfolioMembers] = useState<PortfolioMemberRecord[]>([])
  const [userId, setUserId] = useState('')
  const [portfolioRole, setPortfolioRole] = useState<PortfolioMemberRecord['role']>('BRANCH_MANAGER')
  const [selectedBranches, setSelectedBranches] = useState<string[]>([])
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('COMPANY_ADMIN')
  const [inviteBranches, setInviteBranches] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [portfolioError, setPortfolioError] = useState('')
  const selectedCompany = companies.find((company) => company.id === companyId) ?? (!companyId ? companies[0] : undefined)

  const load = useCallback(async () => {
    if (!selectedCompany?.portfolioId) { setMembers([]); setPayrollApprovers([]); setPayrollPreparers([]); setPayrollReviewers([]); setPayrollApproverReady(false); setPayrollPreparerReady(false); setPayrollReviewerReady(false); return }
    setLoading(true); setError('')
    try {
      const services = createLiveBusinessServices(getSupabaseClient())
      const admins = await services.companyAdmins.list(selectedCompany.portfolioId, selectedCompany.id)
      setMembers(admins)
      try {
        setPayrollApprovers(await services.companyPayrollApprovers.list(selectedCompany.portfolioId, selectedCompany.id))
        setPayrollApproverReady(true)
      } catch { setPayrollApprovers([]); setPayrollApproverReady(false) }
      try {
        setPayrollPreparers(await services.companyPayrollPreparers.list(selectedCompany.portfolioId, selectedCompany.id))
        setPayrollPreparerReady(true)
      } catch { setPayrollPreparers([]); setPayrollPreparerReady(false) }
      try {
        setPayrollReviewers(await services.companyPayrollReviewers.list(selectedCompany.portfolioId, selectedCompany.id))
        setPayrollReviewerReady(true)
      } catch { setPayrollReviewers([]); setPayrollReviewerReady(false) }
    } catch {
      setMembers([])
      setError('Company access could not be loaded. Your account may not have users.manage permission for this company.')
    } finally { setLoading(false) }
  }, [selectedCompany])

  const loadPortfolioMembers = useCallback(async () => {
    if (!selectedCompany?.portfolioId) { setPortfolioMembers([]); return }
    try {
      const result = await createLiveBusinessServices(getSupabaseClient()).portfolioUsers.list(selectedCompany.portfolioId)
      setPortfolioMembers(result); setPortfolioError('')
    } catch {
      setPortfolioMembers([]); setPortfolioError('Portfolio role administration is not authorized for this account.')
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

  const revoke = async (member: CompanyAdminRecord) => {
    if (!selectedCompany?.portfolioId) return
    const reason = window.prompt(`Reason for removing Company Administrator access for ${member.email ?? member.user_id}?`)
    if (!reason?.trim()) return
    setBusy(true); setError(''); setNotice('')
    try {
      await createLiveBusinessServices(getSupabaseClient()).companyAdmins.revoke(selectedCompany.portfolioId, selectedCompany.id, member.user_id, reason.trim())
      setNotice('Company access was revoked and the action was audited.')
      await load()
    } catch { setError('Access could not be revoked. Confirm your company-scoped user management permission and try again.') }
    finally { setBusy(false) }
  }

  const assignPayrollApprover = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(''); setNotice('')
    if (!selectedCompany?.portfolioId || !userId.trim()) { setBusy(false); setError("Select a company and enter an activated user's account UUID."); return }
    try {
      if (!payrollApproverReady) throw new Error('Company-scoped payroll approver migration is unavailable.')
      await createLiveBusinessServices(getSupabaseClient()).companyPayrollApprovers.assign(selectedCompany.portfolioId, selectedCompany.id, userId.trim())
      setUserId(''); setNotice('Company-scoped Payroll Approver access was assigned and audited.'); await load()
    } catch { setError('Payroll approver access was not assigned. Verify the activated account and company-scoped users.manage permission.') }
    finally { setBusy(false) }
  }

  const revokePayrollApprover = async (member: CompanyPayrollApproverRecord) => {
    if (!selectedCompany?.portfolioId) return
    const reason = window.prompt(`Reason for removing company payroll approval access for ${member.email ?? member.user_id}?`)
    if (!reason?.trim()) return
    setBusy(true); setError(''); setNotice('')
    try {
      if (!payrollApproverReady) throw new Error('Company-scoped payroll approver migration is unavailable.')
      await createLiveBusinessServices(getSupabaseClient()).companyPayrollApprovers.revoke(selectedCompany.portfolioId, selectedCompany.id, member.user_id, reason.trim())
      setNotice('Company payroll approval access was revoked and audited.'); await load()
    } catch { setError('Payroll approver access could not be revoked. Verify company-scoped users.manage permission.') }
    finally { setBusy(false) }
  }

  const assignPayrollReviewer = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(''); setNotice('')
    if (!selectedCompany?.portfolioId || !userId.trim()) { setBusy(false); setError("Select a company and enter an activated user's account UUID."); return }
    try {
      if (!payrollReviewerReady) throw new Error('Company-scoped payroll reviewer migration is unavailable.')
      await createLiveBusinessServices(getSupabaseClient()).companyPayrollReviewers.assign(selectedCompany.portfolioId, selectedCompany.id, userId.trim())
      setUserId(''); setNotice('Company-scoped Payroll Reviewer access was assigned and audited.'); await load()
    } catch { setError('Payroll reviewer access was not assigned. Verify the activated account and company-scoped users.manage permission.') }
    finally { setBusy(false) }
  }

  const revokePayrollReviewer = async (member: CompanyPayrollReviewerRecord) => {
    if (!selectedCompany?.portfolioId) return
    const reason = window.prompt(`Reason for removing company payroll reviewer access for ${member.email ?? member.user_id}?`)
    if (!reason?.trim()) return
    setBusy(true); setError(''); setNotice('')
    try {
      if (!payrollReviewerReady) throw new Error('Company-scoped payroll reviewer migration is unavailable.')
      await createLiveBusinessServices(getSupabaseClient()).companyPayrollReviewers.revoke(selectedCompany.portfolioId, selectedCompany.id, member.user_id, reason.trim())
      setNotice('Company payroll reviewer access was revoked and audited.'); await load()
    } catch { setError('Payroll reviewer access could not be revoked. Verify company-scoped users.manage permission.') }
    finally { setBusy(false) }
  }

  const assignPayrollPreparer = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(''); setNotice('')
    if (!selectedCompany?.portfolioId || !userId.trim()) { setBusy(false); setError("Select a company and enter an activated user's account UUID."); return }
    try {
      if (!payrollPreparerReady) throw new Error('Company-scoped payroll preparer migration is unavailable.')
      await createLiveBusinessServices(getSupabaseClient()).companyPayrollPreparers.assign(selectedCompany.portfolioId, selectedCompany.id, userId.trim())
      setUserId(''); setNotice('Company-scoped HR/payroll preparer access was assigned and audited.'); await load()
    } catch { setError('Payroll preparer access was not assigned. Verify the activated account and company-scoped users.manage permission.') }
    finally { setBusy(false) }
  }

  const revokePayrollPreparer = async (member: CompanyPayrollPreparerRecord) => {
    if (!selectedCompany?.portfolioId) return
    const reason = window.prompt(`Reason for removing HR/payroll preparer access for ${member.email ?? member.user_id}?`)
    if (!reason?.trim()) return
    setBusy(true); setError(''); setNotice('')
    try {
      if (!payrollPreparerReady) throw new Error('Company-scoped payroll preparer migration is unavailable.')
      await createLiveBusinessServices(getSupabaseClient()).companyPayrollPreparers.revoke(selectedCompany.portfolioId, selectedCompany.id, member.user_id, reason.trim())
      setNotice('Company HR/payroll preparer access was revoked and audited.'); await load()
    } catch { setError('Payroll preparer access could not be revoked. Verify company-scoped users.manage permission.') }
    finally { setBusy(false) }
  }

  const sendInvitation = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(''); setNotice('')
    if (!selectedCompany?.portfolioId) { setBusy(false); setError('Choose a company in the target portfolio first.'); return }
    if (['BRANCH_MANAGER', 'PAYROLL_PROCESSOR'].includes(inviteRole) && inviteBranches.length === 0) { setBusy(false); setError('Select at least one branch for this role.'); return }
    try {
      const { data, error: invokeError } = await getSupabaseClient().functions.invoke('invite-user', { body: {
        email: inviteEmail.trim(), portfolioId: selectedCompany.portfolioId, role: inviteRole,
        companyId: selectedCompany.id, branchIds: inviteBranches,
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

  const revokePortfolioRole = async (member: PortfolioMemberRecord) => {
    if (!selectedCompany?.portfolioId) return
    const reason = window.prompt(`Revoke ${member.role.replaceAll('_', ' ')} from ${member.email}? This also revokes all branch assignments for this portfolio role.`)
    if (!reason?.trim()) return
    setBusy(true); setError('')
    try {
      await createLiveBusinessServices(getSupabaseClient()).portfolioUsers.revoke(selectedCompany.portfolioId, member.user_id, member.role, reason.trim())
      setNotice('Role and branch access were revoked and audited.'); await loadPortfolioMembers()
    } catch { setError('The portfolio role could not be revoked. Check your access and retry.') }
    finally { setBusy(false) }
  }

  return <div className="admin-screen live-user-admin">
    <header className="admin-page-heading"><div><div className="eyebrow"><span className="eyebrow-line"/> COMPANY ACCESS</div><h1>Users & permissions</h1><p>Manage administrators and payroll roles for the selected company.</p></div></header>
    <div className="live-data-notice"><ShieldCheck size={15}/> Roles are limited to the selected company and assigned branches. Platform administrator access is managed separately. Invitations send a real email; use this only for a confirmed recipient.</div>
    {error && <div className="auth-shell-error" role="alert">{error}</div>}{notice && <div className="import-success" role="status">{notice}</div>}
    <section className="panel admin-table-panel"><header><div><div className="section-eyebrow">COMPANY SCOPE</div><h2>Choose a company</h2></div><label className="live-admin-company"><Building2 size={15}/><select aria-label="Company" value={companyId} onChange={(event) => setCompanyId(event.target.value)}><option value="">Select company</option>{companies.map((company) => <option value={company.id} key={company.id}>{company.name}</option>)}</select></label></header>
      {selectedCompany && <form className="live-admin-assign" onSubmit={(event) => void sendInvitation(event)}><label>Invite email address<input type="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="person@company.com" required /></label><label>Role<select value={inviteRole} onChange={(event) => { setInviteRole(event.target.value); setInviteBranches([]) }}><option value="COMPANY_ADMIN">Company Administrator</option><option value="OVERALL_HR_MANAGER">Overall HR Manager</option><option value="BRANCH_MANAGER">Branch Manager</option><option value="PAYROLL_PROCESSOR">Payroll Processor</option><option value="PORTFOLIO_ADMIN">Portfolio Administrator</option></select></label>{['BRANCH_MANAGER', 'PAYROLL_PROCESSOR'].includes(inviteRole) && <fieldset className="live-branch-picker"><legend>Assigned branches</legend>{selectedCompany.branches.filter((branch) => branch.status === 'Active').map((branch) => <label key={branch.id}><input type="checkbox" checked={inviteBranches.includes(branch.id)} onChange={(event) => setInviteBranches((current) => event.target.checked ? [...current, branch.id] : current.filter((id) => id !== branch.id))}/>{branch.name}</label>)}</fieldset>}<button className="button-primary" disabled={busy}><UserPlus size={15}/>{busy ? 'Sending…' : 'Send invitation'}</button><small>The user receives an activation link. Role access is assigned only after the trusted function verifies your company or portfolio authority.</small></form>}
      {selectedCompany && <form className="live-admin-assign" onSubmit={(event) => void assign(event)}><label>Company administrator account UUID<input value={userId} onChange={(event) => setUserId(event.target.value)} placeholder="Account ID" required minLength={36} maxLength={36} pattern="[0-9a-fA-F-]{36}" /></label><button className="button-primary" disabled={busy}><UserPlus size={15}/>{busy ? 'Saving…' : 'Assign Company Administrator'}</button><small>Use this only when the account is already activated and its invitation is complete.</small></form>}
      {selectedCompany && <form className="live-admin-assign" onSubmit={(event) => void assignPayrollApprover(event)}><label>Company payroll approver account UUID<input value={userId} onChange={(event) => setUserId(event.target.value)} placeholder="Account ID" required minLength={36} maxLength={36} pattern="[0-9a-fA-F-]{36}" /></label><button className="button-primary" disabled={busy || !payrollApproverReady}><ShieldCheck size={15}/>{busy ? 'Saving…' : 'Assign Company Payroll Approver'}</button><small>{payrollApproverReady ? `This existing role is limited to ${selectedCompany.name} and includes payroll finalization. Use Payroll Reviewer for approval without finalization.` : 'Role assignment is disabled until the company-scoped approver migration is available.'}</small></form>}
      {selectedCompany && <form className="live-admin-assign" onSubmit={(event) => void assignPayrollPreparer(event)}><label>Company HR/payroll preparer account UUID<input value={userId} onChange={(event) => setUserId(event.target.value)} placeholder="Account ID" required minLength={36} maxLength={36} pattern="[0-9a-fA-F-]{36}" /></label><button className="button-primary" disabled={busy || !payrollPreparerReady}><UserPlus size={15}/>{busy ? 'Saving…' : 'Assign Company HR/Payroll Preparer'}</button><small>{payrollPreparerReady ? `Can manage HR and payroll preparation for ${selectedCompany.name}; cannot approve or finalize payroll.` : 'Role assignment is disabled until the company-scoped preparer migration is available.'}</small></form>}
      {selectedCompany && <form className="live-admin-assign" onSubmit={(event) => void assignPayrollReviewer(event)}><label>Company payroll reviewer account UUID<input value={userId} onChange={(event) => setUserId(event.target.value)} placeholder="Account ID" required minLength={36} maxLength={36} pattern="[0-9a-fA-F-]{36}" /></label><button className="button-primary" disabled={busy || !payrollReviewerReady}><ShieldCheck size={15}/>{busy ? 'Saving…' : 'Assign Company Payroll Reviewer'}</button><small>{payrollReviewerReady ? `Can view, review and approve payroll for ${selectedCompany.name}; cannot prepare, submit, or finalize payroll.` : 'Role assignment is disabled until the restricted payroll reviewer migration is available.'}</small></form>}
      {payrollReviewers.length > 0 && <div className="table-scroll"><table className="admin-table"><thead><tr><th>COMPANY PAYROLL REVIEWER</th><th>ASSIGNED</th><th>STATUS</th><th/></tr></thead><tbody>{payrollReviewers.map((member) => <tr key={member.user_id}><td><strong>{member.display_name || 'Activated user'}</strong><small>{member.email}</small></td><td>{formatWorkspaceDate(member.created_at, preferences)}</td><td><span className={`admin-status ${member.revoked_at ? 'inactive' : 'active'}`}>{member.revoked_at ? 'Revoked' : 'Active'}</span></td><td>{!member.revoked_at && <button className="admin-link" disabled={busy} onClick={() => void revokePayrollReviewer(member)}><UserRoundMinus size={14}/> Revoke reviewer role</button>}</td></tr>)}</tbody></table></div>}
      {payrollPreparers.length > 0 && <div className="table-scroll"><table className="admin-table"><thead><tr><th>COMPANY HR/PAYROLL PREPARER</th><th>ASSIGNED</th><th>STATUS</th><th/></tr></thead><tbody>{payrollPreparers.map((member) => <tr key={member.user_id}><td><strong>{member.display_name || 'Activated user'}</strong><small>{member.email}</small></td><td>{formatWorkspaceDate(member.created_at, preferences)}</td><td><span className={`admin-status ${member.revoked_at ? 'inactive' : 'active'}`}>{member.revoked_at ? 'Revoked' : 'Active'}</span></td><td>{!member.revoked_at && <button className="admin-link" disabled={busy} onClick={() => void revokePayrollPreparer(member)}><UserRoundMinus size={14}/> Revoke preparer role</button>}</td></tr>)}</tbody></table></div>}
      {payrollApprovers.length > 0 && <div className="table-scroll"><table className="admin-table"><thead><tr><th>COMPANY PAYROLL APPROVER</th><th>ASSIGNED</th><th>STATUS</th><th/></tr></thead><tbody>{payrollApprovers.map((member) => <tr key={member.user_id}><td><strong>{member.display_name || 'Activated user'}</strong><small>{member.email}</small></td><td>{formatWorkspaceDate(member.created_at, preferences)}</td><td><span className={`admin-status ${member.revoked_at ? 'inactive' : 'active'}`}>{member.revoked_at ? 'Revoked' : 'Active'}</span></td><td>{!member.revoked_at && <button className="admin-link" disabled={busy} onClick={() => void revokePayrollApprover(member)}><UserRoundMinus size={14}/> Revoke approval role</button>}</td></tr>)}</tbody></table></div>}
      {loading ? <div className="employee-empty" role="status"><LoaderCircle size={16}/> Loading company access…</div> : members.length ? <div className="table-scroll"><table className="admin-table"><thead><tr><th>ACCOUNT</th><th>ROLE</th><th>ASSIGNED</th><th>STATUS</th><th/></tr></thead><tbody>{members.map((member) => <tr key={member.user_id}><td><strong>{member.display_name || 'Activated user'}</strong><small>{member.email || member.user_id}</small></td><td>{member.role.replaceAll('_', ' ')}</td><td>{formatWorkspaceDate(member.created_at, preferences)}</td><td><span className={`admin-status ${member.revoked_at ? 'inactive' : 'active'}`}>{member.revoked_at ? 'Revoked' : 'Active'}</span></td><td>{!member.revoked_at && <button className="admin-link" disabled={busy} onClick={() => void revoke(member)}><UserRoundMinus size={14}/> Remove access</button>}</td></tr>)}</tbody></table></div> : !error && <div className="employee-empty"><strong>No company administrator assignments</strong><span>No access assignments are available to display.</span></div>}
    </section>
    <section className="panel admin-table-panel live-portfolio-roles"><header><div><div className="section-eyebrow">PORTFOLIO SCOPE</div><h2>HR and branch roles</h2><p>Portfolio Administrator, Overall HR, Branch Manager, and Payroll Processor access.</p></div></header>
      {portfolioError ? <div className="auth-shell-error" role="status">{portfolioError}</div> : <>
        <form className="live-admin-assign" onSubmit={(event) => void assignPortfolioRole(event)}><label>Portfolio role account UUID<input value={userId} onChange={(event) => setUserId(event.target.value)} placeholder="Account ID" required minLength={36} maxLength={36} pattern="[0-9a-fA-F-]{36}" /></label><label>Portfolio role<select value={portfolioRole} onChange={(event) => { setPortfolioRole(event.target.value as PortfolioMemberRecord['role']); setSelectedBranches([]) }}><option value="OVERALL_HR_MANAGER">Overall HR Manager</option><option value="BRANCH_MANAGER">Branch Manager</option><option value="PAYROLL_PROCESSOR">Payroll Processor</option><option value="PORTFOLIO_ADMIN">Portfolio Administrator</option></select></label>{['BRANCH_MANAGER','PAYROLL_PROCESSOR'].includes(portfolioRole) && <fieldset className="live-branch-picker"><legend>Branches at {selectedCompany?.name ?? 'selected company'}</legend>{selectedCompany?.branches.filter((branch) => branch.status === 'Active').map((branch) => <label key={branch.id}><input type="checkbox" checked={selectedBranches.includes(branch.id)} onChange={(event) => setSelectedBranches((current) => event.target.checked ? [...current, branch.id] : current.filter((id) => id !== branch.id))}/>{branch.name}</label>)}</fieldset>}<button className="button-primary" disabled={busy}>Save role assignment</button><small>Branch roles require explicit active branch assignments. The database enforces separation between portfolio and branch permissions.</small></form>
        <div className="table-scroll"><table className="admin-table"><thead><tr><th>ACCOUNT</th><th>ROLE</th><th>BRANCH SCOPE</th><th>STATUS</th><th/></tr></thead><tbody>{portfolioMembers.map((member) => <tr key={`${member.user_id}-${member.role}`}><td><strong>{member.display_name || 'Activated user'}</strong><small>{member.email}</small></td><td>{member.role.replaceAll('_',' ')}</td><td>{member.branch_ids.length ? member.branch_ids.map((branchId) => companies.flatMap((company) => company.branches).find((branch) => branch.id === branchId)?.name ?? 'Branch unavailable').join(', ') : 'Portfolio-wide'}</td><td><span className={`admin-status ${member.revoked_at ? 'inactive' : 'active'}`}>{member.revoked_at ? 'Revoked' : 'Active'}</span></td><td>{!member.revoked_at && <button className="admin-link" disabled={busy} onClick={() => void revokePortfolioRole(member)}><UserRoundMinus size={14}/> Revoke role</button>}</td></tr>)}</tbody></table></div>
      </>}
    </section>
    <div className="live-data-notice">Portfolio roles and branch access are managed separately. Invitations require an approved return address.</div>
  </div>
}
