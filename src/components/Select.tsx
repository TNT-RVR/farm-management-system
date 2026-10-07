import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

export type SelectOption = {
  value: string
  label: string
  disabled?: boolean
  /** A heading the option sits under; consecutive options with the same group share one. */
  group?: string
}

/**
 * A styled dropdown matching the app's design (rounded, subtle shadow,
 * brand-highlighted selection) that replaces the OS-native <select>. The menu
 * renders in a portal positioned to the trigger, so it works inside scrollable
 * tables without being clipped. `size='sm'` suits dense table cells.
 */
export function Select({
  value,
  options,
  onChange,
  className,
  ariaLabel,
  disabled,
  placeholder = 'Select…',
  size = 'md',
  title,
}: {
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
  className?: string
  ariaLabel?: string
  disabled?: boolean
  placeholder?: string
  size?: 'sm' | 'md'
  title?: string
}) {
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLUListElement>(null)
  const [rect, setRect] = useState<{
    top: number
    left: number
    width: number
    above: boolean
  } | null>(null)
  const selected = options.find((o) => o.value === value)

  const place = () => {
    const b = btnRef.current?.getBoundingClientRect()
    if (!b) return
    const spaceBelow = window.innerHeight - b.bottom
    const above = spaceBelow < 260 && b.top > spaceBelow
    setRect({ top: above ? b.top : b.bottom, left: b.left, width: b.width, above })
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
    // Scrolling INSIDE the menu (a long, overflow-auto list) must not close it —
    // only a page/ancestor scroll should, and then we just re-anchor to the
    // trigger rather than dismiss.
    const onScroll = (e: Event) => {
      if (menuRef.current?.contains(e.target as Node)) return
      place()
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', place)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', place)
    }
  }, [open])

  const pad = size === 'sm' ? 'px-2 py-1' : 'px-3 py-2'

  return (
    <div className={cn('relative', className)}>
      <button
        ref={btnRef}
        type="button"
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        title={title}
        className={cn(
          'flex w-full items-center justify-between gap-2 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-800 shadow-sm transition-colors hover:border-gray-300 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/25 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400 disabled:shadow-none',
          pad,
        )}
      >
        <span className="truncate">{selected?.label ?? placeholder}</span>
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
          <ul
            ref={menuRef}
            role="listbox"
            style={{
              position: 'fixed',
              top: rect.above ? undefined : rect.top + 4,
              bottom: rect.above ? window.innerHeight - rect.top + 4 : undefined,
              left: rect.left,
              minWidth: rect.width,
            }}
            className="z-50 max-h-64 overflow-auto rounded-lg border border-gray-200 bg-white p-1 shadow-lg"
          >
            {options.map((o, i) => (
              <Fragment key={o.value}>
                {o.group && o.group !== options[i - 1]?.group && (
                  <li
                    role="presentation"
                    className="px-2.5 pb-0.5 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400"
                  >
                    {o.group}
                  </li>
                )}
                <li
                  role="option"
                  aria-selected={o.value === value}
                  onClick={() => {
                    if (o.disabled) return
                    onChange(o.value)
                    setOpen(false)
                  }}
                  className={cn(
                    'flex items-center justify-between gap-3 whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm',
                    o.disabled
                      ? 'cursor-not-allowed text-gray-300'
                      : o.value === value
                        ? 'cursor-pointer bg-brand-50 font-medium text-brand-800'
                        : 'cursor-pointer text-gray-700 hover:bg-gray-100',
                  )}
                >
                  <span className="truncate">{o.label}</span>
                  {o.value === value && <Check className="h-4 w-4 shrink-0 text-brand-700" />}
                </li>
              </Fragment>
            ))}
          </ul>,
          document.body,
        )}
    </div>
  )
}
