import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }> }
type PwaContextValue = {
  installAvailable: boolean
  installed: boolean
  updateAvailable: boolean
  install: () => Promise<'accepted' | 'dismissed' | 'instructions'>
  applyUpdate: () => void
}

const PwaContext = createContext<PwaContextValue | null>(null)

export function PwaProvider({ children }: { children: ReactNode }) {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null)
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null)
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const [installed, setInstalled] = useState(false)
  const updateRequested = useRef(false)

  useEffect(() => {
    let mounted = true
    let activeRegistration: ServiceWorkerRegistration | null = null
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void activeRegistration?.update().catch(() => undefined)
    }
    const media = window.matchMedia?.('(display-mode: standalone)')
    const standalone = () => (media?.matches ?? false) || (navigator as Navigator & { standalone?: boolean }).standalone === true
    setInstalled(standalone())
    const onDisplayMode = () => setInstalled(standalone())
    media?.addEventListener?.('change', onDisplayMode)

    const onInstallPrompt = (event: Event) => {
      event.preventDefault()
      setPrompt(event as InstallPrompt)
    }
    const onInstalled = () => { setInstalled(true); setPrompt(null) }
    window.addEventListener('beforeinstallprompt', onInstallPrompt)
    window.addEventListener('appinstalled', onInstalled)

    const onUpdateFound = () => {
      const worker = activeRegistration?.installing
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) setUpdateAvailable(true)
      })
    }
    const onControllerChange = () => { if (updateRequested.current) window.location.reload() }
    if ('serviceWorker' in navigator && window.isSecureContext && import.meta.env.PROD) {
      document.addEventListener('visibilitychange', onVisibilityChange)
      navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)
      void navigator.serviceWorker.register('/service-worker.js', { scope: '/' }).then((nextRegistration) => {
        if (!mounted) return
        activeRegistration = nextRegistration
        setRegistration(nextRegistration)
        if (nextRegistration.waiting && navigator.serviceWorker.controller) setUpdateAvailable(true)
        nextRegistration.addEventListener('updatefound', onUpdateFound)
      }).catch(() => undefined)
    }
    return () => {
      mounted = false
      media?.removeEventListener?.('change', onDisplayMode)
      window.removeEventListener('beforeinstallprompt', onInstallPrompt)
      window.removeEventListener('appinstalled', onInstalled)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)
        activeRegistration?.removeEventListener('updatefound', onUpdateFound)
      }
    }
  }, [])

  const install = useCallback(async (): Promise<'accepted' | 'dismissed' | 'instructions'> => {
    if (!prompt) return 'instructions'
    await prompt.prompt()
    const result = await prompt.userChoice
    setPrompt(null)
    if (result.outcome === 'accepted') setInstalled(true)
    return result.outcome
  }, [prompt])

  const applyUpdate = useCallback(() => {
    if (!registration?.waiting) return
    updateRequested.current = true
    registration.waiting.postMessage({ type: 'GBHR_APPLY_UPDATE' })
  }, [registration])

  const value = useMemo(() => ({ installAvailable: Boolean(prompt), installed, updateAvailable, install, applyUpdate }), [prompt, installed, updateAvailable, install, applyUpdate])
  return <PwaContext.Provider value={value}>{children}</PwaContext.Provider>
}

export function usePwaRuntime() {
  const value = useContext(PwaContext)
  if (!value) throw new Error('usePwaRuntime must be used within PwaProvider.')
  return value
}
