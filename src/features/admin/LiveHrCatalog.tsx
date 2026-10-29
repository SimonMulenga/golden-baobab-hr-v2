import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Building2, Check, Pencil, Plus, RefreshCw, ShieldCheck, UserRoundX } from 'lucide-react'
import { getSupabaseClient } from '../../lib/supabase/client'
import { createLiveHrServices, type DepartmentRecord, type JobRoleRecord } from '../../services/live-hr-services'
import { useWorkspace } from '../companies/WorkspaceContext'
import './live-hr-catalog.css'

type CatalogType = 'departments' | 'jobRoles'
type Draft = { id?: string; departmentId: string; name: string; code: string; description: string }
const emptyDraft: Draft = { departmentId: '', name: '', code: '', description: '' }

export function LiveHrCatalog({ type }: { type: CatalogType }) {
  const { companies, activeCompanyId } = useWorkspace()
  const [companyId, setCompanyId] = useState(activeCompanyId === 'all' ? (companies[0]?.id ?? '') : activeCompanyId)
  const [departments, setDepartments] = useState<DepartmentRecord[]>([])
  const [roles, setRoles] = useState<JobRoleRecord[]>([])
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [editing, setEditing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const departmentsMode = type === 'departments'
  const title = departmentsMode ? 'Departments' : 'Job roles'
  const selectedCompany = companies.find((company) => company.id === companyId)

  const load = useCallback(async () => {
    if (!companyId) { setDepartments([]); setRoles([]); setLoading(false); return }
    setLoading(true); setError('')
    try {
      const service = createLiveHrServices(getSupabaseClient()).catalog
      const [departmentRows, roleRows] = await Promise.all([service.departments(companyId), service.jobRoles(companyId)])
      setDepartments(departmentRows); setRoles(roleRows)
    } catch { setError('Company configuration is unavailable under your current permissions. Check access and retry.') }
    finally { setLoading(false) }
  }, [companyId])

  useEffect(() => { void load() }, [load])

  const reset = () => { setDraft(emptyDraft); setEditing(false) }
  const save = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(''); setNotice('')
    try {
      const catalog = createLiveHrServices(getSupabaseClient()).catalog
      if (!companyId) throw new Error('Choose a company first.')
      if (departmentsMode) await catalog.saveDepartment({ companyId, id: draft.id, name: draft.name.trim(), code: draft.code.trim(), description: draft.description.trim() })
      else await catalog.saveJobRole({ companyId, id: draft.id, departmentId: draft.departmentId || null, title: draft.name.trim(), code: draft.code.trim(), description: draft.description.trim() })
      reset(); setNotice(`${title.slice(0, -1)} saved to Supabase.`); await load()
    } catch { setError(`${title.slice(0, -1)} was not saved. Check the code/name for duplicates and confirm company configuration permission.`) }
    finally { setBusy(false) }
  }

  const edit = (item: DepartmentRecord | JobRoleRecord) => {
    const role = item as JobRoleRecord
    setDraft({ id: item.id, departmentId: 'department_id' in item ? role.department_id ?? '' : '', name: departmentsMode ? (item as DepartmentRecord).name : role.title, code: item.code, description: item.description })
    setEditing(true); setError(''); setNotice('')
  }
  const deactivate = async (id: string) => {
    if (!window.confirm(`Deactivate this ${departmentsMode ? 'department' : 'job role'}? Existing employee records and history will be preserved.`)) return
    setBusy(true); setError(''); setNotice('')
    try {
      const catalog = createLiveHrServices(getSupabaseClient()).catalog
      if (departmentsMode) await catalog.deactivateDepartment(id); else await catalog.deactivateJobRole(id)
      setNotice(`${departmentsMode ? 'Department' : 'Job role'} deactivated. Existing employee records remain unchanged.`); await load()
    } catch { setError(`This ${departmentsMode ? 'department' : 'job role'} could not be deactivated. Verify your company access and retry.`) }
    finally { setBusy(false) }
  }

  const activate = async (id: string) => {
    if (!departmentsMode) return
    setBusy(true); setError(''); setNotice('')
    try {
      await createLiveHrServices(getSupabaseClient()).catalog.activateDepartment(id)
      setNotice('Department activated. It is available for new employee assignments.'); await load()
    } catch { setError('This department could not be activated. Verify your company access and retry.') }
    finally { setBusy(false) }
  }

  const rows = departmentsMode ? departments : roles
  return <div className="live-hr-catalog">
    <header className="page-heading"><div><div className="eyebrow">HR CONFIGURATION</div><h1>{title}</h1><p>{departmentsMode ? 'Company-scoped teams used by employee profiles and imports.' : 'Company job titles linked to departments where needed.'}</p></div></header>
    <div className="live-data-notice"><ShieldCheck size={15}/> Changes are saved in Supabase, scoped to the selected company and recorded in the audit log.</div>
    <section className="panel live-hr-catalog-controls">
      <label>Company<select aria-label="Configuration company" value={companyId} onChange={(event) => { setCompanyId(event.target.value); reset(); setNotice('') }}><option value="">Select company</option>{companies.map((company) => <option value={company.id} key={company.id}>{company.name}</option>)}</select></label>
      {selectedCompany && <span><Building2 size={15}/>{selectedCompany.name}</span>}
      <button className="button-secondary" disabled={loading || busy || !companyId} onClick={() => void load()}><RefreshCw size={14}/> Refresh</button>
      <button className="button-primary" disabled={!companyId || busy} onClick={() => { reset(); setEditing(true) }}><Plus size={15}/> Add {departmentsMode ? 'department' : 'job role'}</button>
    </section>
    {error && <p className="live-error" role="alert">{error}</p>}{notice && <p className="live-notice" role="status">{notice}</p>}
    {editing && <form className="panel live-hr-catalog-form" onSubmit={(event) => void save(event)}>
      <header><div><div className="section-eyebrow">{draft.id ? 'EDIT ENTRY' : 'NEW ENTRY'}</div><h2>{draft.id ? 'Update' : 'Create'} {departmentsMode ? 'department' : 'job role'}</h2></div></header>
      {!departmentsMode && <label>Department (optional)<select value={draft.departmentId} onChange={(event) => setDraft({ ...draft, departmentId: event.target.value })}><option value="">Company-wide role</option>{departments.filter((item) => item.status === 'ACTIVE').map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
      <label>{departmentsMode ? 'Department name' : 'Job title'}<input required maxLength={120} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })}/></label>
      <label>Code<input required maxLength={24} value={draft.code} onChange={(event) => setDraft({ ...draft, code: event.target.value })}/></label>
      <label>Description<textarea rows={3} maxLength={1000} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })}/></label>
      <footer><button type="button" className="button-secondary" disabled={busy} onClick={reset}>Cancel</button><button className="button-primary" disabled={busy}><Check size={15}/>{busy ? 'Saving…' : 'Save changes'}</button></footer>
    </form>}
    <section className="panel live-hr-catalog-table">
      <header><div><div className="section-eyebrow">{selectedCompany?.name ?? 'COMPANY'}</div><h2>{rows.length} {title.toLowerCase()}</h2></div></header>
      {loading ? <div className="ops-empty" role="status">Loading authorized company configuration…</div> : !companyId ? <div className="ops-empty">Select a company to view its {title.toLowerCase()}.</div> : rows.length === 0 ? <div className="ops-empty">No {title.toLowerCase()} configured. Add the first one to use it in employee onboarding.</div> : <div className="table-scroll"><table className="peopleops-table"><thead><tr><th>{departmentsMode ? 'DEPARTMENT' : 'JOB TITLE'}</th><th>CODE</th>{!departmentsMode && <th>DEPARTMENT</th>}<th>DESCRIPTION</th><th>STATUS</th><th/></tr></thead><tbody>{rows.map((item) => { const role = item as JobRoleRecord; return <tr key={item.id}><td><strong>{departmentsMode ? (item as DepartmentRecord).name : role.title}</strong></td><td>{item.code}</td>{!departmentsMode && <td>{departments.find((department) => department.id === role.department_id)?.name ?? 'Company-wide'}</td>}<td>{item.description || '—'}</td><td><span className={`admin-status ${item.status === 'ACTIVE' ? 'active' : 'inactive'}`}>{item.status}</span></td><td><div className="live-hr-catalog-row-actions"><button className="ops-action" disabled={busy} onClick={() => edit(item)}><Pencil size={14}/> Edit</button>{item.status === 'ACTIVE' ? <button className="ops-action" disabled={busy} onClick={() => void deactivate(item.id)}><UserRoundX size={14}/> Deactivate</button> : departmentsMode && <button className="ops-action" disabled={busy} onClick={() => void activate(item.id)}><Check size={14}/> Activate</button>}</div></td></tr> })}</tbody></table></div>}
    </section>
  </div>
}
