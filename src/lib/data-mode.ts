export type DataMode = 'MOCK' | 'LIVE'

export function resolveDataMode(value: string | undefined, productionBuild: boolean): DataMode {
  const normalized = value?.trim().toUpperCase()

  if (!normalized) return productionBuild ? 'LIVE' : 'MOCK'
  if (normalized === 'MOCK' && productionBuild) {
    throw new Error('MOCK data mode is disabled in production builds. Configure VITE_DATA_MODE=LIVE.')
  }
  if (normalized === 'MOCK' || normalized === 'LIVE') return normalized

  throw new Error(
    `Invalid VITE_DATA_MODE "${value}". Set it to MOCK or LIVE.`,
  )
}

/** Local development can opt into demo data; production builds fail closed to LIVE. */
export const dataMode = resolveDataMode(import.meta.env.VITE_DATA_MODE, import.meta.env.PROD)

export const isLiveMode = dataMode === 'LIVE'
