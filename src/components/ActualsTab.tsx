import { DateField } from '@/components/DateField'
import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Download, Plus, Trash2 } from 'lucide-react'
import { ConfirmDialog, Modal } from '@/components/Modal'
import { DetailList, EditButton, RecordEditModal, rowClick, type EditField } from '@/components/RecordEditor'
import { Select } from '@/components/Select'
import { supabase } from '@/lib/supabase'
import { hasManagerAccess, useAuth } from '@/lib/auth'
import { useCropYear } from '@/lib/crop-year'
import { useCrops } from '@/lib/queries'
import { useContacts } from '@/lib/sales'
import { useExport } from '@/hooks/useExport'
import { money } from '@/lib/planner'
import type { BudgetLine } from '@/lib/planner'
import {
  buildActuals,
  useFinancialEntries,
  useFinancialMutations,
  type FinancialEntryRow,
} from '@/lib/financials'
import { cn } from '@/lib/utils'
import { contactNameOf, cropNameOf, quickBooksColumns } from '@/lib/reports/lists'

function Variance({ value, goodWhenPositive }: { value: number; goodWhenPositive: boolean }) {
  if (Math.abs(value) < 0.5) return <span className="text-gray-400">—</span>
  const good = goodWhenPositive ? value > 0 : value < 0
  return (
    <span className={cn('tabular-nums', good ? 'text-green-700' : 'text-red-600')}>
      {value > 0 ? '+' : ''}
      {money(value)}
    </span>
  )
}

export function ActualsTab({ budget, locked }: { budget: BudgetLine[]; locked: boolean }) {
  const { profile } = useAuth()
  const { cropYear } = useCropYear()
  const canEdit = hasManagerAccess(profile?.role) && !locked
  const { data: crops } = useCrops()
  const { data: contacts } = useContacts()
  const { data: entries } = useFinancialEntries(cropYear)
  const { create, remove } = useFinancialMutations(cropYear)
  const { exportCsv } = useExport()
  const qc = useQueryClient()
  // Sam, 7 Oct 2026: an entry opens to its detail, and can be corrected
  // there. The crop year is not editable: the year guard owns that.
  const [openId, setOpenId] = useState<string | null>(null)
  const [editing, setEditing] = useState<FinancialEntryRow | null>(null)
  const [deleting, setDeleting] = useState<FinancialEntryRow | null>(null)
  const open = entries?.find((e) => e.id === openId) ?? null
  const update = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Record<string, unknown> }) => {
      const { error } = await supabase
        .from('financial_entries')
        .update({
          kind: patch.kind as 'expense' | 'revenue',
          amount: patch.amount as number,
          entry_date: patch.entry_date as string,
          category: (patch.category as string | null) ?? null,
          crop_id: (patch.crop_id as string | null) ?? null,
          contact_id: (patch.contact_id as string | null) ?? null,
          description: (patch.description as string | null) ?? null,
        })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['financial_entries', cropYear] }),
  })
  const entryFields: EditField[] = [
    { key: 'kind', label: 'Kind', kind: 'select', required: true, options: [{ value: 'expense', label: 'Expense' }, { value: 'revenue', label: 'Revenue' }] },
    { key: 'amount', label: 'Amount', kind: 'number', step: '0.01', required: true },
    { key: 'entry_date', label: 'Date', kind: 'date', required: true },
    { key: 'category', label: 'Category', kind: 'text', placeholder: 'fuel, custom…' },
    { key: 'crop_id', label: 'Crop', kind: 'select', options: [{ value: '', label: 'Unassigned' }, ...(crops ?? []).map((c) => ({ value: c.id, label: c.name }))] },
    {
      key: 'contact_id',
      label: 'Contact',
      kind: 'select',
      options: [{ value: '', label: 'None' }, ...(contacts ?? []).map((c) => ({ value: c.id, label: c.company || c.contact_name || '—' }))],
    },
    { key: 'description', label: 'Description', kind: 'textarea' },
  ]

  const cropName = useMemo(() => cropNameOf(crops), [crops])
  const contactName = useMemo(() => contactNameOf(contacts), [contacts])

  const { lines, unassigned } = useMemo(
    () => buildActuals(budget, entries ?? [], cropName),
    [budget, entries, cropName],
  )

  const totals = useMemo(() => {
    const bRev = lines.reduce((s, l) => s + l.budgetedRevenue, 0)
    const aRev = lines.reduce((s, l) => s + l.actualRevenue, 0) + unassigned.revenue
    const bCost = lines.reduce((s, l) => s + l.budgetedCost, 0)
    const aCost = lines.reduce((s, l) => s + l.actualCost, 0) + unassigned.cost
    return { bRev, aRev, bCost, aCost, bMargin: bRev - bCost, aMargin: aRev - aCost }
  }, [lines, unassigned])

  const [f, setF] = useState({
    kind: 'expense' as 'expense' | 'revenue',
    amount: '',
    category: '',
    crop_id: '',
    contact_id: '',
    entry_date: new Date().toISOString().slice(0, 10),
    description: '',
  })

  function exportQuickBooks() {
    // The same file the Reports page makes.
    exportCsv(entries ?? [], quickBooksColumns(cropName, contactName), `quickbooks-${cropYear}`)
  }

  return (
    <div>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ['Actual revenue', money(totals.aRev), `budget ${money(totals.bRev)}`],
          ['Actual costs', money(totals.aCost), `budget ${money(totals.bCost)}`],
          ['Actual margin', money(totals.aMargin), `budget ${money(totals.bMargin)}`],
          [
            'Margin variance',
            (totals.aMargin - totals.bMargin >= 0 ? '+' : '') + money(totals.aMargin - totals.bMargin),
            'actual vs budget',
          ],
        ].map(([label, val, sub]) => (
          <div key={label} className="rounded-lg border border-gray-200 bg-white p-3">
            <p className="text-xs text-gray-500">{label}</p>
            <p className="mt-0.5 text-lg font-bold text-gray-900">{val}</p>
            <p className="text-xs text-gray-400">{sub}</p>
          </div>
        ))}
      </div>

      <div className="mb-4 flex justify-end">
        <button
          onClick={exportQuickBooks}
          disabled={!entries?.length}
          className="flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          <Download className="h-3.5 w-3.5" /> Export for QuickBooks
        </button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
              <th className="px-3 py-2 font-medium">Crop</th>
              <th className="px-3 py-2 text-right font-medium">Budget rev</th>
              <th className="px-3 py-2 text-right font-medium">Actual rev</th>
              <th className="px-3 py-2 text-right font-medium">Δ rev</th>
              <th className="px-3 py-2 text-right font-medium">Budget cost</th>
              <th className="px-3 py-2 text-right font-medium">Actual cost</th>
              <th className="px-3 py-2 text-right font-medium">Δ cost</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.cropId ?? 'null'} className="border-b border-gray-100 last:border-0">
                <td className="px-3 py-2 font-medium">{l.cropName}</td>
                <td className="px-3 py-2 text-right tabular-nums">{money(l.budgetedRevenue)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{money(l.actualRevenue)}</td>
                <td className="px-3 py-2 text-right">
                  <Variance value={l.revenueVariance} goodWhenPositive />
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{money(l.budgetedCost)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{money(l.actualCost)}</td>
                <td className="px-3 py-2 text-right">
                  <Variance value={l.costVariance} goodWhenPositive={false} />
                </td>
              </tr>
            ))}
            {(unassigned.revenue > 0 || unassigned.cost > 0) && (
              <tr className="border-b border-gray-100 bg-gray-50 last:border-0">
                <td className="px-3 py-2 italic text-gray-500">Unassigned</td>
                <td className="px-3 py-2" />
                <td className="px-3 py-2 text-right tabular-nums">{money(unassigned.revenue)}</td>
                <td className="px-3 py-2" />
                <td className="px-3 py-2" />
                <td className="px-3 py-2 text-right tabular-nums">{money(unassigned.cost)}</td>
                <td className="px-3 py-2" />
              </tr>
            )}
            {lines.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-gray-400">
                  No budget or actuals for {cropYear}.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {canEdit && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (!f.amount) return
            create.mutate(
              {
                crop_year: cropYear,
                kind: f.kind,
                amount: Number(f.amount),
                category: f.category || null,
                crop_id: f.crop_id || null,
                contact_id: f.contact_id || null,
                entry_date: f.entry_date,
                description: f.description || null,
              },
              {
                onSuccess: () =>
                  setF((x) => ({ ...x, amount: '', category: '', description: '' })),
              },
            )
          }}
          className="mt-4 grid grid-cols-2 gap-2 rounded-lg border border-gray-200 bg-white p-3 sm:grid-cols-4"
        >
          <Select
            value={f.kind}
            ariaLabel="Kind"
            onChange={(v) => setF((x) => ({ ...x, kind: v as 'expense' | 'revenue' }))}
            options={[
              { value: 'expense', label: 'Expense' },
              { value: 'revenue', label: 'Revenue' },
            ]}
          />
          <input
            type="number"
            step="0.01"
            placeholder="Amount"
            value={f.amount}
            onChange={(e) => setF((x) => ({ ...x, amount: e.target.value }))}
            className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          />
          <Select
            value={f.crop_id}
            ariaLabel="Crop"
            placeholder="Crop (optional)"
            onChange={(v) => setF((x) => ({ ...x, crop_id: v }))}
            options={[
              { value: '', label: 'Crop (optional)' },
              ...(crops ?? []).map((c) => ({ value: c.id, label: c.name })),
            ]}
          />
          <DateField value={f.entry_date} onChange={(v) => setF((x) => ({ ...x, entry_date: v }))} className="rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
          <input
            placeholder="Category (fuel, custom…)"
            value={f.category}
            onChange={(e) => setF((x) => ({ ...x, category: e.target.value }))}
            className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          />
          <Select
            value={f.contact_id}
            ariaLabel="Contact"
            placeholder="Contact (optional)"
            onChange={(v) => setF((x) => ({ ...x, contact_id: v }))}
            options={[
              { value: '', label: 'Contact (optional)' },
              ...(contacts ?? []).map((c) => ({ value: c.id, label: c.company || c.contact_name || '—' })),
            ]}
          />
          <input
            placeholder="Description"
            value={f.description}
            onChange={(e) => setF((x) => ({ ...x, description: e.target.value }))}
            className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          />
          <button
            type="submit"
            className="flex items-center justify-center gap-1 rounded-md bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-800"
          >
            <Plus className="h-4 w-4" /> Add entry
          </button>
        </form>
      )}

      <div className="mt-4 rounded-lg border border-gray-200 bg-white">
        <h3 className="border-b border-gray-100 px-3 py-2 text-sm font-semibold text-gray-700">
          Entries
        </h3>
        <ul className="divide-y divide-gray-100">
          {(entries ?? []).slice(0, 50).map((e) => (
            <li key={e.id} onClick={rowClick(() => setOpenId(e.id))} className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50">
              <span className="w-20 shrink-0 text-xs text-gray-400">{e.entry_date}</span>
              <span className="min-w-0 flex-1 truncate">
                {e.description || e.category || cropName(e.crop_id)}
                {contactName(e.contact_id) && (
                  <span className="text-xs text-gray-400"> · {contactName(e.contact_id)}</span>
                )}
              </span>
              <span
                className={cn('tabular-nums', e.kind === 'revenue' ? 'text-green-700' : 'text-gray-700')}
              >
                {e.kind === 'revenue' ? '+' : '−'}
                {money(e.amount)}
              </span>
              {canEdit && (
                <button
                  onClick={() => {
                    remove.reset()
                    setDeleting(e)
                  }}
                  className="rounded-md p-1 text-gray-300 hover:bg-red-50 hover:text-red-600"
                  aria-label="Delete entry"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))}
          {(entries ?? []).length === 0 && (
            <li className="px-3 py-6 text-center text-sm text-gray-400">
              No entries yet — log actual expenses and revenue to compare against the budget.
            </li>
          )}
        </ul>
      </div>

      {open && !editing && !deleting && (
        <Modal title={`${open.kind === 'revenue' ? 'Revenue' : 'Expense'} · ${money(open.amount)}`} onClose={() => setOpenId(null)} wide>
          <DetailList
            rows={[
              ['Date', open.entry_date],
              ['Kind', open.kind === 'revenue' ? 'Revenue' : 'Expense'],
              ['Amount', money(open.amount)],
              ['Category', open.category],
              ['Crop', cropName(open.crop_id)],
              ['Contact', contactName(open.contact_id)],
              ['Description', open.description],
              ['Crop year', String(open.crop_year)],
              ['From', open.source],
              ['Entered', new Date(open.created_at).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' })],
            ]}
          />
          {locked && <p className="mt-3 text-xs text-gray-500">{cropYear} is locked; unlock it for corrections to change this entry.</p>}
          {canEdit && (
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  remove.reset()
                  setDeleting(open)
                }}
                className="flex items-center gap-1 rounded-md border border-red-200 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
              >
                <Trash2 className="h-3.5 w-3.5" /> Delete
              </button>
              <EditButton
                onClick={() => {
                  update.reset()
                  setEditing(open)
                }}
              />
            </div>
          )}
        </Modal>
      )}

      {editing && (
        <RecordEditModal
          title="Edit entry"
          fields={entryFields}
          row={editing}
          saving={update.isPending}
          error={update.error ? (update.error as Error).message : null}
          onClose={() => setEditing(null)}
          onSave={(patch) => update.mutateAsync({ id: editing.id, patch })}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title="Delete entry"
          message={`Delete the ${deleting.entry_date} ${deleting.kind} of ${money(deleting.amount)}${deleting.description ? ` (${deleting.description})` : ''}?`}
          busy={remove.isPending}
          error={remove.error ? (remove.error as Error).message : null}
          onClose={() => setDeleting(null)}
          onConfirm={() =>
            remove.mutate(deleting.id, {
              onSuccess: () => {
                setDeleting(null)
                setOpenId(null)
              },
            })
          }
        />
      )}
    </div>
  )
}
