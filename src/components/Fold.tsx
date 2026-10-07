import type React from 'react'
import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

const read = (key: string): boolean | null => {
  try {
    const v = localStorage.getItem(`fold:${key}`)
    return v === null ? null : v === '1'
  } catch {
    return null
  }
}
const write = (key: string, open: boolean) => {
  try {
    localStorage.setItem(`fold:${key}`, open ? '1' : '0')
  } catch {
    // Private window or blocked storage: the fold still works, it just forgets.
  }
}

/**
 * A section that can be folded to its title.
 *
 * Long pages stacked every card open, so the ones used every day sat below
 * ones looked at twice a season. Secondary sections start folded and open
 * with one tap; nothing is removed. Give `storageKey` and the choice is
 * remembered on this device, so someone who always wants a section open only
 * opens it once.
 *
 * `summary` is shown beside the title while folded — a count or a total — so
 * a folded section still says whether it is worth opening.
 */
export function Fold({
  title,
  summary,
  defaultOpen = false,
  storageKey,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title: React.ReactNode
  summary?: React.ReactNode
  defaultOpen?: boolean
  storageKey?: string
  /** Buttons on the right of the title row; clicking them does not toggle. */
  actions?: React.ReactNode
  children: React.ReactNode
  className?: string
  bodyClassName?: string
}) {
  const [open, setOpen] = useState(() => (storageKey ? (read(storageKey) ?? defaultOpen) : defaultOpen))
  const toggle = () => {
    setOpen((o) => {
      if (storageKey) write(storageKey, !o)
      return !o
    })
  }
  return (
    <section className={cn('rounded-lg border border-gray-200 bg-white', className)}>
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        >
          <ChevronRight className={cn('h-4 w-4 shrink-0 text-gray-400 transition-transform', open && 'rotate-90')} />
          <span className="text-sm font-semibold text-gray-900">{title}</span>
          {!open && summary && <span className="truncate text-xs text-gray-500">· {summary}</span>}
        </button>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {open && <div className={cn('border-t border-gray-100 px-3 py-3', bodyClassName)}>{children}</div>}
    </section>
  )
}
