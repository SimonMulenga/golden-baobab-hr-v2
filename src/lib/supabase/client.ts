import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { dataMode } from '../data-mode'

export function validateSupabaseConfiguration(
  configuredUrl: string | undefined,
  configuredKey: string | undefined,
): { url: string; publishableKey: string } {
  const url = configuredUrl?.trim()
  const publishableKey = configuredKey?.trim()
  if (!url || !publishableKey) {
    throw new Error(
      'LIVE data mode requires VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY. Add them to your local environment before starting the app.',
    )
  }

  let parsedUrl: URL
  try {
    parsedUrl = new URL(url)
  } catch {
    throw new Error('VITE_SUPABASE_URL must be a valid absolute URL.')
  }

  const isLocalHost = ['localhost', '127.0.0.1'].includes(parsedUrl.hostname)
  if (parsedUrl.protocol !== 'https:' && !(isLocalHost && parsedUrl.protocol === 'http:')) {
    throw new Error('VITE_SUPABASE_URL must use HTTPS (HTTP is allowed for localhost).')
  }

  const isPublishable = /^sb_publishable_.+/i.test(publishableKey)
  let jwtRole: string | undefined
  const jwtParts = publishableKey.split('.')
  if (jwtParts.length === 3) {
    try {
      const payload = JSON.parse(atob(jwtParts[1].replaceAll('-', '+').replaceAll('_', '/'))) as { role?: unknown }
      if (typeof payload.role === 'string') jwtRole = payload.role
    } catch {
      throw new Error('VITE_SUPABASE_PUBLISHABLE_KEY is not a valid publishable or anon key.')
    }
  }

  if (/^sb_secret_/i.test(publishableKey) || jwtRole === 'service_role' || /service[_-]?role/i.test(publishableKey)) {
    throw new Error(
      'VITE_SUPABASE_PUBLISHABLE_KEY must be a browser-safe publishable/anon key, never a secret or service-role key.',
    )
  }
  if (!isPublishable && jwtRole !== 'anon') {
    throw new Error('VITE_SUPABASE_PUBLISHABLE_KEY must be a Supabase publishable key or a legacy anon JWT.')
  }

  return { url: parsedUrl.toString().replace(/\/$/, ''), publishableKey }
}

function requireLiveConfiguration(): { url: string; publishableKey: string } {
  return validateSupabaseConfiguration(
    import.meta.env.VITE_SUPABASE_URL,
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  )
}

// No client is created in MOCK mode. In LIVE mode, invalid or missing settings
// fail immediately; there is deliberately no mock fallback.
export const supabaseClient: SupabaseClient | null = dataMode === 'LIVE'
  ? (() => {
      const { url, publishableKey } = requireLiveConfiguration()
      return createClient(url, publishableKey)
    })()
  : null

export function getSupabaseClient(): SupabaseClient {
  if (!supabaseClient) {
    throw new Error('Supabase is unavailable while VITE_DATA_MODE=MOCK.')
  }
  return supabaseClient
}
