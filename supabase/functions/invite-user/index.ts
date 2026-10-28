import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = { 'Content-Type': 'application/json', 'Vary': 'Origin' }
const allowedRoles = ['PORTFOLIO_ADMIN', 'OVERALL_HR_MANAGER', 'BRANCH_MANAGER', 'PAYROLL_PROCESSOR'] as const
type PortfolioRole = typeof allowedRoles[number]

function response(status: number, body: Record<string, unknown>, origin?: string) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, ...(origin ? { 'Access-Control-Allow-Origin': origin } : {}) } })
}

Deno.serve(async (request) => {
  const origin = request.headers.get('origin') ?? ''
  const approvedOrigins = (Deno.env.get('APPROVED_APP_ORIGINS') ?? '').split(',').map((value) => value.trim()).filter(Boolean)
  if (!approvedOrigins.includes(origin)) return response(403, { error: 'This application origin is not approved for invitations.' })
  if (request.method === 'OPTIONS') return new Response('ok', { headers: { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'authorization, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Vary': 'Origin' } })
  if (request.method !== 'POST') return response(405, { error: 'Method not allowed.' }, origin)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const authorization = request.headers.get('authorization')
  if (!supabaseUrl || !anonKey || !serviceKey || !authorization?.startsWith('Bearer ')) return response(401, { error: 'Authenticated invitation service is unavailable.' }, origin)

  let body: { email?: string; portfolioId?: string; role?: string; companyId?: string; branchIds?: string[] }
  try { body = await request.json() } catch { return response(400, { error: 'Invalid request body.' }, origin) }
  const email = body.email?.trim().toLowerCase() ?? ''
  const portfolioId = body.portfolioId ?? ''
  const role = body.role ?? ''
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !portfolioId) return response(400, { error: 'A valid email and portfolio are required.' }, origin)
  if (role !== 'COMPANY_ADMIN' && !allowedRoles.includes(role as PortfolioRole)) return response(400, { error: 'This role cannot be invited through the workspace.' }, origin)
  if (role === 'COMPANY_ADMIN' && !body.companyId) return response(400, { error: 'Choose a company for this invitation.' }, origin)
  const branchScoped = role === 'BRANCH_MANAGER' || role === 'PAYROLL_PROCESSOR'
  if (branchScoped && (!Array.isArray(body.branchIds) || body.branchIds.length === 0 || body.branchIds.some((id) => typeof id !== 'string'))) return response(400, { error: 'Choose at least one branch for this role.' }, origin)

  const caller = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } })
  const { data: actorData, error: actorError } = await caller.auth.getUser()
  if (actorError || !actorData.user) return response(401, { error: 'Your session is no longer valid. Sign in again.' }, origin)
  const preflight = await caller.rpc('authorize_member_invitation', {
    p_portfolio_id: portfolioId, p_role: role, p_company_id: body.companyId ?? null,
  })
  if (preflight.error) return response(403, { error: 'You are not authorized to invite users in this scope.' }, origin)

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const redirectTo = `${origin}/auth/activate`
  const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo })
  if (inviteError || !invited.user) return response(400, { error: 'Invitation could not be created. Check whether the account already exists and try assigning its activated account instead.' }, origin)

  const membership = role === 'COMPANY_ADMIN'
    ? await caller.rpc('assign_company_admin', { p_portfolio_id: portfolioId, p_company_id: body.companyId, p_user_id: invited.user.id })
    : await caller.rpc('assign_portfolio_membership', { p_portfolio_id: portfolioId, p_user_id: invited.user.id, p_role: role, p_branch_ids: branchScoped ? body.branchIds : [] })
  if (membership.error) {
    // The Auth invitation exists and was sent, but no business access was granted.
    return response(200, { invited: true, accessAssigned: false, userId: invited.user.id, error: 'Invitation was sent but role assignment did not complete. The account has no business access; an authorized administrator must assign access after activation.' }, origin)
  }
  return response(200, { invited: true, accessAssigned: true, userId: invited.user.id, role }, origin)
})

