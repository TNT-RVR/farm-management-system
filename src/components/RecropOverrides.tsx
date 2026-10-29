import { useMemo, useState } from 'react'
import { MessageSquareWarning, Plus, Trash2 } from 'lucide-react'
import { HelpNote } from '@/components/HelpNote'
import { askConfirm } from '@/components/askConfirm'
import { useJdProducts } from '@/lib/products'
import {
  useDeleteRecropOverride,
  useRecropOverrides,
  useSaveRecropOverride,
} from '@/lib/recrop-overrides'
import { cn } from '@/lib/utils'

const input = 'rounded-md border border-gray-200 px-2 py-1 text-sm text-gray-900'

/**
 * Re-cropping intervals the supplier has told us are shorter than the label.
 *
 * Zidua started it (Sam, 28 Oct 2026): the chemical company says six months
 * is enough before any rotational crop, so the label's longer wait was warning
 * us off fields nobody was worried about. The label is not edited — it still
 * says what it says — the planner just stops at the capped number.
 *
 * The product is picked from the price book, not typed as a registration
 * number: a number that matches no label caps nothing and says nothing, which
 * is worse than a warning.
 */
export function RecropOverrides({ isManager }: { isManager: boolean }) {
  const { data: overrides, isLoading } = useRecropOverrides()
  const { data: book } = useJdProducts()
  const save = useSaveRecropOverride()
  const del = useDeleteRecropOverride()
  const [adding, setAdding] = useState(false)
  const [d, setD] = useState({ registration_number: '', max_months: '', reason: '', told_by: '' })

  /**
   * One entry per registration, with every product name that shares it: the
   * generic and the brand are the same label, and a cap belongs to the label.
   */
  const labels = useMemo(() => {
    const byReg = new Map<string, string[]>()
    for (const p of book?.products ?? []) {
      const reg = p.pmra_registration?.trim()
      if (!reg) continue
      byReg.set(reg, [...(byReg.get(reg) ?? []), p.name])
    }
    return [...byReg.entries()]
      .map(([reg, names]) => ({ reg, name: [...new Set(names)].sort().join(' / ') }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [book])

  const nameOf = (reg: string) => labels.find((l) => l.reg === reg)?.name ?? `Registration ${reg}`

  const rows = overrides ?? []
  const monthsOk = Number.isFinite(Number(d.max_months)) && Number(d.max_months) > 0
  const canSave = Boolean(d.registration_number) && monthsOk && d.reason.trim().length > 0

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-3 sm:p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-gray-800">
          <MessageSquareWarning className="h-4 w-4 text-gray-400" /> Shorter waits, on advice
        </h3>
        {isManager && !adding && labels.length > 0 && (
          <button
            onClick={() => {
              setD({ registration_number: labels[0].reg, max_months: '', reason: '', told_by: '' })
              setAdding(true)
            }}
            className="flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            <Plus className="h-3.5 w-3.5" /> Shorten one
          </button>
        )}
      </div>

      <HelpNote
        className="mt-1"
        summary="These override a published label on a person's word."
        title="Shorter waits, on advice"
      >
        <p>
          A label's re-cropping table is the registered instruction. Nothing here corrects it: the
          label still says what it says, and this is a note that the supplier told us a shorter wait
          is enough. The planner stops at the shorter number; the label's own words stay on the
          chemical's page.
        </p>
        <p>
          So fill in who said so. It is the only record — if the advice turns out to be wrong, the
          name and the date are what tells you whose advice it was.
        </p>
      </HelpNote>

      {adding && (
        <div className="mt-2 grid gap-2 rounded-md bg-gray-50 p-2 sm:grid-cols-2">
          <label className="text-xs text-gray-500 sm:col-span-2">
            Product
            <select
              className={cn(input, 'mt-0.5 block w-full')}
              value={d.registration_number}
              onChange={(e) => setD({ ...d, registration_number: e.target.value })}
            >
              {labels.map((l) => (
                <option key={l.reg} value={l.reg}>
                  {l.name} ({l.reg})
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-gray-500">
            Months, at most
            <input
              className={cn(input, 'mt-0.5 block w-24')}
              inputMode="decimal"
              value={d.max_months}
              onChange={(e) => setD({ ...d, max_months: e.target.value })}
            />
          </label>
          <label className="text-xs text-gray-500">
            Who told us
            <input
              className={cn(input, 'mt-0.5 block w-full')}
              placeholder="the chemical company, asked by Sam"
              value={d.told_by}
              onChange={(e) => setD({ ...d, told_by: e.target.value })}
            />
          </label>
          <label className="text-xs text-gray-500 sm:col-span-2">
            What they said
            <input
              className={cn(input, 'mt-0.5 block w-full')}
              placeholder="the supplier says 6 months is enough before any rotational crop"
              value={d.reason}
              onChange={(e) => setD({ ...d, reason: e.target.value })}
            />
          </label>
          <div className="flex items-center gap-2 sm:col-span-2">
            <button
              disabled={!canSave || save.isPending}
              onClick={async () => {
                await save.mutateAsync({
                  registration_number: d.registration_number,
                  max_months: Number(d.max_months),
                  reason: d.reason.trim(),
                  told_by: d.told_by,
                })
                setAdding(false)
              }}
              className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50"
            >
              Save
            </button>
            <button
              onClick={() => setAdding(false)}
              className="rounded-md px-2 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <p className="mt-2 text-sm text-gray-500">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="mt-1 text-xs text-gray-500">None. Every label's own re-cropping interval applies.</p>
      ) : (
        <ul className="mt-2 divide-y divide-gray-100">
          {rows.map((o) => (
            <li key={o.registration_number} className="flex items-start gap-2 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium text-gray-900">{nameOf(o.registration_number)}</span>
                  <span className="text-gray-600">
                    at most <span className="font-semibold tabular-nums">{o.max_months}</span> months
                  </span>
                </p>
                <p className="mt-0.5 text-xs text-gray-500">{o.reason}</p>
                <p className="text-[11px] text-gray-400">
                  {o.told_by ?? 'nobody recorded'} · {o.set_on}
                </p>
              </div>
              {isManager && (
                <button
                  onClick={async () => {
                    if (
                      !(await askConfirm(
                        `Put ${nameOf(o.registration_number)} back on the label's own interval?`,
                        { confirmLabel: 'Remove' },
                      ))
                    )
                      return
                    del.mutate(o.registration_number)
                  }}
                  className="shrink-0 rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
                  aria-label={`Remove the shorter wait for ${nameOf(o.registration_number)}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {(save.isError || del.isError) && (
        <p className="mt-2 text-xs text-red-600">{((save.error ?? del.error) as Error).message}</p>
      )}
      {!isManager && <p className="mt-2 text-xs text-gray-400">Only a manager can change these.</p>}
    </section>
  )
}
