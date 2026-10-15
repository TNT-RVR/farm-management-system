import { useState } from 'react'
import { Plus, RotateCcw, X } from 'lucide-react'
import { useDeleteLine, useSaveLine } from '@/lib/profit-loss-data'
import { money, type Line, type SavedLine, type Side } from '@/lib/profit-loss-lines'
import { cn } from '@/lib/utils'

/**
 * One side of a field's books on the Profit/Loss Map:
 * product · $/unit · total amount · total $.
 *
 * Every figure can be typed over; a typed figure shows a reset arrow that puts
 * the automatic one back. Removing an automatic row saves it as removed, so it
 * stays gone when the data refreshes. Rows can be added by hand — a per-acre
 * cost like labour or land rent defaults to the field's acres as its amount.
 */
const parse = (s: string): number | null => {
  const t = s.replace(/[$,\s]/g, '')
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) && n >= 0 ? n : null
}

const plain = (v: number | null, dp: number) =>
  v == null ? '' : v.toLocaleString('en-CA', { maximumFractionDigits: dp, useGrouping: false })

export function LinesTable({
  title,
  side,
  lines,
  fieldId,
  cropYear,
  acres,
  canEdit,
}: {
  title: string
  side: Side
  lines: Line[]
  fieldId: string
  cropYear: number
  acres: number
  canEdit: boolean
}) {
  const save = useSaveLine()
  const remove = useDeleteLine()
  const [adding, setAdding] = useState(false)
  const total = lines.reduce((s, l) => s + (l.total ?? 0), 0)
  const busy = save.isPending || remove.isPending
  const error = (save.error ?? remove.error) as Error | null

  const toSaved = (l: Line, patch: Partial<SavedLine>): SavedLine => ({
    side,
    line_key: l.key,
    label: l.label,
    unit: l.unit,
    // An automatic row saves only what was typed over; a hand row saves everything.
    price_per_unit: l.isManual || l.edited.price ? l.price : null,
    amount: l.isManual || l.edited.amount ? l.amount : null,
    is_manual: l.isManual,
    removed: false,
    ...patch,
  })

  const edit = (l: Line, which: 'price' | 'amount', value: number | null) => {
    const next = toSaved(l, which === 'price' ? { price_per_unit: value } : { amount: value })
    // Nothing typed over any more on an automatic row: there is nothing to keep.
    if (!l.isManual && next.price_per_unit == null && next.amount == null) {
      remove.mutate({ fieldId, cropYear, side, key: l.key })
      return
    }
    save.mutate({ fieldId, cropYear, line: next })
  }

  const drop = (l: Line) =>
    l.isManual
      ? remove.mutate({ fieldId, cropYear, side, key: l.key })
      : save.mutate({ fieldId, cropYear, line: toSaved(l, { removed: true }) })

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-3">
      <h2 className="text-sm font-semibold text-gray-800">{title}</h2>
      <table className="mt-2 w-full table-fixed text-xs">
        <thead>
          <tr className="text-left text-[11px] text-gray-500">
            <th className="w-[36%] pb-1 font-medium">{side === 'input' ? 'Input' : 'Output'}</th>
            <th className="pb-1 text-right font-medium">Cost</th>
            <th className="pb-1 text-right font-medium">Total amount</th>
            <th className="w-[19%] pb-1 text-right font-medium">Total</th>
            {canEdit && <th className="w-5" />}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {lines.map((l) => (
            <tr key={l.key} className="align-top">
              <td className="py-1.5 pr-1">
                <p className="truncate text-gray-800" title={l.label}>
                  {l.label}
                </p>
                <p className="truncate text-[10px] text-gray-400">{l.source}</p>
                {l.problem && l.total == null && <p className="text-[10px] text-amber-700">{l.problem}</p>}
              </td>
              <td className="py-1 text-right">
                <Cell
                  value={l.price}
                  prefix="$"
                  suffix={l.unit ? `/${l.unit}` : ''}
                  dp={l.price != null && l.price < 10 ? 3 : 2}
                  edited={l.edited.price}
                  canEdit={canEdit}
                  onCommit={(v) => edit(l, 'price', v)}
                  onReset={() => edit(l, 'price', null)}
                />
              </td>
              <td className="py-1 text-right">
                <Cell
                  value={l.amount}
                  suffix={l.unit ? ` ${l.unit}` : ''}
                  dp={1}
                  edited={l.edited.amount}
                  canEdit={canEdit}
                  onCommit={(v) => edit(l, 'amount', v)}
                  onReset={() => edit(l, 'amount', null)}
                />
              </td>
              <td className="py-1.5 text-right tabular-nums text-gray-800">{money(l.total)}</td>
              {canEdit && (
                <td className="py-1.5 text-right">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => drop(l)}
                    className="text-gray-300 hover:text-red-600"
                    aria-label={`Remove ${l.label}`}
                    title="Remove"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </td>
              )}
            </tr>
          ))}
          {!lines.length && (
            <tr>
              <td colSpan={5} className="py-2 text-gray-500">
                Nothing yet.
              </td>
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr className="border-t border-gray-200">
            <td colSpan={3} className="pt-1.5 font-semibold text-gray-800">
              Total {title.toLowerCase()}
            </td>
            <td className="pt-1.5 text-right font-semibold tabular-nums text-gray-900">{money(total)}</td>
            {canEdit && <td />}
          </tr>
        </tfoot>
      </table>

      {canEdit &&
        (adding ? (
          <AddLine
            side={side}
            acres={acres}
            busy={save.isPending}
            onCancel={() => setAdding(false)}
            onAdd={(line) => save.mutate({ fieldId, cropYear, line }, { onSuccess: () => setAdding(false) })}
          />
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="mt-2 flex items-center gap-1 text-xs font-medium text-brand-800 hover:underline"
          >
            <Plus className="h-3.5 w-3.5" /> Add {side === 'input' ? 'an input' : 'an output'}
          </button>
        ))}
      {error && <p className="mt-1 text-[11px] text-red-600">{error.message}</p>}
    </section>
  )
}

/** A figure that turns into a text box on click and saves on Enter or on leaving the box. */
function Cell({
  value,
  prefix = '',
  suffix = '',
  dp,
  edited,
  canEdit,
  onCommit,
  onReset,
}: {
  value: number | null
  prefix?: string
  suffix?: string
  dp: number
  edited: boolean
  canEdit: boolean
  onCommit: (v: number | null) => void
  onReset: () => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const shown =
    value == null
      ? '—'
      : `${prefix}${value.toLocaleString('en-CA', { maximumFractionDigits: dp, minimumFractionDigits: Math.min(dp, 2) })}${suffix}`
  if (!canEdit) return <span className="tabular-nums text-gray-700">{shown}</span>

  if (draft != null) {
    const parsed = parse(draft)
    const bad = draft.trim() !== '' && parsed == null
    const commit = () => {
      if (bad) return
      setDraft(null)
      if (parsed !== value) onCommit(parsed)
    }
    return (
      <input
        autoFocus
        inputMode="decimal"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') setDraft(null)
        }}
        className={cn('w-full rounded border px-1 py-0.5 text-right tabular-nums', bad ? 'border-red-400' : 'border-brand-600')}
      />
    )
  }
  return (
    <span className="inline-flex items-center justify-end gap-0.5">
      {edited && (
        <button type="button" onClick={onReset} title="Put the automatic figure back" className="text-gray-400 hover:text-brand-800">
          <RotateCcw className="h-3 w-3" />
        </button>
      )}
      <button
        type="button"
        onClick={() => setDraft(plain(value, dp))}
        title="Click to edit"
        className={cn(
          'rounded px-1 tabular-nums hover:bg-gray-100',
          edited ? 'font-medium text-brand-800' : value == null ? 'text-amber-700' : 'text-gray-700',
        )}
      >
        {shown}
      </button>
    </span>
  )
}

function AddLine({
  side,
  acres,
  busy,
  onAdd,
  onCancel,
}: {
  side: Side
  acres: number
  busy: boolean
  onAdd: (line: SavedLine) => void
  onCancel: () => void
}) {
  const [label, setLabel] = useState('')
  const [unit, setUnit] = useState(side === 'input' ? 'ac' : '')
  const [price, setPrice] = useState('')
  // Per-acre costs are the usual case, so the amount starts as the field's acres.
  const [amount, setAmount] = useState(side === 'input' && acres ? acres.toFixed(2) : '')
  const p = parse(price)
  const a = parse(amount)
  const ok = Boolean(label.trim()) && p != null && a != null
  return (
    <div className="mt-2 space-y-1.5 rounded-md bg-gray-50 p-2 text-xs">
      <input
        autoFocus
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder={side === 'input' ? 'e.g. Labour, Land rent, Fuel' : 'e.g. Straw'}
        className="w-full rounded border border-gray-300 px-1.5 py-1"
      />
      <div className="grid grid-cols-3 gap-1.5">
        <label className="space-y-0.5">
          <span className="text-[10px] text-gray-500">$ per unit</span>
          <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder="0.00" className="w-full rounded border border-gray-300 px-1.5 py-1 text-right" />
        </label>
        <label className="space-y-0.5">
          <span className="text-[10px] text-gray-500">Unit</span>
          <input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="ac, lb, L…" className="w-full rounded border border-gray-300 px-1.5 py-1" />
        </label>
        <label className="space-y-0.5">
          <span className="text-[10px] text-gray-500">Total amount</span>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className="w-full rounded border border-gray-300 px-1.5 py-1 text-right" />
        </label>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-gray-600">Total {p != null && a != null ? money(p * a, 2) : '—'}</span>
        <span className="flex gap-2">
          <button type="button" onClick={onCancel} className="text-gray-500 hover:text-gray-700">
            Cancel
          </button>
          <button
            type="button"
            disabled={!ok || busy}
            onClick={() =>
              onAdd({
                side,
                line_key: `manual-${crypto.randomUUID()}`,
                label: label.trim(),
                unit: unit.trim() || null,
                price_per_unit: p,
                amount: a,
                is_manual: true,
                removed: false,
              })
            }
            className="rounded-md bg-brand-800 px-2.5 py-1 font-medium text-white disabled:opacity-40"
          >
            Add
          </button>
        </span>
      </div>
    </div>
  )
}

/** The $/acre colour key, for the field map and the farm map alike. */
export function Legend({ stops }: { stops: { value: number; colour: string }[] }) {
  return (
    <div className="pointer-events-none absolute bottom-6 left-3 rounded-lg bg-white/95 p-3 text-xs shadow">
      <p className="mb-1 font-semibold text-gray-700">Net $/acre</p>
      <div className="flex h-3 w-48 overflow-hidden rounded">
        {stops.map((s) => (
          <div key={s.value} className="flex-1" style={{ background: s.colour }} />
        ))}
      </div>
      <div className="mt-1 flex justify-between tabular-nums text-gray-500">
        <span>{money(stops[0].value)}</span>
        <span>{money(stops[stops.length - 1].value)}</span>
      </div>
    </div>
  )
}
