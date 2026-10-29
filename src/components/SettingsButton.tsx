import { Settings2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { cn } from '@/lib/utils'

/**
 * The one way the app offers settings (Sam, 27 Oct 2026: "make settings
 * buttons all match style and location"). Every settings control is this
 * button — the same gear, the same size, the same bordered grey box — and it
 * sits at the top right of whatever it settles: the page's toolbar, the card's
 * header, the panel's own row.
 *
 * `label` names what it settles ("Bin settings", "Work types"): shown beside
 * the gear where there is room, and on the tooltip either way. A toolbar of
 * icons takes `iconOnly`, so the gear sits in line with its neighbours.
 */
export function SettingsButton({
  label,
  onClick,
  to,
  open,
  iconOnly = false,
  className,
}: {
  label: string
  onClick?: () => void
  /** A settings page rather than a panel: the button becomes a link. */
  to?: string
  /** For a panel that opens underneath: the gear shows it is the open one. */
  open?: boolean
  iconOnly?: boolean
  className?: string
}) {
  const cls = cn(
    'flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-gray-50',
    open ? 'border-gray-400 bg-gray-50 text-gray-900' : 'border-gray-300 text-gray-700',
    iconOnly && 'px-2',
    className,
  )
  const inside = (
    <>
      <Settings2 className="h-4 w-4" />
      {!iconOnly && label}
    </>
  )
  return to ? (
    <Link to={to} aria-label={label} title={label} className={cls}>
      {inside}
    </Link>
  ) : (
    <button type="button" onClick={onClick} aria-label={label} title={label} aria-expanded={open} className={cls}>
      {inside}
    </button>
  )
}
