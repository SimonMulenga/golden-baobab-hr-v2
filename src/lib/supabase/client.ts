import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { dataMode } from '../data-mode'

function requireLiveConfiguration(): { url: string; publishableKey: string } {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim()
  const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()

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

  if (/^sb_secret_/i.test(publishableKey) || /service[_-]?role/i.test(publishableKey)) {
    throw new Error(
      'VITE_SUPABASE_PUBLISHABLE_KEY must be a browser-safe publishable/anon key, never a secret or service-role key.',
    )
  }

  return { url: parsedUrl.toString().replace(/\/$/, ''), publishableKey }
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
