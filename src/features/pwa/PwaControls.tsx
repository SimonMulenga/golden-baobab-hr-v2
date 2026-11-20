import { useEffect, useState } from 'react'
import { Bell, Download, RefreshCw, X } from 'lucide-react'
import { useLocation } from 'react-router-dom'
import type { UserNotificationRecord } from '../../services/live-operations-services'
import { usePwaRuntime } from './pwa-runtime'
import './pwa-controls.css'

const installDismissKey = 'gbhr-pwa-install-invite-dismissed'
function getInstallDismissed() {
  try { return localStorage.getItem(installDismissKey) === 'on' } catch { return false }
}

export function PwaPrompts({ notification, onDismissNotification }: { notification: UserNotificationRecord | null; onDismissNotification: () => void }) {
  const { installAvailable, installed, updateAvailable, install, applyUpdate } = usePwaRuntime()
  const location = useLocation()
  const [installDismissed, setInstallDismissed] = useState(getInstallDismissed)
  const [instructions, setInstructions] = useState(false)
  const [toast, setToast] = useState(notification)
  const [standalone] = useState(() => window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true)
  const payrollWorkArea = ['/payroll', '/payroll-approvals', '/payslips', '/reconciliation', '/deductions', '/statutory'].some((path) => location.pathname === path || location.pathname.startsWith(`${path}/`))

  useEffect(() => { setToast(notification) }, [notification])
  useEffect(() => {
    if (!toast) return
    const timeout = window.setTimeout(onDismissNotification, 6500)
    return () => window.clearTimeout(timeout)
  }, [toast, onDismissNotification])

  const invite = async () => {
    const result = await install()
    if (result === 'instructions') setInstructions(true)
    else if (result === 'accepted') setInstallDismissed(true)
  }
  const dismissInstall = () => { try { localStorage.setItem(installDismissKey, 'on') } catch { /* Invitation can still be dismissed for this session. */ } setInstallDismissed(true) }

  return <div className="pwa-controls" aria-live="polite">
    {toast && <div className="workflow-toast" role="status">
      <span className="workflow-toast-icon"><Bell size={17}/></span>
      <div className="workflow-toast-copy"><strong>{toast.title}</strong><span>{toast.message}</span></div>
      <button className="workflow-toast-close" aria-label="Dismiss notification" onClick={onDismissNotification}><X size={16}/></button>
    </div>}
    {!installed && installAvailable && !installDismissed && <section className="pwa-card" aria-label="Install Golden Baobab HR">
      <div className="pwa-card-head"><strong>Keep HR close at hand</strong><button className="workflow-toast-close" aria-label="Dismiss install invitation" onClick={dismissInstall}><X size={16}/></button></div>
      <p>Add Golden Baobab HR to your device for a focused, app-like workspace.</p>
      <div className="pwa-card-actions"><button className="button-primary" onClick={() => void invite()}><Download size={15}/> Install app</button><button className="pwa-dismiss" onClick={dismissInstall}>Later</button></div>
    </section>}
    {updateAvailable && <section className="pwa-card" role="status" aria-label="Application update available">
      <div className="pwa-card-head"><strong>A new version is ready</strong></div>
      <p>{payrollWorkArea ? 'Finish your payroll work and open another screen before applying the update.' : 'Your current screen will reload when you choose to update.'}</p>
      <div className="pwa-card-actions"><button className="button-primary" disabled={payrollWorkArea} onClick={applyUpdate}><RefreshCw size={15}/> Update app</button></div>
    </section>}
    {instructions && <div className="pwa-help-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setInstructions(false) }}>
      <section className="pwa-card pwa-help-dialog" role="dialog" aria-modal="true" aria-labelledby="pwa-help-title">
        <div className="pwa-card-head"><strong id="pwa-help-title">Install Golden Baobab HR</strong><button className="workflow-toast-close" aria-label="Close install instructions" onClick={() => setInstructions(false)}><X size={16}/></button></div>
        <p>{standalone ? 'Golden Baobab HR is already installed on this device.' : 'Open your browser menu and choose “Install app” or “Add to Home Screen”. On iPhone or iPad, use Share, then Add to Home Screen.'}</p>
        <div className="pwa-card-actions"><button className="button-primary" onClick={() => setInstructions(false)}>Done</button></div>
      </section>
    </div>}
  </div>
}

export function PwaInstallMenuAction() {
  const { installAvailable, installed, install } = usePwaRuntime()
  const [showHelp, setShowHelp] = useState(false)
  if (installed) return null
  return <div className="pwa-menu-action"><button className="pwa-sidebar-install-button" type="button" onClick={async () => { const result = await install(); setShowHelp(result === 'instructions') }}><Download size={15}/> Install app</button>{showHelp && <span>Use your browser menu to install or add this app to your home screen.</span>}{installAvailable && <span className="sr-only">An app installation prompt is available.</span>}</div>
}
