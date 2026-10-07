import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, ExternalLink } from 'lucide-react'
import { cn } from '@/lib/utils'
import { InfoPopover } from '@/components/InfoPopover'
import { useMarkNotable } from './context'

export const money = (v: number | null | undefined, digits = 0) =>
  v == null || !Number.isFinite(v)
    ? '—'
    : `${v < 0 ? '−' : ''}$${Math.abs(v).toLocaleString('en-CA', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`
export const n0 = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '—' : Math.round(v).toLocaleString('en-CA'))
export const n1 = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? '—' : v.toLocaleString('en-CA', { maximumFractionDigits: 1, minimumFractionDigits: 1 })
export const perLbFmt = (v: number | null | undefined) => (v == null ? '—' : `$${v.toFixed(2)}/lb`)

/** Where a tool's numbers come from: a page in the app, or the source outside it. */
export type Source = { label: string; to?: string; href?: string }

export function Sources({ sources }: { sources: Source[] }) {
  if (!sources.length) return null
  return (
    <p className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md bg-blue-50/60 px-2.5 py-1.5 text-[11px] text-gray-600">
      <span className="font-semibold text-gray-700">Where this comes from:</span>
      {sources.map((s, i) =>
        s.to ? (
          <Link key={i} to={s.to} className="text-brand-700 underline decoration-dotted hover:text-brand-900">
            {s.label}
          </Link>
        ) : s.href ? (
          <a key={i} href={s.href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-brand-700 underline decoration-dotted hover:text-brand-900">
            {s.label}
            <ExternalLink className="h-2.5 w-2.5" />
          </a>
        ) : (
          <span key={i}>{s.label}</span>
        ),
      )}
    </p>
  )
}

/**
 * The same links as Sources, as one small grey line. Inside a tool card the
 * blue box was the loudest thing in it, above the numbers it sourced; the
 * links are still one tap away, they just stop announcing themselves.
 */
export function SourceLinks({ sources }: { sources: Source[] }) {
  if (!sources.length) return null
  return (
    <p className="mb-2 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-gray-400">
      <span>From</span>
      {sources.map((s, i) => (
        <span key={i} className="inline-flex items-center">
          {i > 0 && <span className="mr-1.5">·</span>}
          {s.to ? (
            <Link to={s.to} className="text-gray-500 underline decoration-dotted hover:text-brand-800">
              {s.label}
            </Link>
          ) : s.href ? (
            <a href={s.href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-gray-500 underline decoration-dotted hover:text-brand-800">
              {s.label}
              <ExternalLink className="h-2.5 w-2.5" />
            </a>
          ) : (
            <span>{s.label}</span>
          )}
        </span>
      ))}
    </p>
  )
}

/** A field's name as a link to the page its number came from. */
export function FieldLink({ id, name, to = 'soil' }: { id: string | null | undefined; name: string; to?: 'soil' | 'history' | 'work' | 'sampling' | 'settings' }) {
  if (!id) return <>{name}</>
  const href = to === 'sampling' ? `/fertilizer?tab=Soil%20Sampling&field=${id}` : `/fields/${id}/${to}`
  return (
    <Link to={href} className="text-gray-800 underline decoration-gray-300 decoration-dotted hover:text-brand-800">
      {name}
    </Link>
  )
}

/**
 * One tool: a number, a name, a sentence on what it does, what it could
 * save, and the working underneath — folded, so twenty of them read as a
 * list before any of them is opened.
 *
 * `method` is how the figure is worked out. It used to sit as a grey
 * paragraph at the foot of every card, forty to eighty words each, read once
 * and then scrolled past for good; it is behind the ⓘ by the title now, every
 * word of it. `warn` marks a card with something to act on even when it
 * saves nothing, so the tab keeps it in view rather than folding it away
 * with the quiet ones.
 */
export function ToolCard({
  n,
  title,
  why,
  saving,
  savingLabel = 'could save',
  note,
  defaultOpen = false,
  actions,
  sources = [],
  method,
  warn = false,
  children,
}: {
  n: number
  title: string
  why: string
  saving: number | null
  savingLabel?: string
  /** Shown in place of a saving when there is none to state, e.g. "needs a quote". */
  note?: string | null
  defaultOpen?: boolean
  actions?: ReactNode
  /** The pages and outside sources the numbers are drawn from, shown when the card opens. */
  sources?: Source[]
  /** How the figure is worked out, behind an ⓘ beside the title. */
  method?: ReactNode
  /** Something here needs acting on, saving or not. */
  warn?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  useMarkNotable(n, (saving != null && saving > 0) || warn)
  return (
    <section className="overflow-hidden rounded-lg border border-gray-200 bg-white">
      <div className="flex items-start gap-2 px-3 py-2.5">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-start gap-2 text-left"
        >
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-50 text-[11px] font-semibold text-brand-800">
            {n}
          </span>
          <span className="min-w-0">
            <span className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
              <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 text-gray-400 transition-transform', open && 'rotate-90')} />
              {title}
            </span>
            <span className="block text-xs text-gray-500">{why}</span>
          </span>
        </button>
        {method && (
          <InfoPopover title={`${title}: how it is worked out`} className="mt-1">
            {method}
          </InfoPopover>
        )}
        <span className="flex shrink-0 flex-col items-end gap-1">
          {saving != null && saving > 0 ? (
            <span className="rounded bg-green-50 px-1.5 py-0.5 text-xs font-semibold tabular-nums text-green-800">
              {savingLabel} {money(saving)}
            </span>
          ) : note ? (
            <span className="max-w-[12rem] text-right text-[11px] text-gray-400">{note}</span>
          ) : null}
          {actions}
        </span>
      </div>
      {open && (
        <div className="border-t border-gray-100 px-3 py-3 text-sm">
          <SourceLinks sources={sources} />
          {children}
        </div>
      )}
    </section>
  )
}

export function Table({ head, children, className }: { head: ReactNode[]; children: ReactNode; className?: string }) {
  return (
    <div className={cn('overflow-x-auto', className)}>
      <table className="w-full text-xs">
        <thead className="text-left text-[10px] uppercase tracking-wide text-gray-400">
          <tr>
            {head.map((h, i) => (
              <th key={i} className="px-2 py-1 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">{children}</tbody>
      </table>
    </div>
  )
}

export const td = 'px-2 py-1 text-gray-700'
export const tdNum = 'px-2 py-1 text-right tabular-nums text-gray-800'

export function Muted({ children }: { children: ReactNode }) {
  return <p className="text-xs text-gray-500">{children}</p>
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-md border border-dashed border-gray-200 px-3 py-4 text-center text-xs text-gray-400">{children}</p>
}

export const input = 'rounded-md border border-gray-300 px-2 py-1 text-sm'
export const button =
  'inline-flex items-center gap-1 rounded-md bg-brand-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-brand-800 disabled:opacity-40'
export const ghost = 'inline-flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50'
