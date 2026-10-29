import type { SupabaseClient } from '@supabase/supabase-js'

export type WorkspaceSettingsRecord = {
  portfolio_id: string; company_id: string; timezone: string; date_format: 'DD/MM/YYYY' | 'YYYY-MM-DD'
  currency_code: 'ZMW'; payroll_cutoff_day: number; updated_by: string; updated_at: string
}
export type UserNotificationRecord = {
  id: string; portfolio_id: string; company_id: string; branch_id: string | null; recipient_id: string
  source_type: 'EMPLOYEE' | 'LEAVE' | 'ATTENDANCE' | 'PAYROLL'; source_id: string; transition: string
  title: string; message: string; action_path: string; created_at: string; read_at: string | null
}

function assertNoError(error: unknown): void { if (error) throw error }

export function createLiveOperationsServices(client: SupabaseClient) {
  return {
    notifications: {
      async list(input: { page: number; unreadOnly: boolean; pageSize?: number }): Promise<{ items: UserNotificationRecord[]; total: number; unreadTotal: number }> {
        const size = Math.min(100, Math.max(1, input.pageSize ?? 25))
        const first = (Math.max(1, input.page) - 1) * size
        let query = client.from('user_notifications').select('id,portfolio_id,company_id,branch_id,recipient_id,source_type,source_id,transition,title,message,action_path,created_at,read_at', { count: 'exact' }).order('created_at', { ascending: false }).range(first, first + size - 1)
        if (input.unreadOnly) query = query.is('read_at', null)
        const response = await query
        assertNoError(response.error)
        const unread = await client.from('user_notifications').select('id', { count: 'exact', head: true }).is('read_at', null)
        assertNoError(unread.error)
        return { items: (response.data ?? []) as UserNotificationRecord[], total: response.count ?? 0, unreadTotal: unread.count ?? 0 }
      },
      async unreadCount(): Promise<number> {
        const response = await client.from('user_notifications').select('id', { count: 'exact', head: true }).is('read_at', null)
        assertNoError(response.error)
        return response.count ?? 0
      },
      async setRead(id: string, read: boolean): Promise<void> {
        const response = await client.from('user_notifications').update({ read_at: read ? new Date().toISOString() : null }).eq('id', id)
        assertNoError(response.error)
        if (typeof window !== 'undefined') window.dispatchEvent(new Event('gbhr-notifications-changed'))
      },
      async setManyRead(ids: string[], read: boolean): Promise<void> {
        if (!ids.length) return
        const response = await client.from('user_notifications').update({ read_at: read ? new Date().toISOString() : null }).in('id', ids)
        assertNoError(response.error)
        if (typeof window !== 'undefined') window.dispatchEvent(new Event('gbhr-notifications-changed'))
      },
    },
    settings: {
      async get(companyId: string): Promise<WorkspaceSettingsRecord | null> {
        const response = await client.from('company_workspace_settings').select('portfolio_id,company_id,timezone,date_format,currency_code,payroll_cutoff_day,updated_by,updated_at').eq('company_id', companyId).maybeSingle()
        assertNoError(response.error)
        return response.data as WorkspaceSettingsRecord | null
      },
      async save(input: { companyId: string; timezone: string; dateFormat: WorkspaceSettingsRecord['date_format']; currencyCode: 'ZMW'; payrollCutoffDay: number }): Promise<string> {
        const response = await client.rpc('company_workspace_settings_save', {
          p_company_id: input.companyId, p_timezone: input.timezone, p_date_format: input.dateFormat,
          p_currency_code: input.currencyCode, p_payroll_cutoff_day: input.payrollCutoffDay,
        })
        assertNoError(response.error)
        if (typeof response.data !== 'string') throw new Error('Workspace settings save returned no company reference.')
        return response.data
      },
    },
  }
}
