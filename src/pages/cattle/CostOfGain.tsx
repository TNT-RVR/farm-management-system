import { useMemo, useState } from 'react'
import { useHerdCounts } from '@/lib/cattle'
import { costOfGain } from '@/lib/cost-of-gain'
import { solveRation } from '@/lib/cattle-nutrition'
import { feedValues, groupInput, rationLines, useFeedTests, useFeedTypesFull, useGroupRations, useUpdateFeedType } from '@/lib/winter-feeding'
import { useFeedPlan } from '@/lib/feed'
import { CattleInfo } from './CattleInfo'
import { SETUP_LINKS, SetupLink } from '@/components/SetupLink'

const numOrNull = (s: string) => (s.trim() === '' || !Number.isFinite(Number(s)) ? null : Number(s))
const money = (v: number) => `$${Math.round(v).toLocaleString('en-CA')}`

/**
 * Cost of gain, worked out from the farm's own numbers: the calves' ration on
 * the Feed tab (pounds of each feed a day), the feed prices, and the few other
 * costs typed here. Sam, 5 Oct 2026: "Not sure, tell me how to calculate that."
 */
export function CostOfGainWorksheet({
  ranchId,
  isManager,
  deathLossPct,
  calfYardage,
  onUse,
}: {
  ranchId: string | null
  isManager: boolean
  deathLossPct: number | null
  /** The ranch's yardage for a backgrounded calf (Cattle settings): used until one is typed here. */
  calfYardage?: number | null
  onUse: (perLb: number) => void
}) {
  const { data: counts } = useHerdCounts(ranchId ?? undefined)
  const { data: rations } = useGroupRations(ranchId)
  const { data: types } = useFeedTypesFull()
  const { data: tests } = useFeedTests()
  const { data: plan } = useFeedPlan(ranchId)
  const setType = useUpdateFeedType()
  const [days, setDays] = useState('150')
  const [yardage, setYardage] = useState('')
  const [vet, setVet] = useState('')
  const [interest, setInterest] = useState('')
  const [calfValue, setCalfValue] = useState('')

  // The calves fed after weaning: the row holding the calves kept to background,
  // else any growing group.
  const calves = (counts ?? []).find((c) => c.background_head != null) ?? (counts ?? []).find((c) => c.feed_class === 'backgrounder')
  const values = useMemo(() => feedValues(types ?? [], tests ?? []), [types, tests])
  const d = Math.max(0, numOrNull(days) ?? 0)

  const worked = useMemo(() => {
    if (!calves || !plan) return null
    const g = groupInput(calves)
    const gain = g.targetGainLb ?? 1.5
    // Fed at their weight halfway through: intake climbs as they grow.
    const mid = { ...g, head: 1, weightLb: g.weightLb + (gain * d) / 2 }
    const r = solveRation(mid, { onDate: new Date(), calvingMonth: plan.calving_month, calvingDay: plan.calving_day, daysToTurnout: d, cold: 0, muddy: false }, rationLines(calves.id, rations ?? [], values))
    const typeOf = (id: string) => (types ?? []).find((x) => x.id === id)
    const priceOf = (id: string) => {
      const t = typeOf(id)
      return t?.price_per_tonne == null ? null : Number(t.price_per_tonne)
    }
    // Where the price came from, shown beside it: AFSC's list, typed, or a starting estimate.
    const fromOf = (id: string) => {
      const t = typeOf(id)
      return { priceNote: t?.price_note ?? null, priceFrom: t?.price_source === 'afsc' ? 'AFSC list' : t?.price_source === 'estimate' ? 'estimate' : t?.price_source === 'manual' ? 'typed' : null }
    }
    const feeds = r.lines.map((l) => ({ id: l.feed.id, name: l.feed.name, asFedLbPerDay: l.offeredLb, pricePerTonne: priceOf(l.feed.id), ...fromOf(l.feed.id) }))
    if (r.addGrainLb > 0.05) feeds.push({ id: 'grain', name: 'Grain to carry the gain', asFedLbPerDay: r.addGrainLb, pricePerTonne: null, priceNote: null, priceFrom: null })
    return {
      gain,
      startLb: g.weightLb,
      feeds,
      result: costOfGain({
        startLb: g.weightLb,
        gainLbPerDay: gain,
        days: d,
        feeds,
        yardagePerDay: numOrNull(yardage) ?? calfYardage ?? null,
        vetPerHead: numOrNull(vet),
        interestPct: numOrNull(interest),
        calfValue: numOrNull(calfValue),
        deathLossPct,
      }),
    }
  }, [calves, plan, rations, values, types, d, yardage, vet, interest, calfValue, deathLossPct, calfYardage])

  const field = 'w-24 rounded-md border border-gray-200 px-2 py-1 text-right text-sm tabular-nums'

  return (
    <details className="mt-3 rounded-md border border-gray-200 bg-gray-50/50 p-3">
      <summary className="cursor-pointer text-sm font-semibold text-gray-800">
        Work out the cost of gain <CattleInfo k="costOfGain" />
      </summary>
      {!calves ? (
        <p className="mt-2 text-xs text-gray-500">
          No calf group on the Herd tab for this ranch to work it out for.{' '}
          <SetupLink managerOnly to={SETUP_LINKS.cattleHerd(ranchId)}>Add one</SetupLink>
        </p>
      ) : !worked ? (
        <p className="mt-2 text-xs text-gray-400">Loading the ration…</p>
      ) : (
        <div className="mt-2 space-y-3 text-sm">
          <p className="text-xs text-gray-600">
            {calves.class_name}: {Math.round(worked.startLb)} lb, gaining {worked.gain} lb a day (the Feed tab&apos;s target) for{' '}
            <input className={field} inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} aria-label="Days on feed" /> days →{' '}
            {Math.round(worked.result.endLb)} lb, {Math.round(worked.result.gainLb)} lb put on.
          </p>

          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Feed, a head a day, from their ration</p>
            {worked.feeds.length === 0 && (
              <p className="text-xs text-amber-700">
                No ration set for this group on the Feed tab.{' '}
                <SetupLink managerOnly to={SETUP_LINKS.cattleFeed(ranchId)}>Set its ration</SetupLink>
              </p>
            )}
            <ul className="mt-1 space-y-1">
              {worked.feeds.map((f) => (
                <li key={f.id} className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="w-48 text-gray-700">{f.name}</span>
                  <span className="w-20 text-right tabular-nums">{f.asFedLbPerDay.toFixed(1)} lb</span>
                  {f.id === 'grain' ? (
                    <span className="text-gray-400">price it on the grain feed in the ration</span>
                  ) : (
                    <label className="flex items-center gap-1 text-gray-500">
                      $
                      <input
                        className={field}
                        inputMode="decimal"
                        disabled={!isManager}
                        defaultValue={f.pricePerTonne ?? ''}
                        placeholder="—"
                        onBlur={(e) => {
                          const v = numOrNull(e.target.value)
                          // A typed price is kept from then on; cleared, the AFSC price list takes it back.
                          if (v !== f.pricePerTonne)
                            setType.mutate({
                              id: f.id,
                              patch:
                                v == null
                                  ? { price_per_tonne: null, price_source: null, price_note: null, price_as_of: null }
                                  : { price_per_tonne: v, price_source: 'manual', price_note: 'Set by hand', price_as_of: new Date().toLocaleDateString('en-CA') },
                            })
                        }}
                        aria-label={`${f.name} price a tonne`}
                      />
                      /t as fed
                      {f.priceNote && <span className="text-[10px] text-gray-400" title={f.priceNote}>{f.priceFrom}</span>}
                    </label>
                  )}
                </li>
              ))}
            </ul>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <label className="text-xs text-gray-500">
              Yardage $/head/day
              <input className={`mt-0.5 block ${field}`} inputMode="decimal" value={yardage} onChange={(e) => setYardage(e.target.value)} placeholder={calfYardage != null ? calfYardage.toFixed(2) : 'e.g. 0.60'} />
            </label>
            <label className="text-xs text-gray-500">
              Vet $/head
              <input className={`mt-0.5 block ${field}`} inputMode="decimal" value={vet} onChange={(e) => setVet(e.target.value)} />
            </label>
            <label className="text-xs text-gray-500">
              Interest %
              <input className={`mt-0.5 block ${field}`} inputMode="decimal" value={interest} onChange={(e) => setInterest(e.target.value)} />
            </label>
            <label className="text-xs text-gray-500">
              Calf value $
              <input className={`mt-0.5 block ${field}`} inputMode="decimal" value={calfValue} onChange={(e) => setCalfValue(e.target.value)} placeholder="weight × price" />
            </label>
          </div>

          <div className="rounded-md bg-white px-3 py-2 text-xs">
            <ul className="space-y-0.5">
              {worked.result.lines.map((l) => (
                <li key={l.label} className="flex gap-2">
                  <span className="w-36 text-gray-700">{l.label}</span>
                  <span className="w-16 text-right tabular-nums">{money(l.dollars)}</span>
                  <span className="text-gray-400">{l.working}</span>
                </li>
              ))}
            </ul>
            <p className="mt-1.5 text-sm">
              {money(worked.result.total)} ÷ {Math.round(worked.result.gainLb)} lb ={' '}
              <b className="tabular-nums">{worked.result.perLb != null ? `$${worked.result.perLb.toFixed(2)}/lb` : '—'}</b>
              {worked.result.perLb != null && isManager && (
                <button type="button" onClick={() => onUse(worked.result.perLb!)} className="ml-2 rounded border border-brand-300 px-1.5 py-0.5 text-[11px] font-semibold text-brand-800 hover:bg-brand-50">
                  Use this
                </button>
              )}
            </p>
            {worked.result.missing.length > 0 && (
              <p className="mt-1 text-amber-700">Still to fill in: {worked.result.missing.join(', ')} — until then the answer is low by what they cost.</p>
            )}
          </div>
        </div>
      )}
    </details>
  )
}
