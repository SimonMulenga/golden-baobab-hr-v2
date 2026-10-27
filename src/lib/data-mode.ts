export type DataMode = 'MOCK' | 'LIVE'

function resolveDataMode(value: string | undefined): DataMode {
  const normalized = value?.trim().toUpperCase()

  if (!normalized) return 'MOCK'
  if (normalized === 'MOCK' || normalized === 'LIVE') return normalized

  throw new Error(
    `Invalid VITE_DATA_MODE "${value}". Set it to MOCK or LIVE.`,
  )
}

/** Defaults to MOCK so the existing demo works without backend configuration. */
export const dataMode = resolveDataMode(import.meta.env.VITE_DATA_MODE)

export const isLiveMode = dataMode === 'LIVE'
