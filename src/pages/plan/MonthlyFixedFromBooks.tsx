import { useMutation, useQueryClient } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useFarmFixedCosts } from '@/lib/farm-costs'
import { money2 } from '@/lib/planner'
import { HelpNote } from '@/components/HelpNote'
import { cn } from '@/lib/utils'

const day = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })

/**
 * Financials → Farm costs: the fixed expenses kept current from the books.
 * Once a month the nightly QuickBooks sync reads the last twelve months and
 * rewrites the year being planned (netlify/shared/fixed-costs-books.ts). This
 * says which years it keeps, switches the shown year on or off, and runs it
 * now. Owners and the accountant only, as the rest of the breakdown.
 */
export function MonthlyFixedFromBooks({ year, locked }: { year: number; locked: boolean }) {
  const qc = useQueryClient()
  const { data: settings } = useFarmFixedCosts()
  const auto = (settings ?? []).filter((s) => s.books_auto)
  const shown = (settings ?? []).find((s) => s.crop_year === year) ?? null
  const refresh = () => {
    for (const key of ['farm_fixed_costs', 'farm_fixed_cost_lines', 'crop_inputs', 'pl-farm', 'rotation-context']) void qc.invalidateQueries({ queryKey: [key] })
  }

  const toggle = useMutation({
    mutationFn: async (on: boolean) => {
      const { error } = await supabase.from('farm_fixed_costs').update({ books_auto: on }).eq('crop_year', year)
      if (error) throw error
    },
    onSuccess: refresh,
  })
  const runNow = useMutation({
    mutationFn: async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const res = await fetch('/.netlify/functions/fixed-costs-books', {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}` },
        body: '{}',
      })
      const j = (await res.json().catch(() => ({}))) as { detail?: string; error?: string }
      if (!res.ok) throw new Error(j.error ?? `No answer (${res.status})`)
      return j.detail ?? 'Done'
    },
    onSuccess: refresh,
  })

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-gray-900">Kept current from QuickBooks</h2>
        <button
          type="button"
          onClick={() => runNow.mutate()}
          disabled={runNow.isPending}
          className="flex items-center gap-1 text-xs text-emerald-800 hover:underline disabled:opacity-50"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', runNow.isPending && 'animate-spin')} /> Update now
        </button>
      </div>
      <HelpNote summary="Once a month, from the last twelve months of the books." className="mt-0.5">
        <p>
          After the nightly QuickBooks sync, from the 10th of each month, the Profit and Loss for the last twelve full months is put through the
          same rules as &ldquo;From the books&rdquo;: cash only (no depreciation), the management fee off labour and overhead, the crops&apos;
          share of each part. It is written to the crop year being planned and spread over that year&apos;s planned acres. The month a fiscal
          year closes (September), the closed year is written once more from its own finished books. A year saved by hand here is left alone
          until it is switched back on.
        </p>
      </HelpNote>
      <ul className="mt-2 space-y-0.5 text-sm text-gray-700">
        {auto.length ? (
          auto.map((s) => (
            <li key={s.crop_year}>
              <b>{s.crop_year}</b>: {money2(s.per_acre)}/ac
              {s.books_window && <span className="text-gray-500"> · from {s.books_window}</span>}
              {s.books_updated_at && <span className="text-gray-500"> · read {day(s.books_updated_at)}</span>}
            </li>
          ))
        ) : (
          <li className="text-gray-500">No year yet — the first read happens after the next nightly sync, or press Update now.</li>
        )}
      </ul>
      {shown && !locked && (
        <label className="mt-2 flex items-center gap-2 text-xs text-gray-700">
          <input type="checkbox" checked={shown.books_auto} disabled={toggle.isPending} onChange={(e) => toggle.mutate(e.target.checked)} />
          Update {year} monthly from QuickBooks
          {!shown.books_auto && <span className="text-gray-500">(off: {year} was saved by hand)</span>}
        </label>
      )}
      {runNow.data && <p className="mt-2 text-xs text-emerald-800">{runNow.data}</p>}
      {(runNow.error || toggle.error) && <p className="mt-2 text-xs text-red-700">{((runNow.error ?? toggle.error) as Error).message}</p>}
    </section>
  )
}
