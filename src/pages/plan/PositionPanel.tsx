import { DateField } from '@/components/DateField'
import { useState } from 'react'
import { Modal } from '@/components/Modal'
import { useDeleteContract, useSaveContract, type Contract } from '@/lib/contracts'
import { useContacts } from '@/lib/sales'
import type { Database } from '@/lib/database.types'

type ContractStatus = NonNullable<
  Database['public']['Tables']['contracts']['Insert']['status']
>

const money = (v: number, dp = 2) =>
  `$${v.toLocaleString('en-CA', { minimumFractionDigits: dp, maximumFractionDigits: dp })}`
const input = 'mt-0.5 w-full rounded-md border border-gray-200 px-2 py-1.5 text-sm text-gray-900'
const numOrNull = (s: string) => {
  const t = s.trim()
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

/**
 * Every field of one contract, in a dialog.
 *
 * This file was the Markets page's position panel — what is still to sell,
 * the contract list, and this editor — which made it a second place to keep
 * contracts beside the Contracts view. The position table moved to Contracts ›
 * Position (with its delivered and sold-vs-market columns), the list was the
 * Contracts tab already, and the editor is what a contract row there opens, so
 * the notes and the fields the inline table cannot change are still editable.
 *
 * `deliveredFromTickets`: the delivered figure is worked out from scale
 * tickets and weighed loads once there are any, and a typed one would be
 * overwritten by the next ticket, so it is shown and not offered.
 */
export function ContractEditor({
  cropYear,
  existing,
  crops,
  isManager,
  deliveredFromTickets = false,
  onClose,
}: {
  cropYear: number
  existing?: Contract
  crops: { id: string; name: string }[]
  isManager: boolean
  deliveredFromTickets?: boolean
  onClose: () => void
}) {
  const save = useSaveContract()
  const del = useDeleteContract()
  const { data: contacts } = useContacts()
  const [d, setD] = useState<{
    crop_id: string
    buyer_contact_id: string
    contract_number: string
    bushels: string
    price_per_unit: string
    delivery_start: string
    delivery_end: string
    delivered_bu: string
    status: ContractStatus
    notes_md: string
  }>({
    crop_id: existing?.crop_id ?? crops[0]?.id ?? '',
    buyer_contact_id: existing?.buyer_contact_id ?? '',
    contract_number: existing?.contract_number ?? '',
    bushels: existing?.bushels != null ? String(existing.bushels) : '',
    price_per_unit: existing?.price_per_unit != null ? String(existing.price_per_unit) : '',
    delivery_start: existing?.delivery_start ?? '',
    delivery_end: existing?.delivery_end ?? '',
    delivered_bu: existing?.delivered_bu != null ? String(existing.delivered_bu) : '',
    status: (existing?.status as ContractStatus) ?? 'open',
    notes_md: existing?.notes_md ?? '',
  })

  const bushels = numOrNull(d.bushels)
  const price = numOrNull(d.price_per_unit)

  return (
    <Modal title={existing ? 'Edit contract' : `New contract · ${cropYear}`} onClose={onClose}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-gray-500">
            Crop
            <select
              className={input}
              value={d.crop_id}
              onChange={(e) => setD({ ...d, crop_id: e.target.value })}
            >
              {crops.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-gray-500">
            Contract number
            <input
              className={input}
              value={d.contract_number}
              onChange={(e) => setD({ ...d, contract_number: e.target.value })}
            />
          </label>
          {/* The buyer could be picked only when the contract was added (7 Oct 2026). */}
          <label className="col-span-2 text-xs text-gray-500">
            Buyer
            <select className={input} value={d.buyer_contact_id} onChange={(e) => setD({ ...d, buyer_contact_id: e.target.value })}>
              <option value="">—</option>
              {(contacts ?? [])
                .filter((c) => c.type === 'buyer' || c.type === 'other' || c.id === d.buyer_contact_id)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.company || c.contact_name || '—'}
                  </option>
                ))}
            </select>
          </label>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <label className="text-xs text-gray-500">
            Bushels
            <input
              className={input}
              inputMode="decimal"
              value={d.bushels}
              onChange={(e) => setD({ ...d, bushels: e.target.value })}
            />
          </label>
          <label className="text-xs text-gray-500">
            Price per bushel
            <input
              className={input}
              inputMode="decimal"
              value={d.price_per_unit}
              onChange={(e) => setD({ ...d, price_per_unit: e.target.value })}
            />
          </label>
          <label className="text-xs text-gray-500">
            Delivered so far{deliveredFromTickets && ' · from tickets'}
            <input
              className={input}
              inputMode="decimal"
              value={d.delivered_bu}
              readOnly={deliveredFromTickets}
              title={deliveredFromTickets ? 'Worked out from the scale tickets and weighed loads' : undefined}
              onChange={(e) => setD({ ...d, delivered_bu: e.target.value })}
            />
          </label>
        </div>
        {bushels != null && price != null && (
          <p className="rounded-md bg-gray-50 px-2 py-1.5 text-sm">
            <span className="text-gray-500">Contract value</span>{' '}
            <span className="font-semibold tabular-nums text-gray-900">
              {money(bushels * price, 0)}
            </span>
          </p>
        )}

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <label className="text-xs text-gray-500">
            Delivery from
            <DateField value={d.delivery_start} onChange={(v) => setD({ ...d, delivery_start: v })} />
          </label>
          <label className="text-xs text-gray-500">
            to
            <DateField value={d.delivery_end} onChange={(v) => setD({ ...d, delivery_end: v })} />
          </label>
          <label className="text-xs text-gray-500">
            Status
            <select
              className={input}
              value={d.status}
              onChange={(e) => setD({ ...d, status: e.target.value as ContractStatus })}
            >
              {(['open', 'partial', 'delivered', 'cancelled'] as const).map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
        </div>

        <label className="block text-xs text-gray-500">
          Notes
          <textarea
            rows={2}
            className={input}
            value={d.notes_md}
            onChange={(e) => setD({ ...d, notes_md: e.target.value })}
          />
        </label>

        <div className="flex items-center justify-between gap-2">
          {existing && isManager ? (
            <button
              onClick={async () => {
                if (!confirm('Delete this contract?')) return
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
              disabled={save.isPending}
              onClick={async () => {
                await save.mutateAsync({
                  id: existing?.id,
                  crop_year: cropYear,
                  crop_id: d.crop_id || null,
                  buyer_contact_id: d.buyer_contact_id || null,
                  contract_number: d.contract_number.trim() || null,
                  bushels,
                  price_per_unit: price,
                  delivery_start: d.delivery_start || null,
                  delivery_end: d.delivery_end || null,
                  // The column is not nullable and means "none delivered yet",
                  // so a blank box is zero rather than unknown. Left out when
                  // the tickets own it, so a save never undoes a ticket.
                  ...(deliveredFromTickets ? {} : { delivered_bu: numOrNull(d.delivered_bu) ?? 0 }),
                  status: d.status,
                  notes_md: d.notes_md.trim() || null,
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
