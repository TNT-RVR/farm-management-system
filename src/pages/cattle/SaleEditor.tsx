import { DateField } from '@/components/DateField'
import { useState } from 'react'
import { Modal } from '@/components/Modal'
import { useMainRanch } from '@/lib/ranches'
import {
  daysAhead,
  useDeleteCattleSale,
  useSaveCattleSale,
  type CattleSale,
} from '@/lib/cattleMarkets'

const CLASSES = ['heifers', 'bulls', 'steers', 'runts'] as const
const input = 'mt-0.5 w-full rounded-md border border-gray-200 px-2 py-1.5 text-sm text-gray-900'

const numOrNull = (s: string): number | null => {
  const t = s.trim()
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

/**
 * Record a sale, or correct one.
 *
 * Exists chiefly so East Ranch's history can be entered without another
 * spreadsheet round trip — the workbook has the tab and no rows in it.
 *
 * Total pounds and total price are DERIVED as you type but stay editable. The
 * workbook's own arithmetic disagrees with head x weight in a few years, and
 * where it does, the recorded figure is the one that was banked.
 */
export function SaleEditor({
  existing,
  ranches,
  isManager,
  onClose,
}: {
  existing?: CattleSale
  ranches: string[]
  isManager: boolean
  onClose: () => void
}) {
  const save = useSaveCattleSale()
  const del = useDeleteCattleSale()
  const mainRanch = useMainRanch()
  const [d, setD] = useState({
    ranch: existing?.ranch ?? ranches[0] ?? mainRanch?.name ?? '',
    crop_year: String(existing?.crop_year ?? new Date().getFullYear()),
    animal_class: existing?.animal_class ?? ('heifers' as (typeof CLASSES)[number]),
    head: existing?.head != null ? String(existing.head) : '',
    sale_date: existing?.sale_date ?? '',
    delivery_date: existing?.delivery_date ?? '',
    avg_weight_lb: existing?.avg_weight_lb != null ? String(existing.avg_weight_lb) : '',
    total_lb: existing?.total_lb != null ? String(existing.total_lb) : '',
    price_per_lb: existing?.price_per_lb != null ? String(existing.price_per_lb) : '',
    total_price: existing?.total_price != null ? String(existing.total_price) : '',
    buyer: existing?.buyer ?? '',
    notes: existing?.notes ?? '',
  })

  const head = numOrNull(d.head)
  const weight = numOrNull(d.avg_weight_lb)
  const price = numOrNull(d.price_per_lb)
  const impliedLb = head != null && weight != null ? head * weight : null
  const lb = numOrNull(d.total_lb) ?? impliedLb
  const impliedTotal = lb != null && price != null ? lb * price : null

  const ahead = daysAhead({
    sale_date: d.sale_date || null,
    delivery_date: d.delivery_date || null,
  } as CattleSale)

  return (
    <Modal title={existing ? 'Edit sale' : 'Record a sale'} onClose={onClose}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <label className="text-xs text-gray-500">
            Ranch
            <select
              className={input}
              value={d.ranch}
              onChange={(e) => setD({ ...d, ranch: e.target.value })}
            >
              {ranches.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </label>
          <label className="text-xs text-gray-500">
            Year
            <input
              className={input}
              inputMode="numeric"
              value={d.crop_year}
              onChange={(e) => setD({ ...d, crop_year: e.target.value })}
            />
          </label>
          <label className="text-xs text-gray-500">
            Class
            <select
              className={input}
              value={d.animal_class}
              onChange={(e) =>
                setD({ ...d, animal_class: e.target.value as (typeof CLASSES)[number] })
              }
            >
              {CLASSES.map((c) => (
                <option key={c} value={c}>
                  {c[0].toUpperCase() + c.slice(1)}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-gray-500">
            Sale date — when the price was agreed
            <DateField value={d.sale_date} onChange={(v) => setD({ ...d, sale_date: v })} />
          </label>
          <label className="text-xs text-gray-500">
            Delivery date
            <DateField value={d.delivery_date} onChange={(v) => setD({ ...d, delivery_date: v })} />
          </label>
        </div>
        {ahead != null && ahead > 14 && (
          <p className="rounded-md bg-sky-50 px-2 py-1.5 text-xs text-sky-800">
            Priced <span className="font-semibold">{ahead} days</span> before delivery — this will
            be scored as a forward sale.
          </p>
        )}

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <label className="text-xs text-gray-500">
            Head
            <input
              className={input}
              inputMode="decimal"
              value={d.head}
              onChange={(e) => setD({ ...d, head: e.target.value })}
            />
          </label>
          <label className="text-xs text-gray-500">
            Avg weight (lb)
            <input
              className={input}
              inputMode="decimal"
              value={d.avg_weight_lb}
              onChange={(e) => setD({ ...d, avg_weight_lb: e.target.value })}
            />
          </label>
          <label className="text-xs text-gray-500">
            $/lb
            <input
              className={input}
              inputMode="decimal"
              value={d.price_per_lb}
              onChange={(e) => setD({ ...d, price_per_lb: e.target.value })}
            />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-gray-500">
            Total lb
            <input
              className={input}
              inputMode="decimal"
              placeholder={impliedLb != null ? impliedLb.toFixed(0) : ''}
              value={d.total_lb}
              onChange={(e) => setD({ ...d, total_lb: e.target.value })}
            />
            {impliedLb != null && !d.total_lb && (
              <span className="mt-0.5 block text-[11px] text-gray-400">
                {impliedLb.toFixed(0)} from head × weight — leave blank to use it
              </span>
            )}
          </label>
          <label className="text-xs text-gray-500">
            Total $
            <input
              className={input}
              inputMode="decimal"
              placeholder={impliedTotal != null ? impliedTotal.toFixed(2) : ''}
              value={d.total_price}
              onChange={(e) => setD({ ...d, total_price: e.target.value })}
            />
          </label>
        </div>

        <label className="block text-xs text-gray-500">
          Buyer
          <input
            className={input}
            placeholder="Calgary Stockyards / Alta Prime"
            value={d.buyer}
            onChange={(e) => setD({ ...d, buyer: e.target.value })}
          />
        </label>
        <label className="block text-xs text-gray-500">
          Notes
          <textarea
            rows={2}
            className={input}
            value={d.notes}
            onChange={(e) => setD({ ...d, notes: e.target.value })}
          />
        </label>

        <div className="flex items-center justify-between gap-2">
          {existing && isManager ? (
            <button
              onClick={async () => {
                await del.mutateAsync(existing.id)
                onClose()
              }}
              className="rounded-md px-2 py-1.5 text-sm text-red-600 hover:bg-red-50"
            >
              Delete
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
            >
              Cancel
            </button>
            <button
              disabled={save.isPending || !numOrNull(d.crop_year)}
              onClick={async () => {
                await save.mutateAsync({
                  id: existing?.id,
                  ranch: d.ranch,
                  crop_year: numOrNull(d.crop_year) ?? new Date().getFullYear(),
                  animal_class: d.animal_class,
                  head,
                  sale_date: d.sale_date || null,
                  delivery_date: d.delivery_date || null,
                  avg_weight_lb: weight,
                  total_lb: numOrNull(d.total_lb) ?? impliedLb,
                  price_per_lb: price,
                  total_price: numOrNull(d.total_price) ?? impliedTotal,
                  buyer: d.buyer.trim() || null,
                  notes: d.notes.trim() || null,
                })
                onClose()
              }}
              className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50"
            >
              {save.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
