import { useRef } from 'react'
import { MoreHorizontal } from 'lucide-react'
import './row-actions-menu.css'

export type RowAction = {
  label: string
  onSelect: () => void
  disabled?: boolean
  tone?: 'danger' | 'default'
}

export function RowActionsMenu({ label, actions }: { label: string; actions: RowAction[] }) {
  const details = useRef<HTMLDetailsElement>(null)
  return <details className="row-actions-menu" ref={details} onKeyDown={(event) => {
    if (event.key === 'Escape') { details.current?.removeAttribute('open'); details.current?.querySelector('summary')?.focus() }
  }}>
    <summary aria-label={label} aria-haspopup="menu"><MoreHorizontal size={18}/></summary>
    <div className="row-actions-menu-items" role="menu" aria-label={label}>
      {actions.map((action) => <button
        type="button"
        role="menuitem"
        key={action.label}
        disabled={action.disabled}
        className={action.tone === 'danger' ? 'danger' : undefined}
        onClick={() => { details.current?.removeAttribute('open'); action.onSelect() }}
      >{action.label}</button>)}
    </div>
  </details>
}

export function StatusBadge({ status }: { status: string }) {
  const label = status.toLowerCase().replaceAll('_', ' ')
  const tone = /approved|active|finalized|issued/.test(label) ? 'positive'
    : /pending|submitted|draft|correction/.test(label) ? 'pending'
      : /rejected|inactive|revoked|terminated/.test(label) ? 'negative' : 'neutral'
  return <span className={`shared-status-badge ${tone}`}>{label.replace(/\b\w/g, (value) => value.toUpperCase())}</span>
}
