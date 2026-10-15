import { Link } from 'react-router-dom'
import { TriangleAlert, CircleAlert, Info, CheckCircle2 } from 'lucide-react'
import type { Warning } from '@/lib/cattle-nutrition'
import { cn } from '@/lib/utils'

/**
 * "Head counts come from the Herd tab", as a small link rather than a
 * sentence. The Grazing and Feed screens read the herd's head counts from
 * the Herd tab; this says so and goes there in one tap.
 */
export function FromHerdChip({ className }: { className?: string }) {
  return (
    <Link
      to="/herd"
      title="Head counts come from the Herd tab — add or remove classes there."
      className={cn(
        'inline-flex items-center rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[11px] text-gray-500 hover:border-brand-300 hover:text-brand-700',
        className,
      )}
    >
      head from Herd →
    </Link>
  )
}

export const n0 = (v: number) => Math.round(v).toLocaleString('en-CA')
export const n1 = (v: number) => v.toLocaleString('en-CA', { maximumFractionDigits: 1, minimumFractionDigits: 1 })
export const tonnes = (lb: number) => (lb / 2204.62).toLocaleString('en-CA', { maximumFractionDigits: 1 })

/** Number field that saves on blur. */
export function Num({
  value,
  disabled,
  step = '1',
  min,
  max,
  suffix,
  onCommit,
  className,
  placeholder,
  allowEmpty = false,
}: {
  value: number | null
  disabled?: boolean
  step?: string
  min?: number
  max?: number
  suffix?: string
  onCommit: (v: number | null) => void
  className?: string
  placeholder?: string
  allowEmpty?: boolean
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <input
        key={String(value)}
        type="number"
        step={step}
        min={min}
        max={max}
        disabled={disabled}
        placeholder={placeholder}
        defaultValue={value ?? ''}
        onBlur={(e) => {
          const raw = e.target.value.trim()
          if (raw === '') {
            if (allowEmpty && value != null) onCommit(null)
            return
          }
          let v = Number(raw)
          if (!Number.isFinite(v)) return
          if (min != null) v = Math.max(min, v)
          if (max != null) v = Math.min(max, v)
          if (v !== value) onCommit(v)
        }}
        className={cn(
          'w-16 rounded-md border border-gray-200 px-1.5 py-1 text-right text-sm tabular-nums disabled:border-transparent disabled:bg-transparent disabled:opacity-80',
          className,
        )}
      />
      {suffix && <span className="text-xs text-gray-400">{suffix}</span>}
    </span>
  )
}

const LEVEL_STYLE: Record<Warning['level'], string> = {
  ok: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  notice: 'border-gray-200 bg-gray-50 text-gray-700',
  amber: 'border-amber-200 bg-amber-50 text-amber-900',
  red: 'border-red-200 bg-red-50 text-red-900',
}

export function WarningList({ warnings }: { warnings: Warning[] }) {
  if (!warnings.length) return null
  const order = { red: 0, amber: 1, notice: 2, ok: 3 }
  return (
    <ul className="space-y-1">
      {[...warnings]
        .sort((a, b) => order[a.level] - order[b.level])
        .map((w, i) => {
          const Icon = w.level === 'red' ? CircleAlert : w.level === 'amber' ? TriangleAlert : w.level === 'ok' ? CheckCircle2 : Info
          return (
            <li key={i} className={cn('flex items-start gap-1.5 rounded-md border px-2 py-1 text-xs', LEVEL_STYLE[w.level])}>
              <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{w.text}</span>
            </li>
          )
        })}
    </ul>
  )
}

/** "9.6 rounds", "14,200 lb" — what a feed amount is in the yard. */
export function yardAmount(lb: number, unit: string | null | undefined, lbPerBale: number | null | undefined): string {
  if (unit && unit !== 'lb' && lbPerBale && lbPerBale > 0) {
    const b = lb / lbPerBale
    const word = unit === 'round' ? 'round' : 'big square'
    return `${n1(b)} ${word}${Math.abs(b - 1) < 0.05 ? '' : 's'}`
  }
  return `${n0(lb)} lb`
}
