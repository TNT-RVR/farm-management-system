import { useMemo, useState } from 'react'
import { Check, Plus, Trash2 } from 'lucide-react'
import { rowClick } from '@/components/RecordEditor'
import { Modal } from '@/components/Modal'
import { HelpNote } from '@/components/HelpNote'
import { Select } from '@/components/Select'
import {
  useCropInputs,
  useCropPosition,
  useDeleteTarget,
  useLatestCropPrices,
  useMarketingTargets,
  useSaveTarget,
  useUpdateTarget,
} from '@/lib/marketing-data'
import { breakeven, evaluateTarget, isMarketable, summarise, totalCostPerAcre } from '@/lib/marketing'
import { hasManagerAccess, useAuth } from '@/lib/auth'
import { fmtMoney } from '@/lib/applied'
import { fmtUnitPrice } from '@/lib/board-price'
import { cn } from '@/lib/utils'

/**
 * The price you would sell at.
 *
 * The margin mode is the one worth using. A fixed target set last spring is a
 * number from a year when fertiliser cost something different; "two dollars over
 * what it cost me" survives that, and moves on its own as the invoices come in.
 */
export function TargetsTab({ year }: { year: number }) {
  const { profile } = useAuth()
  const isManager = hasManagerAccess(profile?.role)
  const { data: targets, isLoading } = useMarketingTargets()
  const { data: positions } = useCropPosition()
  const { data: inputs } = useCropInputs()
  const { data: prices } = useLatestCropPrices()
  const save = useSaveTarget()
  const update = useUpdateTarget()
  const remove = useDeleteTarget()
  const [adding, setAdding] = useState(false)
  // A target opened to change it (Sam, 7 Oct 2026).
  const [editingId, setEditingId] = useState<string | null>(null)
  const editing = (targets ?? []).find((t) => t.id === editingId) ?? null

  const cropsForYear = useMemo(
    () => (positions ?? []).filter((p) => p.cropYear === year && isMarketable(p)),
    [positions, year],
  )

  /** Breakeven per crop, so a margin target has something to sit on top of. */
  const breakevenFor = useMemo(() => {
    const m = new Map<string, number | null>()
    for (const p of cropsForYear) {
      const lines = inputs?.get(`${p.cropYear}:${p.cropId}`) ?? []
      const yieldPerAcre = p.acres > 0 ? p.expected / p.acres : 0
      m.set(p.cropId, lines.length ? breakeven(totalCostPerAcre(lines), yieldPerAcre) : null)
    }
    return m
  }, [cropsForYear, inputs])

  const rows = useMemo(
    () =>
      (targets ?? [])
        .filter((t) => t.cropYear === year)
        .map((t) => {
          const p = cropsForYear.find((c) => c.cropId === t.cropId)
          const board = prices?.byCrop.get(t.cropId)
          const be = breakevenFor.get(t.cropId) ?? null
          return { t, p, board, be, state: evaluateTarget(t, be, board?.value ?? null) }
        }),
    [targets, year, cropsForYear, prices, breakevenFor],
  )

  if (isLoading) return <p className="text-sm text-gray-500">Loading…</p>

  return (
    <>
      {isManager && (
        <div className="mb-3 flex justify-end">
          <button
            onClick={() => setAdding(true)}
            disabled={!cropsForYear.length}
            className="flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" /> Set a target
          </button>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="rounded-lg border border-gray-200 bg-white px-3 py-10 text-center text-sm text-gray-500">
          No targets set for {year}.
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map(({ t, p, board, be, state }) => {
            const open = p ? summarise(p).open : null
            return (
              <li
                key={t.id}
                onClick={isManager ? rowClick(() => setEditingId(t.id)) : undefined}
                className={cn(
                  'rounded-lg border bg-white p-3',
                  isManager && 'cursor-pointer hover:border-gray-300',
                  state.hit ? 'border-green-300 bg-green-50/50' : 'border-gray-200',
                  !t.active && 'opacity-60',
                )}
              >
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium text-gray-900">{p?.cropName ?? 'Crop'}</span>
                  <span className="text-sm text-gray-600">
                    {t.mode === 'absolute'
                      ? `sell at ${fmtMoney(t.value)}`
                      : `sell at ${fmtMoney(t.value)} over breakeven`}
                  </span>
                  {state.hit && (
                    <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-green-600 px-2 py-0.5 text-[11px] font-medium text-white">
                      <Check className="h-3 w-3" /> Target met
                    </span>
                  )}
                </div>

                <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-xs text-gray-600">
                  <span>
                    Threshold:{' '}
                    {state.threshold == null ? (
                      <span
                        className="text-amber-700"
                        title="A margin target needs a breakeven, and this crop has no budget lines"
                      >
                        no breakeven yet
                      </span>
                    ) : (
                      <span className="font-medium tabular-nums text-gray-900">
                        {fmtUnitPrice(state.threshold, p?.unit ?? null)}
                      </span>
                    )}
                  </span>
                  <span>
                    Board:{' '}
                    {board ? (
                      <span className="tabular-nums" title={`${board.name}, ${board.on} — ${board.basis}`}>
                        {fmtUnitPrice(board.value, board.unit)}/{board.unit}
                        {board.converted && <span className="text-gray-400"> (from {board.quoted})</span>}
                      </span>
                    ) : (
                      <span className="text-gray-400">none linked</span>
                    )}
                  </span>
                  {state.distance != null && (
                    <span className={state.distance >= 0 ? 'text-green-700' : 'text-gray-500'}>
                      {state.distance >= 0 ? 'Over by ' : 'Short by '}
                      <span className="tabular-nums">{fmtUnitPrice(Math.abs(state.distance), p?.unit ?? null)}</span>
                    </span>
                  )}
                  {be != null && <span>Breakeven {fmtUnitPrice(be, p?.unit ?? null)}</span>}
                  {open != null && p && (
                    <span>
                      Would price{' '}
                      {(t.quantity ?? open).toLocaleString('en-CA', { maximumFractionDigits: 0 })}{' '}
                      {p.unit}
                      {t.quantity == null && ' (the rest)'}
                    </span>
                  )}
                </div>

                {t.note && <p className="mt-1 text-xs text-gray-500">{t.note}</p>}

                {isManager && (
                  <button
                    onClick={() => update.mutate({ id: t.id, active: !t.active })}
                    className="mt-1.5 text-xs text-gray-500 underline hover:text-gray-700"
                  >
                    {t.active ? 'Retire this target' : 'Reactivate'}
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}

      <HelpNote
        className="mt-3"
        summary="A target is a note to yourself, not an order."
        title="What a target is"
      >
        A target is a note to yourself, not an order — nothing here places a trade or tells anyone
        to sell. Margin targets move as input costs do, so they stay meaningful across a season in
        a way a fixed price does not.
      </HelpNote>

      {editing && (
        <AddTargetDialog
          year={year}
          existing={editing}
          crops={[{ value: editing.cropId, label: cropsForYear.find((c) => c.cropId === editing.cropId)?.cropName ?? 'Crop' }]}
          busy={update.isPending || remove.isPending}
          error={(update.error ?? remove.error) as Error | null}
          onClose={() => setEditingId(null)}
          onSave={(t) =>
            update.mutate(
              { id: editing.id, mode: t.mode, value: t.value, quantity: t.quantity ?? null, note: t.note ?? null },
              { onSuccess: () => setEditingId(null) },
            )
          }
          onDelete={() => remove.mutate(editing.id, { onSuccess: () => setEditingId(null) })}
        />
      )}

      {adding && (
        <AddTargetDialog
          year={year}
          crops={cropsForYear.map((c) => ({ value: c.cropId, label: c.cropName }))}
          busy={save.isPending}
          error={save.error as Error | null}
          onClose={() => setAdding(false)}
          onSave={(t) => save.mutate(t, { onSuccess: () => setAdding(false) })}
        />
      )}
    </>
  )
}

/** Set a target, or change one (`existing`: its crop stays, Delete offered). */
function AddTargetDialog({
  year,
  existing,
  crops,
  busy,
  error,
  onClose,
  onSave,
  onDelete,
}: {
  year: number
  existing?: { cropId: string; mode: 'absolute' | 'over_breakeven'; value: number; quantity: number | null; note: string | null }
  onDelete?: () => void
  crops: { value: string; label: string }[]
  busy: boolean
  error: Error | null
  onClose: () => void
  onSave: (t: {
    crop_id: string
    crop_year: number
    mode: 'absolute' | 'over_breakeven'
    value: number
    quantity?: number | null
    note?: string | null
  }) => void
}) {
  const [cropId, setCropId] = useState(existing?.cropId ?? crops[0]?.value ?? '')
  const [mode, setMode] = useState<'absolute' | 'over_breakeven'>(existing?.mode ?? 'over_breakeven')
  const [value, setValue] = useState(existing ? String(existing.value) : '')
  const [quantity, setQuantity] = useState(existing?.quantity != null ? String(existing.quantity) : '')
  const [note, setNote] = useState(existing?.note ?? '')

  const v = Number(value)
  const valid = cropId && Number.isFinite(v) && v > 0

  return (
    <Modal title={existing ? `Target for ${year}` : `Set a target for ${year}`} onClose={onClose}>
      <div className="space-y-2.5 text-sm">
        <label className="block">
          <span className="text-xs text-gray-500">Crop</span>
          <Select value={cropId} ariaLabel="Crop" onChange={setCropId} options={crops} />
        </label>
        <label className="block">
          <span className="text-xs text-gray-500">Kind of target</span>
          <Select
            value={mode}
            ariaLabel="Target type"
            onChange={(m) => setMode(m as 'absolute' | 'over_breakeven')}
            options={[
              { value: 'over_breakeven', label: 'A margin over what it cost to grow' },
              { value: 'absolute', label: 'A fixed price' },
            ]}
          />
        </label>
        <label className="block">
          <span className="text-xs text-gray-500">
            {mode === 'absolute' ? 'Sell at this price' : 'This much over breakeven'}
          </span>
          <input
            type="number"
            step="0.01"
            min="0"
            inputMode="decimal"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-right tabular-nums"
          />
        </label>
        <label className="block">
          <span className="text-xs text-gray-500">How much to price (blank means the rest)</span>
          <input
            type="number"
            min="0"
            inputMode="decimal"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            placeholder="the rest of it"
            className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-right tabular-nums"
          />
        </label>
        <label className="block">
          <span className="text-xs text-gray-500">Note</span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Why this number"
            className="w-full rounded-md border border-gray-300 px-2 py-1.5"
          />
        </label>

        {error && <p className="text-xs text-red-600">{error.message}</p>}

        <div className="flex justify-end gap-2 pt-1">
          {onDelete && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (confirm('Delete this target?')) onDelete()
              }}
              className="mr-auto flex items-center gap-1 rounded-md border border-red-200 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" /> Delete
            </button>
          )}
          <button onClick={onClose} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm">
            Cancel
          </button>
          <button
            disabled={!valid || busy}
            onClick={() =>
              onSave({
                crop_id: cropId,
                crop_year: year,
                mode,
                value: v,
                quantity: quantity.trim() === '' ? null : Number(quantity),
                note: note.trim() || null,
              })
            }
            className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? 'Saving…' : existing ? 'Save changes' : 'Set target'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
