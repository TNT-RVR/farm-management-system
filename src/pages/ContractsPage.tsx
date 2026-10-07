import { DateField } from '@/components/DateField'
import { DeliveriesTab } from '@/pages/contracts/DeliveriesTab'
import { PillTabs } from '@/components/PillTabs'
import { PositionTab } from '@/pages/marketing/PositionTab'
import { ScaleTickets } from '@/pages/contracts/ScaleTickets'
import { CashFlowTab } from '@/pages/marketing/CashFlowTab'
import { ContractEditor } from '@/pages/plan/PositionPanel'
import { useMemo, useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { hasManagerAccess, useAuth } from '@/lib/auth'
import { useCropYear } from '@/lib/crop-year'
import { useTab } from '@/lib/useTab'
import { useCrops } from '@/lib/queries'
import { useScaleTickets } from '@/lib/scale-tickets'
import { useBinLoads } from '@/lib/bin-loads'
import {
  CONTRACT_STATUSES,
  useContacts,
  useContractMutations,
  useContracts,
  type ContractRow,
  type ContractStatus,
} from '@/lib/sales'
import { money, money2 } from '@/lib/planner'
import { Select } from '@/components/Select'
import { cn } from '@/lib/utils'
import { rowClick } from '@/components/RecordEditor'

const STATUS_COLORS: Record<ContractStatus, string> = {
  open: 'bg-sky-100 text-sky-800',
  partial: 'bg-amber-100 text-amber-800',
  delivered: 'bg-green-100 text-green-800',
  cancelled: 'bg-gray-100 text-gray-500',
}

const CONTRACT_TABS = [
  { key: 'contracts', label: 'Contracts' },
  { key: 'tickets', label: 'Scale tickets' },
  { key: 'position', label: 'Position' },
  { key: 'cashflow', label: 'Cash flow' },
] as const
type ContractTab = (typeof CONTRACT_TABS)[number]['key']

/** "Sep 1", with the year only when it is not the crop year's. */
const shortDate = (d: string | null, year: number) =>
  d
    ? new Date(`${d}T12:00:00Z`).toLocaleDateString('en-CA', {
        month: 'short',
        day: 'numeric',
        ...(d.startsWith(String(year)) ? {} : { year: 'numeric' }),
      })
    : '?'

/**
 * Contracts, and the two questions they answer.
 *
 * Position is what a contract list is for — how much of the crop is actually
 * sold — and cash flow is when the money for it arrives. Both were built as a
 * separate Marketing view; both belong here, beside the contracts they read.
 *
 * Deliveries — what is left to haul on each open contract, and from which
 * bins — was a tab of its own and sits under Position now: what is sold and
 * what is still to go out are read together. Old ?tab=deliveries links land
 * there.
 */
export function ContractsPage() {
  const { profile } = useAuth()
  const { cropYear } = useCropYear()
  const isManager = hasManagerAccess(profile?.role)
  const isPast = cropYear < new Date().getFullYear()
  const { data: contracts } = useContracts(cropYear)
  const { data: crops } = useCrops()
  const { data: contacts } = useContacts()
  const { create, update, remove } = useContractMutations(cropYear)

  // In the address, so the Markets page's "% sold" line can open Position.
  const [tab, setTab] = useTab<ContractTab>(
    'contracts',
    CONTRACT_TABS.map((t) => t.key),
    'contracts',
    (asked) => (asked === 'deliveries' ? 'position' : undefined),
  )
  const { data: tickets } = useScaleTickets(cropYear)
  const { data: loads } = useBinLoads()
  // Contracts whose delivered figure the database works out from scale
  // tickets and weighed plant loads (contract_delivered). Typing over it would
  // last only until the next ticket, so those show it rather than offer it.
  const ticketed = useMemo(() => {
    const s = new Set<string>()
    for (const t of tickets ?? []) if (t.contract_id) s.add(t.contract_id)
    for (const l of loads ?? [])
      if (l.contract_id && l.gross_kg != null && l.tare_kg != null) s.add(l.contract_id)
    return s
  }, [tickets, loads])
  const [editing, setEditing] = useState<ContractRow | null>(null)
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({
    crop_id: '',
    buyer_contact_id: '',
    contract_number: '',
    bushels: '',
    price_per_unit: '',
    delivery_start: '',
    delivery_end: '',
  })

  const cropName = (id: string | null) => crops?.find((c) => c.id === id)?.name ?? '—'
  const cropUnit = (id: string | null) => crops?.find((c) => c.id === id)?.yield_unit ?? ''
  const buyerName = (id: string | null) => {
    const c = contacts?.find((x) => x.id === id)
    return c ? c.company || c.contact_name || '—' : '—'
  }

  const totals = useMemo(() => {
    const active = (contracts ?? []).filter((c) => c.status !== 'cancelled')
    return {
      count: active.length,
      contractedValue: active.reduce((s, c) => s + (c.bushels ?? 0) * (c.price_per_unit ?? 0), 0),
      delivered: active.reduce((s, c) => s + c.delivered_bu, 0),
      committed: active.reduce((s, c) => s + (c.bushels ?? 0), 0),
    }
  }, [contracts])

  return (
    <div className="p-4 md:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-gray-900">Contracts {cropYear}</h1>
        {tab === 'contracts' && isManager && !isPast && (
          <button
            onClick={() => setAdding((a) => !a)}
            className="flex items-center gap-1.5 rounded-md bg-brand-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-800"
          >
            <Plus className="h-3.5 w-3.5" /> New contract
          </button>
        )}
      </div>

      <PillTabs tabs={CONTRACT_TABS} value={tab} onChange={setTab} className="mb-3" />

      {tab === 'tickets' && <ScaleTickets cropYear={cropYear} />}
      {tab === 'position' && (
        <div className="space-y-5">
          <div>
            <PositionTab year={cropYear} />
          </div>
          <section>
            <h2 className="mb-2 text-sm font-semibold text-gray-800">Still to deliver</h2>
            <DeliveriesTab cropYear={cropYear} />
          </section>
        </div>
      )}
      {tab === 'cashflow' && <CashFlowTab year={cropYear} />}

      {tab === 'contracts' && (
      <>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ['Contracts', String(totals.count)],
          ['Committed', `${Math.round(totals.committed).toLocaleString()} units`],
          ['Delivered', `${Math.round(totals.delivered).toLocaleString()} units`],
          ['Contracted value', money(totals.contractedValue)],
        ].map(([label, val]) => (
          <div key={label} className="rounded-lg border border-gray-200 bg-white p-3">
            <p className="text-xs text-gray-500">{label}</p>
            <p className="mt-0.5 text-lg font-bold text-gray-900">{val}</p>
          </div>
        ))}
      </div>

      {adding && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            create.mutate(
              {
                crop_year: cropYear,
                crop_id: form.crop_id || null,
                buyer_contact_id: form.buyer_contact_id || null,
                contract_number: form.contract_number || null,
                bushels: form.bushels ? Number(form.bushels) : null,
                price_per_unit: form.price_per_unit ? Number(form.price_per_unit) : null,
                delivery_start: form.delivery_start || null,
                delivery_end: form.delivery_end || null,
              },
              {
                onSuccess: () => {
                  setAdding(false)
                  setForm({
                    crop_id: '',
                    buyer_contact_id: '',
                    contract_number: '',
                    bushels: '',
                    price_per_unit: '',
                    delivery_start: '',
                    delivery_end: '',
                  })
                },
              },
            )
          }}
          className="mb-4 grid grid-cols-2 gap-3 rounded-lg border border-gray-200 bg-white p-4 sm:grid-cols-4"
        >
          <label className="text-xs text-gray-500">
            Crop
            <Select
              value={form.crop_id}
              onChange={(v) => setForm((f) => ({ ...f, crop_id: v }))}
              ariaLabel="Crop"
              className="mt-1"
              options={[
                { value: '', label: '—' },
                ...(crops ?? []).map((c) => ({ value: c.id, label: c.name })),
              ]}
            />
          </label>
          <label className="text-xs text-gray-500">
            Buyer
            <Select
              value={form.buyer_contact_id}
              onChange={(v) => setForm((f) => ({ ...f, buyer_contact_id: v }))}
              ariaLabel="Buyer"
              className="mt-1"
              options={[
                { value: '', label: '—' },
                ...(contacts ?? [])
                  .filter((c) => c.type === 'buyer' || c.type === 'other')
                  .map((c) => ({ value: c.id, label: c.company || c.contact_name || '—' })),
              ]}
            />
          </label>
          <label className="text-xs text-gray-500">
            Contract #
            <input
              value={form.contract_number}
              onChange={(e) => setForm((f) => ({ ...f, contract_number: e.target.value }))}
              className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900"
            />
          </label>
          <label className="text-xs text-gray-500">
            Units (bu/lbs/cwt)
            <input
              type="number"
              value={form.bushels}
              onChange={(e) => setForm((f) => ({ ...f, bushels: e.target.value }))}
              className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900"
            />
          </label>
          <label className="text-xs text-gray-500">
            Price / unit
            <input
              type="number"
              step="0.01"
              value={form.price_per_unit}
              onChange={(e) => setForm((f) => ({ ...f, price_per_unit: e.target.value }))}
              className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900"
            />
          </label>
          <label className="text-xs text-gray-500">
            Delivery start
            <DateField value={form.delivery_start} onChange={(v) => setForm((f) => ({ ...f, delivery_start: v }))} className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900" />
          </label>
          <label className="text-xs text-gray-500">
            Delivery end
            <DateField value={form.delivery_end} onChange={(v) => setForm((f) => ({ ...f, delivery_end: v }))} className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900" />
          </label>
          <div className="flex items-end">
            <button
              type="submit"
              className="rounded-md bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800"
            >
              Add
            </button>
          </div>
        </form>
      )}

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
              <th className="px-3 py-2 font-medium">Crop</th>
              <th className="px-3 py-2 font-medium">Buyer</th>
              <th className="px-3 py-2 font-medium">Contract #</th>
              <th className="px-3 py-2 text-right font-medium">Amount</th>
              <th className="px-3 py-2 font-medium">Delivery</th>
              <th className="px-3 py-2 text-right font-medium">Delivered</th>
              <th className="px-3 py-2 font-medium">Status</th>
              {isManager && !isPast && <th className="w-14" />}
            </tr>
          </thead>
          <tbody>
            {(contracts ?? []).map((c: ContractRow) => (
              <tr
                key={c.id}
                // The whole row opens the contract (Sam, 7 Oct 2026), not only
                // the pencil; the status and delivered boxes keep their own jobs.
                onClick={isManager && !isPast ? rowClick(() => setEditing(c)) : undefined}
                className={cn('border-b border-gray-100 last:border-0', isManager && !isPast && 'cursor-pointer hover:bg-gray-50')}
              >
                <td className="px-3 py-2 font-medium">{cropName(c.crop_id)}</td>
                <td className="px-3 py-2">{buyerName(c.buyer_contact_id)}</td>
                <td className="px-3 py-2 text-gray-500">{c.contract_number ?? '—'}</td>
                {/* Units at price on one line, what it comes to under it. */}
                <td className="px-3 py-2 text-right tabular-nums">
                  {c.bushels != null ? `${Math.round(c.bushels).toLocaleString()} ${cropUnit(c.crop_id)}` : '—'}
                  {c.price_per_unit != null && (
                    <span className="text-gray-500"> @ {money2(c.price_per_unit)}</span>
                  )}
                  {c.bushels != null && c.price_per_unit != null && (
                    <span className="block text-xs text-gray-500">{money(c.bushels * c.price_per_unit)}</span>
                  )}
                </td>
                <td
                  className="whitespace-nowrap px-3 py-2 text-xs text-gray-600"
                  title={c.delivery_start || c.delivery_end ? `${c.delivery_start ?? '?'} → ${c.delivery_end ?? '?'}` : undefined}
                >
                  {c.delivery_start || c.delivery_end
                    ? `${shortDate(c.delivery_start, cropYear)} – ${shortDate(c.delivery_end, cropYear)}`
                    : '—'}
                </td>
                <td className="px-3 py-2 text-right">
                  {ticketed.has(c.id) ? (
                    <span title="Worked out from the scale tickets and weighed loads for this contract">
                      <span className="tabular-nums">{Math.round(c.delivered_bu).toLocaleString()}</span>
                      <span className="block text-[10px] text-gray-400">from tickets</span>
                    </span>
                  ) : isManager && !isPast ? (
                    <input
                      type="number"
                      defaultValue={c.delivered_bu}
                      onBlur={(e) => {
                        const v = Number(e.target.value || 0)
                        if (v !== c.delivered_bu)
                          update.mutate({ id: c.id, patch: { delivered_bu: v } })
                      }}
                      className="w-20 rounded-md border border-gray-200 px-2 py-1 text-right text-sm tabular-nums"
                    />
                  ) : (
                    Math.round(c.delivered_bu).toLocaleString()
                  )}
                </td>
                <td className="px-3 py-2">
                  {isManager && !isPast ? (
                    <select
                      value={c.status}
                      onChange={(e) =>
                        update.mutate({ id: c.id, patch: { status: e.target.value as ContractStatus } })
                      }
                      className={cn('rounded-full px-2 py-0.5 text-xs', STATUS_COLORS[c.status])}
                    >
                      {CONTRACT_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className={cn('rounded-full px-2 py-0.5 text-xs', STATUS_COLORS[c.status])}>
                      {c.status}
                    </span>
                  )}
                </td>
                {isManager && !isPast && (
                  <td className="whitespace-nowrap px-1 text-center">
                    <button
                      onClick={() => setEditing(c)}
                      className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                      aria-label="Edit contract"
                      title="Every field, and notes"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => {
                        if (confirm('Delete this contract?')) remove.mutate(c.id)
                      }}
                      className="rounded-md p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
                      aria-label="Delete contract"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {(contracts ?? []).length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-gray-400">
                  No contracts for {cropYear}.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      </>
      )}

      {editing && (
        <ContractEditor
          cropYear={cropYear}
          existing={editing}
          crops={(crops ?? []).map((c) => ({ id: c.id, name: c.name }))}
          isManager={isManager}
          deliveredFromTickets={ticketed.has(editing.id)}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}
