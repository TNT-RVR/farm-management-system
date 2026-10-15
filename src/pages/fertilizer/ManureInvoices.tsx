import { useState } from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import { useManureApplications, type ManureApplication } from '@/lib/manure'
import { useDeleteManureInvoice, useManureInvoices, useSaveManureInvoice, type ManureInvoice } from '@/lib/hauling-data'
import { useFields } from '@/lib/queries'
import { cn } from '@/lib/utils'
import { money, n1 } from './savings/ui'

const input = 'rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-900'

/**
 * What custom haulers billed for each spread, tied to the spread it paid for.
 *
 * The cost a tonne is the invoice's own (before GST — it comes back), and it
 * is what the "custom" column above is fitted to. Where the invoice's work
 * date and the spread's date disagree, it says so rather than guessing which
 * one is right.
 */
export function ManureInvoices({ isManager }: { isManager: boolean }) {
  const { data: lines } = useManureInvoices()
  const { data: apps } = useManureApplications()
  const { data: fields } = useFields()
  const del = useDeleteManureInvoice()
  const [adding, setAdding] = useState(false)
  // Sam, 7 Oct 2026: a billed line can be corrected, not only deleted.
  const [editing, setEditing] = useState<string | null>(null)
  const nameOf = (id: string | null) => fields?.find((f) => f.id === id)?.name ?? '—'
  const appOf = (id: string | null) => apps?.find((a) => a.id === id) ?? null

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-gray-200 px-3 py-2">
        <h2 className="text-sm font-semibold text-gray-900">Custom hauling, as billed</h2>
        {isManager && !adding && (
          <button type="button" onClick={() => setAdding(true)} className="text-xs text-brand-700 underline">
            Add an invoice line
          </button>
        )}
      </div>
      {(lines ?? []).length === 0 && !adding && <p className="px-3 py-2 text-sm text-gray-500">No hauling invoices recorded.</p>}
      <ul className="divide-y divide-gray-100">
        {(lines ?? []).map((l) => {
          const app = appOf(l.manure_application_id)
          const differs = app?.applied_on && l.work_date && app.applied_on !== l.work_date
          const perT = l.tonnes ? l.amount / l.tonnes : null
          if (editing === l.id)
            return (
              <li key={l.id}>
                <LineForm apps={apps ?? []} fieldName={nameOf} existing={l} onDone={() => setEditing(null)} />
              </li>
            )
          return (
            <li key={l.id} className="px-3 py-2 text-sm">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                <span className="font-medium text-gray-900">{nameOf(l.field_id)}</span>
                <span className="text-gray-600">{l.work_date ?? 'no date'}</span>
                <span className="tabular-nums text-gray-700">
                  {l.hours != null && `${n1(l.hours)} h × ${money(l.rate_per_hour, 2)} = `}
                  <strong>{money(l.amount, 2)}</strong>
                  {l.gst != null && <span className="text-gray-400"> + GST {money(l.gst, 2)}</span>}
                </span>
                <span className="tabular-nums text-gray-600">
                  {l.loads != null && `${l.loads} loads · `}
                  {l.tonnes != null && `${Math.round(l.tonnes).toLocaleString('en-CA')} t`}
                  {perT != null && <strong className="text-gray-900"> · {money(perT, 2)}/t</strong>}
                </span>
                {isManager && (
                  <span className="ml-auto flex items-center gap-2">
                    <button type="button" onClick={() => setEditing(l.id)} className="text-gray-400 hover:text-gray-700" title="Edit this invoice line" aria-label="Edit this invoice line">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm(`Delete the ${l.hauler} line${l.invoice_no ? ` on invoice #${l.invoice_no}` : ''} for ${nameOf(l.field_id)}?`)) del.mutate(l.id)
                      }}
                      className="text-red-700 hover:text-red-800"
                      title="Delete this invoice line"
                      aria-label="Delete this invoice line"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-500">
                {l.hauler}
                {l.invoice_no && ` · invoice #${l.invoice_no}`}
                {l.invoice_date && ` of ${l.invoice_date}`}
                {l.description && ` · ${l.description}`}
                {l.notes && ` · ${l.notes}`}
              </p>
              {app ? (
                <p className={cn('text-xs', differs ? 'text-amber-800' : 'text-gray-500')}>
                  Paid for the spread recorded {app.applied_on ?? 'with no date'} ({n1(Number(app.rate_tons_per_acre))} t/ac × {n1(Number(app.acres))} ac ={' '}
                  {Math.round(Number(app.rate_tons_per_acre ?? 0) * Number(app.acres ?? 0)).toLocaleString('en-CA')} t)
                  {differs && ` — the invoice says ${l.work_date}. Which is right?`}
                  {l.tonnes != null && app.acres ? ` The invoice's tonnes come to ${n1(l.tonnes / Number(app.acres))} t/ac.` : ''}
                </p>
              ) : (
                <p className="text-xs text-amber-800">Not tied to a spread on the map yet.</p>
              )}
            </li>
          )
        })}
      </ul>
      {del.isError && <p className="px-3 py-1 text-xs text-red-700">{(del.error as Error).message}</p>}
      {adding && <LineForm apps={apps ?? []} fieldName={nameOf} onDone={() => setAdding(false)} />}
    </div>
  )
}

const str = (v: number | string | null | undefined) => (v == null ? '' : String(v))

/** Add a billed line, or correct one (`existing`). */
function LineForm({ apps, fieldName, existing, onDone }: { apps: ManureApplication[]; fieldName: (id: string | null) => string; existing?: ManureInvoice; onDone: () => void }) {
  const save = useSaveManureInvoice()
  const [f, setF] = useState(() =>
    existing
      ? {
          app: existing.manure_application_id ?? '',
          hauler: existing.hauler,
          invoice_no: existing.invoice_no ?? '',
          invoice_date: existing.invoice_date ?? '',
          work_date: existing.work_date ?? '',
          hours: str(existing.hours),
          rate: str(existing.rate_per_hour),
          amount: str(existing.amount),
          loads: str(existing.loads),
          tonnes: str(existing.tonnes),
          notes: existing.notes ?? '',
        }
      : { app: '', hauler: 'N & K Custom Ltd. (Coalhurst AB)', invoice_no: '', invoice_date: '', work_date: '', hours: '', rate: '157.50', amount: '', loads: '', tonnes: '', notes: '' },
  )
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((x) => ({ ...x, [k]: e.target.value }))
  const n = (v: string) => (v.trim() === '' ? null : Number(v))
  // Hours × rate where both are given; a line billed as a lump sum keeps its typed amount.
  const byHours = (n(f.hours) ?? 0) * (n(f.rate) ?? 0)
  const amount = byHours > 0 ? byHours : (n(f.amount) ?? 0)
  const app = apps.find((a) => a.id === f.app) ?? null
  return (
    <div className="space-y-2 border-t border-gray-200 bg-gray-50 px-3 py-2">
      <div className="flex flex-wrap gap-2">
        <select value={f.app} onChange={set('app')} className={input} aria-label="Spread it paid for">
          <option value="">Spread it paid for…</option>
          {apps.map((a) => (
            <option key={a.id} value={a.id}>
              {fieldName(a.field_id)} · {a.applied_on ?? 'no date'} · {n1(Number(a.acres))} ac
            </option>
          ))}
        </select>
        <input value={f.hauler} onChange={set('hauler')} placeholder="Hauler" className={cn(input, 'w-56')} />
        <input value={f.invoice_no} onChange={set('invoice_no')} placeholder="Invoice #" className={cn(input, 'w-20')} />
        <label className="text-xs text-gray-500">
          Invoice date <input type="date" value={f.invoice_date} onChange={set('invoice_date')} className={input} />
        </label>
        <label className="text-xs text-gray-500">
          Work date <input type="date" value={f.work_date} onChange={set('work_date')} className={input} />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input value={f.hours} onChange={set('hours')} placeholder="Hours" inputMode="decimal" className={cn(input, 'w-16')} />
        <span className="text-xs text-gray-500">×</span>
        <input value={f.rate} onChange={set('rate')} placeholder="$/h" inputMode="decimal" className={cn(input, 'w-20')} />
        {byHours > 0 ? (
          <span className="text-xs text-gray-500">= {money(amount, 2)} before GST</span>
        ) : (
          <label className="text-xs text-gray-500">
            or amount <input value={f.amount} onChange={set('amount')} placeholder="$ before GST" inputMode="decimal" className={cn(input, 'w-24')} />
          </label>
        )}
        <input value={f.loads} onChange={set('loads')} placeholder="Loads" inputMode="numeric" className={cn(input, 'w-16')} />
        <input value={f.tonnes} onChange={set('tonnes')} placeholder="Tonnes" inputMode="decimal" className={cn(input, 'w-20')} />
        <input value={f.notes} onChange={set('notes')} placeholder="Note" className={cn(input, 'min-w-0 flex-1')} />
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={!(amount > 0) || save.isPending}
          onClick={() =>
            save.mutate(
              {
                id: existing?.id,
                manure_application_id: f.app || null,
                field_id: app?.field_id ?? existing?.field_id ?? null,
                hauler: f.hauler.trim() || 'Custom hauler',
                invoice_no: f.invoice_no.trim() || null,
                invoice_date: f.invoice_date || null,
                work_date: f.work_date || null,
                description: existing?.description ?? 'Custom manure hauling',
                hours: n(f.hours),
                rate_per_hour: n(f.rate),
                amount: Math.round(amount * 100) / 100,
                gst: Math.round(amount * 5) / 100,
                loads: n(f.loads),
                tonnes: n(f.tonnes),
                notes: f.notes.trim() || null,
              },
              { onSuccess: onDone },
            )
          }
          className="rounded-md bg-brand-700 px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
        >
          {save.isPending ? 'Saving…' : 'Save'}
        </button>
        <button type="button" onClick={onDone} className="text-xs text-gray-500 underline">
          cancel
        </button>
        {save.isError && <span className="text-xs text-red-700">{(save.error as Error).message}</span>}
      </div>
    </div>
  )
}
