import { Scale } from 'lucide-react'
import { basisVerdict, type BasisPoint } from '@/lib/basis'
import { cn } from '@/lib/utils'

/**
 * Cash against the board, with the arithmetic shown.
 *
 * The working is on screen on purpose. Basis is the one number on either tab
 * that is computed rather than quoted, and a farmer deciding whether to sell
 * should be able to see which of the three inputs moved rather than trusting a
 * figure that appeared from nowhere.
 */
export function BasisPanel({
  title,
  point,
  history,
  cashLabel,
  boardLabel,
  note,
}: {
  title: string
  point: BasisPoint | null
  /** Past basis values, for "is this normal?". */
  history?: number[]
  cashLabel: string
  boardLabel: string
  note?: string
}) {
  if (!point) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-gray-800">
          <Scale className="h-4 w-4 text-gray-400" /> {title}
        </h3>
        <p className="mt-1 text-xs text-gray-500">
          Not enough quoted this week to work it out. Basis needs a cash bid and a board price in
          the same week, and one of them is missing.
        </p>
      </div>
    )
  }

  const verdict = history ? basisVerdict(point.basis, history) : null
  const fmt = (v: number) =>
    `${v < 0 ? '−' : ''}$${Math.abs(v).toLocaleString('en-CA', { maximumFractionDigits: 2 })}`

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-gray-800">
        <Scale className="h-4 w-4 text-gray-400" /> {title}
      </h3>

      <div className="mt-2 flex flex-wrap items-end gap-x-6 gap-y-2">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-gray-500">{cashLabel}</p>
          <p className="text-lg font-semibold tabular-nums text-gray-900">{fmt(point.cash)}</p>
        </div>
        <span className="pb-1.5 text-lg text-gray-300">−</span>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-gray-500">{boardLabel}</p>
          <p className="text-lg font-semibold tabular-nums text-gray-900">
            {fmt(point.futuresEquivalent)}
          </p>
        </div>
        <span className="pb-1.5 text-lg text-gray-300">=</span>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-gray-500">Basis</p>
          <p
            className={cn(
              'text-xl font-bold tabular-nums',
              point.basis >= 0 ? 'text-green-700' : 'text-gray-900',
            )}
          >
            {fmt(point.basis)}
            <span className="ml-1 text-xs font-normal text-gray-500">{point.unit}</span>
          </p>
        </div>
      </div>

      {verdict && (
        <p className="mt-2 rounded-md bg-gray-50 px-2 py-1.5 text-xs text-gray-700">
          <span className="font-semibold">{verdict.percentile}th percentile</span> of the basis we
          have on record. {verdict.note}
        </p>
      )}
      {!verdict && history && (
        <p className="mt-2 text-[11px] text-gray-400">
          {history.length} week{history.length === 1 ? '' : 's'} on record — too few to say whether
          this is normal. Eight is the floor.
        </p>
      )}
      {note && <p className="mt-1.5 text-[11px] text-gray-500">{note}</p>}
    </div>
  )
}
