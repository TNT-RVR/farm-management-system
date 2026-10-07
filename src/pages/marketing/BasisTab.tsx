import { useMemo, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Modal } from '@/components/Modal'
import { Select } from '@/components/Select'
import {
  useCashBids,
  useDeleteCashBid,
  useLatestCropPrices,
  useSaveCashBid,
  useUpdateCashBid,
} from '@/lib/marketing-data'
import { rowClick } from '@/components/RecordEditor'
import { basisPercentile } from '@/lib/marketing'
import { useCrops } from '@/lib/queries'
import { hasManagerAccess, useAuth } from '@/lib/auth'
import { fmtMoney } from '@/lib/applied'
import { HelpNote } from '@/components/HelpNote'
import { cn } from '@/lib/utils'

/**
 * The gap between what a buyer offers and what the board says.
 *
 * Basis is the half of the price a farm can actually act on separately: the
 * board is the board, but a bid that is sixty cents under it in October and
 * twenty under in March is a real difference worth waiting for. None of that is
 * visible without a record of past bids, which is what this collects.
 */
export function BasisTab() {
  const { profile } = useAuth()
  const isManager = hasManagerAccess(profile?.role)
  const { data: bids, isLoading } = useCashBids()
  const { data: crops } = useCrops()
  const { data: prices } = useLatestCropPrices()
  const save = useSaveCashBid()
  const del = useDeleteCashBid()
  const update = useUpdateCashBid()
  const [adding, setAdding] = useState(false)
  // A recorded bid opened to correct it (Sam, 7 Oct 2026).
  const [editingId, setEditingId] = useState<string | null>(null)
  const editing = (bids ?? []).find((b) => b.id === editingId) ?? null
  const [cropFilter, setCropFilter] = useState('')

  const rows = useMemo(
    () => (bids ?? []).filter((b) => !cropFilter || b.crop_id === cropFilter),
    [bids, cropFilter],
  )

  // Per crop, so a percentile compares canola against canola.
  const percentileFor = useMemo(() => {
    const byCrop = new Map<string, { on: string; basis: number | null }[]>()
    for (const b of bids ?? []) {
      const list = byCrop.get(b.crop_id) ?? []
      list.push({ on: b.bid_on, basis: b.basis })
      byCrop.set(b.crop_id, list)
    }
    return (cropId: string, value: number | null) =>
      basisPercentile(byCrop.get(cropId) ?? [], value)
  }, [bids])

  const cropOptions = (crops ?? [])
    .filter((c) => c.active)
    .map((c) => ({ value: c.id, label: c.name }))

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Select
          value={cropFilter}
          ariaLabel="Crop"
          className="w-52"
          onChange={setCropFilter}
          options={[{ value: '', label: 'All crops' }, ...cropOptions]}
        />
        {isManager && (
          <button
            onClick={() => setAdding(true)}
            className="ml-auto flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            <Plus className="h-4 w-4" /> Record a bid
          </button>
        )}
      </div>

      {isLoading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="rounded-lg border border-gray-200 bg-white px-3 py-10 text-center text-sm text-gray-500">
          No bids recorded yet. Every time you phone an elevator, put the number in here — basis
          only says anything once it has a history to be compared against.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs text-gray-500">
              <tr>
                <th className="px-3 py-2 font-medium">Date</th>
                <th className="px-3 py-2 font-medium">Crop</th>
                <th className="px-3 py-2 font-medium">Buyer</th>
                <th className="px-3 py-2 text-right font-medium">Bid</th>
                <th className="px-3 py-2 text-right font-medium">Board</th>
                <th className="px-3 py-2 text-right font-medium">Basis</th>
                <th className="px-3 py-2 font-medium">Vs our history</th>
                <th className="px-3 py-2 font-medium">Delivery</th>
                {isManager && <th className="px-3 py-2" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((b) => {
                const pct = percentileFor(b.crop_id, b.basis)
                return (
                  <tr
                    key={b.id}
                    onClick={isManager ? rowClick(() => setEditingId(b.id)) : undefined}
                    className={cn(isManager && 'cursor-pointer hover:bg-gray-50')}
                  >
                    <td className="px-3 py-2 tabular-nums text-gray-600">{b.bid_on}</td>
                    <td className="px-3 py-2 font-medium text-gray-800">{b.crop_name}</td>
                    <td className="px-3 py-2 text-gray-700">
                      {b.buyer}
                      {b.location && (
                        <span className="block text-[10px] text-gray-400">{b.location}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {fmtMoney(b.price_per_unit)}
                      <span className="text-[10px] text-gray-400">/{b.unit}</span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-600">
                      {b.futures_value == null ? (
                        <span className="text-gray-300" title="No futures quote linked to this bid">
                          —
                        </span>
                      ) : (
                        fmtMoney(b.futures_value)
                      )}
                    </td>
                    {/* Under the board is the normal state inland, so the sign
                        is information rather than an error. */}
                    <td
                      className={cn(
                        'px-3 py-2 text-right font-medium tabular-nums',
                        b.basis != null && (b.basis >= 0 ? 'text-green-700' : 'text-gray-800'),
                      )}
                    >
                      {b.basis == null ? (
                        <span className="font-normal text-gray-300">—</span>
                      ) : (
                        `${b.basis >= 0 ? '+' : ''}${fmtMoney(b.basis)}`
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {pct == null ? (
                        <span className="text-gray-300">not enough history</span>
                      ) : (
                        <span className={cn(pct >= 0.75 && 'font-medium text-green-700')}>
                          better than {Math.round(pct * 100)}% of our bids
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-500">{b.delivery_month ?? '—'}</td>
                    {isManager && (
                      <td className="px-3 py-2 text-right">
                        <button
                          onClick={() => {
                            if (confirm(`Delete the ${b.bid_on} bid from ${b.buyer}?`)) del.mutate(b.id)
                          }}
                          title="Delete this bid"
                          className="text-gray-300 hover:text-red-600"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <HelpNote className="mt-3" summary="Basis is the bid minus the futures price on the day it was quoted." title="How basis is worked out">
        Basis is the bid minus the futures price on the day it was quoted — not against today's
        board, which would compare two different moments and mean nothing. A bid with no market
        series attached is still kept as price history.
      </HelpNote>

      {editing && (
        <AddBidDialog
          existing={editing}
          crops={(crops ?? []).filter((c) => c.active || c.id === editing.crop_id).map((c) => ({ value: c.id, label: c.name }))}
          series={(prices?.series ?? []).map((s) => ({ value: s.id, label: s.name }))}
          busy={update.isPending || del.isPending}
          error={(update.error ?? del.error) as Error | null}
          onClose={() => setEditingId(null)}
          onSave={(bid) => update.mutate({ id: editing.id, ...bid }, { onSuccess: () => setEditingId(null) })}
          onDelete={() => del.mutate(editing.id, { onSuccess: () => setEditingId(null) })}
        />
      )}

      {adding && (
        <AddBidDialog
          crops={cropOptions}
          series={(prices?.series ?? []).map((s) => ({ value: s.id, label: s.name }))}
          busy={save.isPending}
          error={save.error as Error | null}
          onClose={() => setAdding(false)}
          onSave={(bid) => save.mutate(bid, { onSuccess: () => setAdding(false) })}
        />
      )}
    </>
  )
}

/** Record a bid, or correct one already recorded (`existing`, with Delete). */
function AddBidDialog({
  existing,
  crops,
  series,
  busy,
  error,
  onClose,
  onSave,
  onDelete,
}: {
  existing?: {
    crop_id: string
    buyer: string
    bid_on: string
    price_per_unit: number
    unit: string
    location: string | null
    delivery_month: string | null
    series_id: string | null
    contract_month: string | null
  }
  onDelete?: () => void
  crops: { value: string; label: string }[]
  series: { value: string; label: string }[]
  busy: boolean
  error: Error | null
  onClose: () => void
  onSave: (bid: {
    crop_id: string
    buyer: string
    bid_on: string
    price_per_unit: number
    unit: string
    location?: string | null
    delivery_month?: string | null
    series_id?: string | null
    contract_month?: string | null
  }) => void
}) {
  const [cropId, setCropId] = useState(existing?.crop_id ?? crops[0]?.value ?? '')
  const [buyer, setBuyer] = useState(existing?.buyer ?? '')
  const [bidOn, setBidOn] = useState(existing?.bid_on ?? new Date().toISOString().slice(0, 10))
  const [price, setPrice] = useState(existing ? String(existing.price_per_unit) : '')
  const [unit, setUnit] = useState(existing?.unit ?? 'bu')
  const [location, setLocation] = useState(existing?.location ?? '')
  const [deliveryMonth, setDeliveryMonth] = useState(existing?.delivery_month ?? '')
  const [seriesId, setSeriesId] = useState(existing?.series_id ?? '')
  const [contractMonth, setContractMonth] = useState(existing?.contract_month ?? '')

  const value = Number(price)
  const valid = cropId && buyer.trim() && Number.isFinite(value) && value > 0

  return (
    <Modal title={existing ? 'Correct the bid' : 'Record a bid'} onClose={onClose}>
      <div className="space-y-2.5 text-sm">
        <label className="block">
          <span className="text-xs text-gray-500">Crop</span>
          <Select value={cropId} ariaLabel="Crop" onChange={setCropId} options={crops} />
        </label>
        <label className="block">
          <span className="text-xs text-gray-500">Buyer</span>
          <input
            value={buyer}
            onChange={(e) => setBuyer(e.target.value)}
            placeholder="Elevator or processor"
            className="w-full rounded-md border border-gray-300 px-2 py-1.5"
          />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="text-xs text-gray-500">Date quoted</span>
            <input
              type="date"
              value={bidOn}
              onChange={(e) => setBidOn(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-2 py-1.5"
            />
          </label>
          <label className="block">
            <span className="text-xs text-gray-500">Location</span>
            <input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Delivery point"
              className="w-full rounded-md border border-gray-300 px-2 py-1.5"
            />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="text-xs text-gray-500">Bid</span>
            <input
              type="number"
              step="0.01"
              min="0"
              inputMode="decimal"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-right tabular-nums"
            />
          </label>
          <label className="block">
            <span className="text-xs text-gray-500">Per</span>
            <Select
              value={unit}
              ariaLabel="Unit"
              onChange={setUnit}
              options={[
                { value: 'bu', label: 'bushel' },
                { value: 'lbs', label: 'pound' },
                { value: 'cwt', label: 'hundredweight' },
                { value: 'ton', label: 'ton' },
                { value: 'MT', label: 'tonne' },
              ]}
            />
          </label>
        </div>
        <label className="block">
          <span className="text-xs text-gray-500">Delivery period</span>
          <input
            value={deliveryMonth}
            onChange={(e) => setDeliveryMonth(e.target.value)}
            placeholder="Nov–Dec 2026"
            className="w-full rounded-md border border-gray-300 px-2 py-1.5"
          />
        </label>

        {/* Optional, and labelled as such: a bid is worth recording even when
            nobody knows which board it was struck against. */}
        <div className="rounded-md bg-gray-50 p-2.5">
          <p className="mb-2 text-xs text-gray-500">
            Optional — link a futures series and contract month and the basis is worked out for you.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Select
              value={seriesId}
              ariaLabel="Futures series"
              onChange={setSeriesId}
              options={[{ value: '', label: 'No board' }, ...series]}
            />
            <input
              type="date"
              value={contractMonth}
              onChange={(e) => setContractMonth(e.target.value)}
              title="First of the contract month"
              className="w-full rounded-md border border-gray-300 px-2 py-1.5"
            />
          </div>
        </div>

        {error && <p className="text-xs text-red-600">{error.message}</p>}

        <div className="flex justify-end gap-2 pt-1">
          {onDelete && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (confirm('Delete this bid?')) onDelete()
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
                buyer: buyer.trim(),
                bid_on: bidOn,
                price_per_unit: value,
                unit,
                location: location.trim() || null,
                delivery_month: deliveryMonth.trim() || null,
                series_id: seriesId || null,
                contract_month: contractMonth || null,
              })
            }
            className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? 'Saving…' : existing ? 'Save changes' : 'Save bid'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
