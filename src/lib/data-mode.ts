export type DataMode = 'LIVE'

export function resolveDataMode(value: string | undefined, _productionBuild: boolean): DataMode {
  const normalized = value?.trim().toUpperCase()

  if (!normalized || normalized === 'LIVE') return 'LIVE'

  throw new Error(
    `VITE_DATA_MODE must be LIVE. Synthetic demo mode is not available in this application.`,
  )
}

/** The application always uses authenticated business data; demo records are test-only. */
export const dataMode = resolveDataMode(import.meta.env.VITE_DATA_MODE, import.meta.env.PROD)

export const isLiveMode = dataMode === 'LIVE'
