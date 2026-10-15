import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Warehouse } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { planFromYard, type YardFeed, type YardGroup, type YardPlan } from '@/lib/yard-rations'
import { cn } from '@/lib/utils'
import { Fold } from '@/components/Fold'
import { FeedInfo } from './FeedInfo'
import { n0, tonnes } from './bits'

/**
 * "What should each group get, from what we actually have?" — the yard's
 * counted feed shared out between the groups to turnout, then written into the
 * groups' rations with one tap.
 */
export function YardPlanner({
  isManager,
  counted,
  feeds,
  groups,
  args,
  problems,
}: {
  isManager: boolean
  /** Anything counted in the yard at all. */
  counted: boolean
  feeds: YardFeed[]
  groups: YardGroup[]
  args: Omit<Parameters<typeof planFromYard>[0], 'groups' | 'feeds'>
  /** Why the current rations don't fit the yard, for the prompt. */
  problems: string[]
}) {
  const [plan, setPlan] = useState<YardPlan | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const qc = useQueryClient()

  const work = () => {
    setDone(null)
    setPlan(planFromYard({ ...args, groups, feeds }))
  }

  const apply = async () => {
    if (!plan) return
    setBusy(true)
    try {
      const today = new Date().toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })
      for (const g of plan.groups) {
        const { error: e1 } = await supabase.from('feed_group_ration').delete().eq('herd_count_id', g.id)
        if (e1) throw e1
        const rows = g.shares
          .filter((s) => s.pct >= 0.5)
          .map((s, i) => ({ herd_count_id: g.id, feed_type_id: s.feed.id, dm_share_pct: Math.round(s.pct), waste_pct: Math.round(s.wastePct), sort_order: i + 1 }))
        if (rows.length) {
          const { error: e2 } = await supabase.from('feed_group_ration').insert(rows)
          if (e2) throw e2
        }
        await supabase.from('herd_counts').update({ ration_note: `From the yard, ${today}` }).eq('id', g.id)
      }
      void qc.invalidateQueries({ queryKey: ['feed_group_ration'] })
      void qc.invalidateQueries({ queryKey: ['herd_counts'] })
      setDone('Rations updated from the yard.')
      setPlan(null)
    } catch (e) {
      setDone((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  // Until the yard is counted there is nothing to share out: folded, with the
  // one thing to do first.
  if (!counted)
    return (
      <Fold
        title={
          <span className="flex items-center gap-1.5">
            <Warehouse className="h-4 w-4 text-gray-400" /> Rations from what&apos;s in the yard
          </span>
        }
        summary="count the yard first"
        actions={<FeedInfo k="yard" />}
      >
        <p className="text-xs text-gray-500">
          Count the yard first (Feed records → Feed put up → “Counted on hand”). Then this shares out what you have between the groups so it lasts to turnout.
        </p>
      </Fold>
    )

  return (
    <section className={cn('rounded-lg border bg-white', problems.length ? 'border-amber-300' : 'border-gray-200')}>
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
          <Warehouse className="h-4 w-4 text-gray-400" /> Rations from what&apos;s in the yard <FeedInfo k="yard" />
        </h2>
        <button
          type="button"
          disabled={!counted}
          onClick={work}
          className="rounded-md bg-brand-700 px-3 py-1 text-xs font-semibold text-white disabled:bg-gray-300"
        >
          Work them out
        </button>
      </div>

      {counted && problems.length > 0 && !plan && (
        <ul className="mx-3 mb-2 list-disc rounded-md bg-amber-50 py-1.5 pl-6 pr-2 text-xs text-amber-900">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      {done && <p className="px-3 pb-2 text-xs text-emerald-800">{done}</p>}
      {plan && (
        <div className="space-y-3 border-t border-gray-100 p-3">
          {plan.shortTdnLb > 1 && (
            <p className="rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-900">
              The yard can&apos;t carry the herd to turnout: about {n0(plan.shortTdnLb)} lb of energy short even using the reserve — roughly {tonnes(plan.shortTdnLb / 0.84 / 0.88)} t of barley, or more feed bought.
            </p>
          )}
          {plan.usesReserve && plan.shortTdnLb <= 1 && <p className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-900">It fits, but only by using the reserve.</p>}
          <div className="grid gap-2 md:grid-cols-2">
            {plan.groups.map((g) => (
              <div key={g.id} className="rounded-md border border-gray-200 p-2 text-xs">
                <p className="font-semibold text-gray-900">
                  {g.name} <span className="font-normal text-gray-500">— energy {n0(g.energyPct)}% · protein {n0(g.proteinPct)}%</span>
                </p>
                <ul className="mt-1 space-y-0.5 text-gray-700">
                  {g.shares.map((s) => (
                    <li key={s.feed.id} className="flex justify-between gap-2">
                      <span>{s.feed.name}</span>
                      <span className="tabular-nums">
                        {n0(s.pct)}% of the group&apos;s DM (proposed) · {tonnes(s.asFedLb)} t over the winter
                      </span>
                    </li>
                  ))}
                  {g.buyGrainLb > 1 && (
                    <li className="flex justify-between gap-2 text-amber-800">
                      <span>Barley to buy</span>
                      <span className="tabular-nums">{tonnes(g.buyGrainLb)} t</span>
                    </li>
                  )}
                </ul>
              </div>
            ))}
          </div>
          <table className="w-full text-xs">
            <thead className="text-left text-[10px] uppercase tracking-wide text-gray-400">
              <tr>
                <th className="py-1 font-medium">Feed</th>
                <th className="py-1 text-right font-medium">Used to turnout</th>
                <th className="py-1 text-right font-medium">In the yard (usable)</th>
                <th className="py-1 text-right font-medium">Left over</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {plan.use.map((u) => (
                <tr key={u.feed.id}>
                  <td className="py-1">{u.feed.name}</td>
                  <td className="py-1 text-right tabular-nums">{tonnes(u.usedLb)} t</td>
                  <td className="py-1 text-right tabular-nums">{tonnes(u.haveLb)} t</td>
                  <td className="py-1 text-right tabular-nums text-gray-600">{tonnes(Math.max(0, u.haveLb - u.usedLb))} t</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-center gap-2">
            {isManager && (
              <button type="button" disabled={busy} onClick={apply} className="rounded-md bg-brand-700 px-3 py-1 text-xs font-semibold text-white disabled:opacity-50">
                {busy ? 'Saving…' : 'Use these rations'}
              </button>
            )}
            <button type="button" onClick={() => setPlan(null)} className="text-xs text-gray-500">
              Close
            </button>
            <span className="text-[11px] text-gray-400">Replaces each group&apos;s ration; the daily amounts then follow the weather and the calving date.</span>
          </div>
        </div>
      )}
    </section>
  )
}
