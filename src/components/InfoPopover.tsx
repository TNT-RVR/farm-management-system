import type React from 'react'
import { useRef } from 'react'
import { Info, X } from 'lucide-react'
import { useAnchoredPanel } from '@/lib/useAnchoredPanel'
import { cn } from '@/lib/utils'

/**
 * An info button for explanation that only some readers want.
 *
 * The same button and panel as ColumnHelp, for text that is not about a table
 * column. Paragraphs explaining how a screen works are read once and then
 * occupy the page forever, pushing the thing they explain further down — which
 * is the opposite of helping on a tablet in a truck.
 *
 * Click to open, not hover: hover does not exist on the tablet these get read
 * on, and a panel of several sentences is not something to read while holding a
 * mouse still. `hover` adds opening on mouse-over for the short ones — a
 * legend of four swatches — and the click still works for the tablet.
 */
export function InfoPopover({
  title,
  label,
  children,
  width = 440,
  className,
  hover = false,
}: {
  title: string
  /** Optional text beside the icon, when the button needs to invite a click. */
  label?: string
  children: React.ReactNode
  width?: number
  className?: string
  /** Also open on mouse-over, closing when the pointer leaves button and panel. */
  hover?: boolean
}) {
  const { open, setOpen, btnRef, panelRef, pos } = useAnchoredPanel(width)
  const leaveTimer = useRef<number | null>(null)
  const hoverIn = () => {
    if (!hover) return
    if (leaveTimer.current) window.clearTimeout(leaveTimer.current)
    setOpen(true)
  }
  const hoverOut = () => {
    if (!hover) return
    if (leaveTimer.current) window.clearTimeout(leaveTimer.current)
    // A short grace so the pointer can cross the gap into the panel.
    leaveTimer.current = window.setTimeout(() => setOpen(false), 200)
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        onMouseEnter={hoverIn}
        onMouseLeave={hoverOut}
        className={cn(
          'inline-flex shrink-0 items-center gap-1 align-middle text-gray-400 hover:text-brand-700',
          className,
        )}
        aria-label={title}
        aria-expanded={open}
      >
        <Info className="h-3.5 w-3.5" />
        {label && <span className="text-[11px]">{label}</span>}
      </button>

      {open && pos && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label={title}
          onMouseEnter={hoverIn}
          onMouseLeave={hoverOut}
          style={{ top: pos.top, left: pos.left, width: pos.width, maxHeight: pos.maxHeight }}
          // whitespace-normal is load-bearing. The panel is a DOM descendant of
          // whatever opened it, and HorizonInfo wraps its button in a nowrap
          // span to keep "Ap" beside its icon — which the panel inherited, so
          // its sentences ran off the side and overflow-x-hidden cut them.
          className="fixed z-50 overflow-y-auto overflow-x-hidden overscroll-contain whitespace-normal break-words rounded-lg border border-gray-200 bg-white p-3 text-left normal-case tracking-normal shadow-xl"
        >
          <div className="mb-1.5 flex items-start justify-between gap-2">
            <p className="text-sm font-semibold text-gray-900">{title}</p>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="-mr-1 -mt-0.5 rounded p-0.5 text-gray-400 hover:bg-gray-100"
              aria-label="Close"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="space-y-2 text-xs leading-relaxed text-gray-600">{children}</div>
        </div>
      )}
    </>
  )
}
