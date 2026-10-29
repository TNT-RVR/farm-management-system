import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Star } from 'lucide-react'
import { MODAL_OPENED } from './Modal'
import { cn } from '@/lib/utils'

export type CheckOption = {
  value: string
  label: string
  /** A word under the label: why it is worth picking, or what it breaks. */
  hint?: string
  tone?: 'good' | 'warn' | 'bad'
  disabled?: boolean
}

/**
 * A dropdown you tick as many of as you want, for a cell that holds more than
 * one answer (Sam, 28 Oct 2026: "just have a drop down with checkboxes in
 * which a user can check as many as they want as options").
 *
 * The order is the order they were ticked, and the first one is the answer of
 * record — the rotation planner's first choice is what the budget and the acre
 * forecast read — so a ticked option that is not first offers to become it.
 * The menu stays open while ticking: picking three crops is one thought.
 *
 * Built like `Select`: a portal anchored to the trigger, so it is not clipped
 * inside a scrolling table.
 */
export function CheckSelect({
  values,
  options,
  onToggle,
  onMakeFirst,
  className,
  ariaLabel,
  disabled,
  placeholder = 'Pick…',
  size = 'md',
  title,
  footer,
}: {
  /** Ticked, in order; the first is the answer of record. */
  values: string[]
  options: CheckOption[]
  onToggle: (value: string) => void
  /** Offered on a ticked option that is not first. Left out: no promoting. */
  onMakeFirst?: (value: string) => void
  className?: string
  ariaLabel?: string
  disabled?: boolean
  placeholder?: string
  size?: 'sm' | 'md'
  title?: string
  /** Anything under the list — the planner puts its recommendation there. */
  footer?: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [rect, setRect] = useState<{
    top: number
    left: number
    width: number
    above: boolean
  } | null>(null)

  const place = () => {
    const b = btnRef.current?.getBoundingClientRect()
    if (!b) return
    const spaceBelow = window.innerHeight - b.bottom
    const above = spaceBelow < 280 && b.top > spaceBelow
    const left = Math.max(8, Math.min(b.left, window.innerWidth - Math.max(b.width, 240) - 8))
    setRect({ top: above ? b.top : b.bottom, left, width: b.width, above })
  }

  useLayoutEffect(() => {
    if (open) place()
  }, [open])

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (btnRef.current?.contains(e.target as Node) || menuRef.current?.contains(e.target as Node))
        return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    const onScroll = (e: Event) => {
      if (menuRef.current?.contains(e.target as Node)) return
      place()
    }
    const onModal = () => setOpen(false)
    window.addEventListener(MODAL_OPENED, onModal)
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener(MODAL_OPENED, onModal)
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', place)
    }
  }, [open])

  const pad = size === 'sm' ? 'px-2 py-1' : 'px-3 py-2'
  const chosen = values
    .map((v) => options.find((o) => o.value === v))
    .filter((o): o is CheckOption => !!o)
  const label = chosen.length ? chosen.map((o) => o.label).join(' or ') : placeholder

  return (
    <div className={cn('relative', className)}>
      <button
        ref={btnRef}
        type="button"
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={ariaLabel}
        title={title ?? (chosen.length > 1 ? label : undefined)}
        className={cn(
          'flex w-full items-center justify-between gap-2 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-800 shadow-sm transition-colors hover:border-gray-300 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/25 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400 disabled:shadow-none',
          pad,
          !chosen.length && 'text-gray-400',
        )}
      >
        <span className="truncate">{label}</span>
        <ChevronDown
          className={cn(
            'h-4 w-4 shrink-0 text-gray-400 transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>
      {open &&
        rect &&
        createPortal(
          <div
            ref={menuRef}
            style={{
              position: 'fixed',
              top: rect.above ? undefined : rect.top + 4,
              bottom: rect.above ? window.innerHeight - rect.top + 4 : undefined,
              left: rect.left,
              minWidth: Math.max(rect.width, 240),
              maxWidth: Math.min(360, window.innerWidth - rect.left - 8),
            }}
            className="z-[70] rounded-lg border border-gray-200 bg-white shadow-lg"
          >
            <ul className="max-h-64 overflow-auto p-1">
              {options.map((o) => {
                const i = values.indexOf(o.value)
                const on = i >= 0
                return (
                  <li key={o.value}>
                    <label
                      className={cn(
                        'flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-sm',
                        o.disabled
                          ? 'cursor-not-allowed text-gray-300'
                          : on
                            ? 'bg-brand-50 text-brand-900'
                            : 'text-gray-700 hover:bg-gray-100',
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        disabled={o.disabled}
                        onChange={() => onToggle(o.value)}
                        className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-brand-700"
                      />
                      <span className="min-w-0 flex-auto">
                        <span className="block break-words">
                          {o.label}
                          {i === 0 && (
                            <span className="ml-1 text-[10px] font-semibold uppercase text-brand-700">
                              plan
                            </span>
                          )}
                        </span>
                        {o.hint && (
                          <span
                            className={cn(
                              'block text-[11px]',
                              o.tone === 'bad'
                                ? 'text-red-600'
                                : o.tone === 'warn'
                                  ? 'text-amber-700'
                                  : o.tone === 'good'
                                    ? 'text-green-700'
                                    : 'text-gray-500',
                            )}
                          >
                            {o.hint}
                          </span>
                        )}
                      </span>
                      {on && i > 0 && onMakeFirst && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault()
                            onMakeFirst(o.value)
                          }}
                          title="Make this the plan"
                          aria-label={`Make ${o.label} the plan`}
                          className="mt-0.5 shrink-0 rounded p-0.5 text-gray-400 hover:bg-white hover:text-brand-700"
                        >
                          <Star className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </label>
                  </li>
                )
              })}
            </ul>
            {footer && <div className="border-t border-gray-100 p-2">{footer}</div>}
          </div>,
          document.body,
        )}
    </div>
  )
}
