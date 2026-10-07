import { useEffect, useMemo, useRef, useState } from 'react'
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

// A month grid instead of iOS's scroll wheels.
//
// `<input type="date">` renders whatever the platform gives it, and on iOS
// Safari that is three spinning wheels with no way to restyle them. Picking the
// 23rd means scrolling past 22 other numbers, and picking a date three weeks
// out means doing it again for the month. On desktop the same element gives a
// perfectly good calendar, which is why this has always looked fine on a laptop
// and awkward in a truck.
//
// So the calendar is drawn here rather than asked for. The value stays an
// ISO `YYYY-MM-DD` string, identical to what the native input produced, so
// every caller and every insert is unchanged.

const DAY_NAMES = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/**
 * Parse and format WITHOUT the Date constructor's timezone trap.
 *
 * `new Date('2026-08-17')` is parsed as UTC midnight, which is the 16th
 * anywhere west of Greenwich — so a naive round-trip moves every date in
 * Alberta back a day. These stay on plain numbers for exactly that reason.
 */
export function parseISODate(v: string | null | undefined): { y: number; m: number; d: number } | null {
  if (!v) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v)
  if (!m) return null
  return { y: Number(m[1]), m: Number(m[2]) - 1, d: Number(m[3]) }
}

export function toISODate(y: number, m: number, d: number): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${y}-${pad(m + 1)}-${pad(d)}`
}

function daysInMonth(y: number, m: number): number {
  return new Date(y, m + 1, 0).getDate()
}

/** Today, in local time rather than UTC. */
function todayParts() {
  const n = new Date()
  return { y: n.getFullYear(), m: n.getMonth(), d: n.getDate() }
}

export function DateField({
  value,
  onChange,
  className,
  id,
  required,
  ariaLabel,
  min,
  max,
  placeholder = 'Choose a date',
}: {
  value: string
  onChange: (v: string) => void
  className?: string
  id?: string
  required?: boolean
  ariaLabel?: string
  min?: string
  max?: string
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const selected = parseISODate(value)
  const today = todayParts()
  // The month being browsed, when it has been browsed away from the value.
  // Kept as an override rather than mirrored state: mirroring meant an effect
  // that setStates on every value change, which renders twice before paint —
  // and browsing forward then picking a date would snap the view backwards.
  const [browsed, setBrowsed] = useState<{ y: number; m: number } | null>(null)
  const anchor = selected ?? today
  const view = useMemo(
    () => browsed ?? { y: anchor.y, m: anchor.m },
    [browsed, anchor.y, anchor.m],
  )

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const cells = useMemo(() => {
    const first = new Date(view.y, view.m, 1).getDay()
    const total = daysInMonth(view.y, view.m)
    const out: (number | null)[] = Array.from({ length: first }, () => null)
    for (let d = 1; d <= total; d++) out.push(d)
    return out
  }, [view])

  const label = selected
    ? `${selected.d} ${MONTHS[selected.m].slice(0, 3)} ${selected.y}`
    : placeholder

  const outOfRange = (iso: string) => Boolean((min && iso < min) || (max && iso > max))

  const step = (by: number) => {
    const m = view.m + by
    if (m < 0) setBrowsed({ y: view.y - 1, m: 11 })
    else if (m > 11) setBrowsed({ y: view.y + 1, m: 0 })
    else setBrowsed({ y: view.y, m })
  }

  return (
    <div ref={wrapRef} className={cn('relative', className)}>
      <button
        type="button"
        id={id}
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setBrowsed(null)
          setOpen((o) => !o)
        }}
        className={cn(
          'flex w-full items-center justify-between gap-2 rounded-md border border-gray-300 px-3 py-2 text-left text-sm',
          selected ? 'text-gray-900' : 'text-gray-400',
        )}
      >
        {label}
        <Calendar className="h-4 w-4 shrink-0 text-gray-400" />
      </button>
      {/* Keeps `required` and native form validation working, and leaves the
          value in the DOM where anything reading the form still finds it. */}
      <input type="hidden" value={value} required={required} readOnly />

      {open && (
        <div
          role="dialog"
          className="absolute left-0 z-50 mt-1 w-[17rem] rounded-lg border border-gray-200 bg-white p-2 shadow-lg"
        >
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => step(-1)}
              aria-label="Previous month"
              className="rounded p-1.5 hover:bg-gray-100"
            >
              <ChevronLeft className="h-4 w-4 text-gray-600" />
            </button>
            <span className="text-sm font-medium text-gray-900">
              {MONTHS[view.m]} {view.y}
            </span>
            <button
              type="button"
              onClick={() => step(1)}
              aria-label="Next month"
              className="rounded p-1.5 hover:bg-gray-100"
            >
              <ChevronRight className="h-4 w-4 text-gray-600" />
            </button>
          </div>

          <div className="mt-1 grid grid-cols-7 gap-0.5">
            {DAY_NAMES.map((d, i) => (
              <div key={i} className="py-1 text-center text-[10px] font-medium text-gray-400">
                {d}
              </div>
            ))}
            {cells.map((d, i) => {
              if (d == null) return <div key={`b${i}`} />
              const iso = toISODate(view.y, view.m, d)
              const isSelected =
                selected && selected.y === view.y && selected.m === view.m && selected.d === d
              const isToday = today.y === view.y && today.m === view.m && today.d === d
              const disabled = outOfRange(iso)
              return (
                <button
                  key={iso}
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    onChange(iso)
                    setOpen(false)
                  }}
                  className={cn(
                    // Comfortably past the 44 px touch target a thumb needs in
                    // a moving truck, which the wheels never were.
                    'flex h-9 items-center justify-center rounded text-sm tabular-nums',
                    disabled && 'cursor-not-allowed text-gray-300',
                    !disabled && !isSelected && 'text-gray-800 hover:bg-gray-100',
                    isSelected && 'bg-brand-700 font-semibold text-white',
                    !isSelected && isToday && 'font-semibold text-brand-700',
                  )}
                >
                  {d}
                </button>
              )
            })}
          </div>

          <div className="mt-1 flex items-center justify-between border-t border-gray-100 pt-1">
            <button
              type="button"
              onClick={() => {
                onChange(toISODate(today.y, today.m, today.d))
                setOpen(false)
              }}
              className="rounded px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50"
            >
              Today
            </button>
            {value && (
              <button
                type="button"
                onClick={() => {
                  onChange('')
                  setOpen(false)
                }}
                className="rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
