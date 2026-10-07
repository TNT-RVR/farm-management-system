import { useEffect, useMemo, useState } from 'react'
import { CloudSnow, Wheat } from 'lucide-react'
import { Select } from '@/components/Select'
import { HelpNote } from '@/components/HelpNote'
import { SETUP_LINKS, SetupLink } from '@/components/SetupLink'
import { useHerdCounts } from '@/lib/cattle'
import { useRanches } from '@/lib/ranches'
import { feedDays, useFeedPlan, useSetFeedPlan } from '@/lib/feed'
import { useFeedOnHand } from '@/lib/feed-inventory'
import { COAT_LABEL, coldUplift, effectiveTemp, solveRation, type Coat } from '@/lib/cattle-nutrition'
import {
  feedValues,
  feedingWindow,
  groupInput,
  monthlyCold,
  planSettings,
  rationLines,
  seasonInputs,
  seasonPlan,
  todayConditions,
  usableInYard,
  useColdForecast,
  useFeedTests,
  useFeedTypesFull,
  useGroupRations,
  useStubble,
  useWinterHistory,
  fedHead,
  type Settings,
} from '@/lib/winter-feeding'
import { stubbleCowDays } from '@/lib/cattle-nutrition'
import { cn } from '@/lib/utils'
import { FeedRation } from './FeedRation'
import { FeedInfo } from './feed/FeedInfo'
import { GroupCard } from './feed/GroupCard'
import { FeedQuality } from './feed/FeedQuality'
import { CornStubble } from './feed/CornStubble'
import { Num, n0, n1, tonnes, yardAmount } from './feed/bits'
import { YardPlanner } from './feed/YardPlanner'
import type { YardFeed, YardGroup } from '@/lib/yard-rations'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const fmtDate = (d: Date | string) => new Date(typeof d === 'string' ? d + 'T00:00:00' : d).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })

/** Recurring month + day picker (no year). */
function MonthDay({ month, day, disabled, onChange }: { month: number | null; day: number | null; disabled?: boolean; onChange: (m: number | null, d: number | null) => void }) {
  return (
    <div className="mt-0.5 flex items-center gap-1.5">
      <Select
        value={month == null ? '' : String(month)}
        size="sm"
        disabled={disabled}
        ariaLabel="Month"
        className="w-20"
        onChange={(v) => onChange(v === '' ? null : Number(v), day ?? (v === '' ? null : 1))}
        options={[{ value: '', label: 'Month' }, ...MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))]}
      />
      <input
        type="number"
        min={1}
        max={31}
        placeholder="Day"
        disabled={disabled}
        defaultValue={day ?? ''}
        key={`${month}-${day}`}
        onBlur={(e) => {
          const d = e.target.value === '' ? null : Math.min(31, Math.max(1, Math.round(Number(e.target.value))))
          if (d !== day) onChange(month, d)
        }}
        className="w-14 rounded-md border border-gray-300 px-2 py-1 text-right text-sm tabular-nums"
      />
    </div>
  )
}

/** What one ranch contributes to a whole-operation feed total. */
export type FeedTotals = {
  ranchId: string
  totalHead: number
  /** Dry matter eaten from today (or the start of feeding) to turnout, lb. */
  dmLb: number
  /** Feed to put out over the same days, as fed with waste, lb. */
  neededLb: number
  days: number
  shortFeeds: string[]
}

/**
 * Winter feeding for one ranch, by energy.
 *
 * The need comes from each group's class, weight, stage and condition, raised
 * for cold (today's forecast; the season from this ranch's last five winters)
 * and mud. The group's ration is fed in the amount that meets it. The season
 * is walked day by day to turnout and set against what is left in the yard.
 */
export function FeedCalculator({ isManager, ranchId, onTotals }: { isManager: boolean; ranchId: string; onTotals?: (t: FeedTotals) => void }) {
  const { data: plan } = useFeedPlan(ranchId)
  const { data: counts } = useHerdCounts(ranchId)
  const { data: ranches } = useRanches()
  const { data: types } = useFeedTypesFull()
  const { data: tests } = useFeedTests()
  const { data: rations } = useGroupRations(ranchId)
  const { data: stubble } = useStubble(ranchId)
  const { data: onHand } = useFeedOnHand(ranchId)
  const ranch = ranches?.find((r) => r.id === ranchId)
  const lat = ranch?.latitude == null ? null : Number(ranch.latitude)
  const lon = ranch?.longitude == null ? null : Number(ranch.longitude)
  const { data: history } = useWinterHistory(lat, lon)
  const { data: forecast } = useColdForecast(lat, lon)
  const setPlan = useSetFeedPlan()
  const patch = (p: Parameters<typeof setPlan.mutate>[0]['patch']) => plan && setPlan.mutate({ id: plan.id, patch: p })

  const values = useMemo(() => feedValues(types ?? [], tests ?? []), [types, tests])
  const excluded = useMemo(() => new Set(plan?.excluded_group_ids ?? []), [plan])
  const notUsed = useMemo(() => new Set(plan?.feeds_not_used ?? []), [plan])
  const settings = useMemo<Settings | null>(() => (plan ? planSettings(plan) : null), [plan])

  // Today, fixed for this visit — the page is read in the morning and acted on.
  const [now] = useState(() => new Date())
  const todayIso = isoDay(now)
  const window = useMemo(() => (plan ? feedingWindow(plan, now) : null), [plan, now])
  const daysToTurnout = window ? Math.max(0, Math.round((window.to.getTime() - now.getTime()) / 86_400_000)) : 120
  const todayWx = forecast?.days.find((d) => d.date === todayIso)
  const cond = useMemo(() => (settings ? todayConditions(settings, todayWx, daysToTurnout, now) : null), [settings, todayWx, daysToTurnout, now])
  // Groups with nobody in them are managed on the Herd tab, not fed here.
  const groups = useMemo(() => (counts ?? []).filter((c) => c.head_count > 0), [counts])

  const today = useMemo(() => {
    if (!cond) return new Map()
    return new Map(
      (counts ?? []).map((g) => [g.id, solveRation(groupInput(g), { ...cond, freeChoice: false }, rationLines(g.id, rations ?? [], values))]),
    )
  }, [counts, rations, values, cond])

  const coldByMonth = useMemo(() => (settings ? monthlyCold(history?.months, settings.coat, settings.sheltered) : new Map<number, number>()), [history, settings])

  // What is in the yard, usable: left × (1 − storage loss still to come). Only feeds with something recorded as put up.
  const usable = useMemo(() => usableInYard(onHand ?? [], values), [onHand, values])

  const season = useMemo(() => {
    if (!settings || !window) return null
    const inputs = seasonInputs(counts ?? [], excluded, rations ?? [], values, stubble ?? [], ranch?.weaning_date)
    return seasonPlan({ groups: inputs.groups, settings, from: window.from, to: window.to, coldByMonth, stubble: inputs.stubble, onHand: usable })
  }, [settings, window, counts, excluded, rations, values, stubble, coldByMonth, usable, ranch?.weaning_date])

  const shortFeeds = useMemo(() => {
    if (!season || !settings) return [] as string[]
    return [...season.needLb]
      .filter(([id, need]) => usable.has(id) && (usable.get(id) ?? 0) < need * (1 + settings.reservePct / 100))
      .map(([id]) => values.get(id)?.name ?? '?')
  }, [season, usable, values, settings])

  useEffect(() => {
    if (!season) return
    onTotals?.({
      ranchId,
      totalHead: (counts ?? []).filter((g) => !excluded.has(g.id)).reduce((s, g) => s + fedHead(g), 0),
      dmLb: season.dmLb,
      neededLb: [...season.needLb.values()].reduce((s, v) => s + v, 0) + season.extraGrainLb,
      days: season.days,
      shortFeeds,
    })
  }, [onTotals, ranchId, season, counts, excluded, shortFeeds])

  // The yard, as the ration planner sees it: counted feeds this ranch uses.
  const yardFeeds: YardFeed[] = (onHand ?? [])
    .filter((f) => f.put_up_lb > 0 && f.remaining_lb > 0 && !f.is_bedding && !notUsed.has(f.feed_type_id))
    .flatMap((f) => {
      const v = values.get(f.feed_type_id)
      return v ? [{ ...v, usableAsFedLb: usable.get(f.feed_type_id) ?? 0 }] : []
    })
  const yardGroups: YardGroup[] = (counts ?? [])
    .filter((g) => !excluded.has(g.id) && fedHead(g) > 0)
    .map((g) => ({
      id: g.id,
      name: g.class_name,
      group: groupInput(g),
      wasteFor: (feedId: string) => {
        const r = (rations ?? []).find((x) => x.herd_count_id === g.id && x.feed_type_id === feedId)
        return r ? Number(r.waste_pct) : null
      },
      stubbleCowDays: (stubble ?? [])
        .filter((s) => s.herd_count_id === g.id && s.snow_state !== 'crust')
        .reduce((sum, s) => sum + stubbleCowDays(Number(s.acres), Number(s.yield_bu), Number(s.weather_loss_pct), Number(g.avg_weight_lb)).cowDays, 0),
    }))
  // Why the rations on file don't fit the yard.
  const yardProblems: string[] = []
  if (season && usable.size > 0) {
    for (const [id, date] of season.runsOut) yardProblems.push(`${values.get(id)?.name ?? '?'} runs out ${fmtDate(date)}, before turnout.`)
    for (const id of season.needLb.keys()) {
      if (!usable.has(id)) yardProblems.push(`${values.get(id)?.name ?? '?'} is in a ration but not counted in the yard.`)
      else if (notUsed.has(id)) yardProblems.push(`${values.get(id)?.name ?? '?'} is in a ration but switched off for this ranch.`)
    }
  }

  if (!plan || !settings || !window) return <p className="py-16 text-center text-sm text-gray-400">Loading…</p>

  const toggle = (id: string) => {
    const next = new Set(excluded)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    patch({ excluded_group_ids: [...next] })
  }
  const nothingCounted = (onHand ?? []).every((f) => f.put_up_lb <= 0)
  const week = (forecast?.days ?? []).filter((d) => d.date >= todayIso).slice(0, 7)
  const feedDaysTotal = feedDays(plan.start_month, plan.start_day, plan.end_month, plan.end_day)

  return (
    <div className="space-y-5">
      {/* Settings */}
      <div className="flex flex-wrap items-end gap-x-5 gap-y-3 rounded-lg border border-gray-200 bg-white p-3">
        <div>
          <label className="block text-xs text-gray-500">Corral feeding starts</label>
          <MonthDay month={plan.start_month} day={plan.start_day} disabled={!isManager} onChange={(m, d) => patch({ start_month: m, start_day: d })} />
        </div>
        <div>
          <label className="block text-xs text-gray-500">Turnout</label>
          <MonthDay month={plan.end_month} day={plan.end_day} disabled={!isManager} onChange={(m, d) => patch({ end_month: m, end_day: d })} />
        </div>
        <div>
          <label className="flex items-center gap-1 text-xs text-gray-500">
            Calving starts <FeedInfo k="calving" />
          </label>
          <MonthDay month={plan.calving_month} day={plan.calving_day} disabled={!isManager} onChange={(m, d) => m && d && patch({ calving_month: m, calving_day: d })} />
        </div>
        <div>
          <label className="flex items-center gap-1 text-xs text-gray-500">
            Coat <FeedInfo k="coat" />
          </label>
          <Select value={plan.coat} size="sm" disabled={!isManager} ariaLabel="Coat" className="mt-0.5 w-44" onChange={(v) => patch({ coat: v as Coat })} options={(Object.keys(COAT_LABEL) as Coat[]).map((c) => ({ value: c, label: COAT_LABEL[c] }))} />
        </div>
        <label className="flex items-center gap-1.5 text-sm text-gray-700">
          <input type="checkbox" checked={plan.sheltered} disabled={!isManager} onChange={(e) => patch({ sheltered: e.target.checked })} className="h-4 w-4 rounded border-gray-300" />
          Windbreak <FeedInfo k="sheltered" />
        </label>
        <label className="flex items-center gap-1.5 text-sm text-gray-700">
          <input type="checkbox" checked={plan.muddy} disabled={!isManager} onChange={(e) => patch({ muddy: e.target.checked })} className="h-4 w-4 rounded border-gray-300" />
          Muddy pens <FeedInfo k="muddy" />
        </label>
        <label className="text-xs text-gray-500">
          <span className="flex items-center gap-1">
            Reserve <FeedInfo k="reserve" />
          </span>
          <Num value={Number(plan.reserve_pct)} step="5" min={0} max={100} suffix="%" disabled={!isManager} onCommit={(v) => v != null && patch({ reserve_pct: v })} />
        </label>
        <span className="ml-auto flex items-center gap-1 text-xs text-gray-400">
          How it works <FeedInfo k="method" />
        </span>
      </div>

      {/* Feeds this ranch uses */}
      <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2">
        <span className="mr-1 flex items-center gap-1 text-xs text-gray-500">
          Feeds used at this ranch <FeedInfo k="feedsHere" />
        </span>
        {(types ?? [])
          .filter((t) => !t.is_bedding)
          .map((t) => {
            const on = !notUsed.has(t.id)
            return (
              <button
                key={t.id}
                type="button"
                disabled={!isManager}
                onClick={() => {
                  const next = new Set(notUsed)
                  if (on) next.add(t.id)
                  else next.delete(t.id)
                  patch({ feeds_not_used: [...next] })
                }}
                className={cn(
                  'rounded-full border px-2 py-0.5 text-xs',
                  on ? 'border-emerald-300 bg-emerald-50 text-emerald-900' : 'border-gray-200 bg-white text-gray-400 line-through',
                )}
                aria-pressed={on}
              >
                {t.name}
              </button>
            )
          })}
      </div>

      {/* Today */}
      <div className="rounded-lg border border-sky-200 bg-sky-50/50 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
            <CloudSnow className="h-4 w-4 text-sky-600" />
            {cond?.airC != null && cond.windKmh != null ? (
              <>
                Today {n1(cond.airC)} °C, wind {n0(cond.windKmh)} km/h — feels like {n1(effectiveTemp(cond.airC, cond.windKmh, settings.sheltered))} °C to a cow ·{' '}
                <span className={cn(cond.cold > 0.3 ? 'text-red-700' : cond.cold > 0 ? 'text-amber-800' : 'text-emerald-700')}>{cond.cold > 0 ? `+${n0(cond.cold * 100)}% energy for cold` : 'no cold stress'}</span>
              </>
            ) : (
              'Today’s weather is loading…'
            )}
            <FeedInfo k="coat" />
          </p>
          {!window.feeding && <span className="text-xs text-gray-500">Corral feeding starts {fmtDate(window.from)} — the plan below is for that winter.</span>}
        </div>
        {week.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {week.map((d) => {
              const up = d.t != null && d.w != null ? coldUplift(d.t, d.w, settings.coat, settings.sheltered) : 0
              const wet = (d.rain ?? 0) > 1 && (d.t ?? 0) > -2
              return (
                <span key={d.date} className={cn('rounded-md border px-2 py-0.5 text-[11px] tabular-nums', up > 0.3 ? 'border-red-200 bg-red-50 text-red-800' : up > 0 ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-gray-200 bg-white text-gray-600')}>
                  {new Date(d.date + 'T00:00:00').toLocaleDateString('en-CA', { weekday: 'short' })} {d.t != null ? `${n0(d.t)}°` : '—'} {d.w != null ? `${n0(d.w)} km/h` : ''} {up > 0 ? `+${n0(up * 100)}%` : ''}
                  {wet && ' · rain: wet coats?'}
                </span>
              )
            })}
          </div>
        )}
      </div>

      {/* Rations from the yard */}
      <YardPlanner
        isManager={isManager}
        counted={!nothingCounted}
        feeds={yardFeeds}
        groups={yardGroups}
        args={{ from: window.from, to: window.to, coldByMonth, calvingMonth: settings.calvingMonth, calvingDay: settings.calvingDay, muddy: settings.muddy, reservePct: settings.reservePct }}
        problems={yardProblems}
      />

      {/* Groups */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900">Groups — what to feed today</h2>
          <span className="text-xs text-gray-400">Tap a group to set its weight, condition and ration</span>
        </div>
        {groups.length === 0 ? (
          <p className="rounded-lg border border-gray-200 bg-white px-4 py-8 text-center text-sm text-gray-400">
            No head counted at this ranch yet. Set the group totals on the Herd tab and they flow in here.{' '}
            <SetupLink managerOnly to={SETUP_LINKS.cattleHerd(ranchId)}>Count the herd</SetupLink>
          </p>
        ) : (
          groups.map((g) => (
            <GroupCard
              key={g.id}
              group={g}
              ration={(rations ?? []).filter((r) => r.herd_count_id === g.id)}
              values={values}
              notUsed={notUsed}
              result={today.get(g.id) ?? null}
              isManager={isManager}
              included={!excluded.has(g.id)}
              onToggle={() => toggle(g.id)}
              weaningDate={ranch?.weaning_date ?? null}
            />
          ))
        )}
      </section>

      {/* Season */}
      {season && (
        <section className="rounded-lg border border-gray-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-3 py-2">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
              <Wheat className="h-4 w-4 text-gray-400" /> Will the feed last? {fmtDate(window.from)} to turnout {fmtDate(window.to)} ({season.days} of {feedDaysTotal} days) <FeedInfo k="daysOfFeed" />
            </h2>
            <span className="flex items-center gap-1 text-xs text-gray-400">
              Cold from {history?.winters ? `the ${history.winters} winters` : 'the last five winters'} <FeedInfo k="seasonCold" />
            </span>
          </div>
          {coldByMonth.size > 0 && (
            <p className="px-3 pt-2 text-[11px] text-gray-500">
              Average cold allowance by month:{' '}
              {[10, 11, 12, 1, 2, 3, 4, 5]
                .filter((m) => coldByMonth.has(m))
                .map((m) => `${MONTHS[m - 1]} +${n0((coldByMonth.get(m) ?? 0) * 100)}%`)
                .join(' · ')}
            </p>
          )}
          {nothingCounted && (
            <p className="mx-3 mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
              Nothing is counted in the yard yet — this shows what is needed, not whether you have it. Record it under Feed records → Feed put up (“Counted on hand”).
            </p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wide text-gray-400">
                  <th className="px-3 py-1.5 font-medium">Feed</th>
                  <th className="px-2 py-1.5 text-right font-medium">Needed to turnout</th>
                  <th className="px-2 py-1.5 text-right font-medium">+ reserve</th>
                  <th className="px-2 py-1.5 text-right font-medium">Usable in the yard</th>
                  <th className="px-2 py-1.5 text-right font-medium">Short / spare</th>
                  <th className="px-3 py-1.5 text-right font-medium">Runs out</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {[...season.needLb]
                  .filter(([, lb]) => lb > 0)
                  .sort((a, b) => b[1] - a[1])
                  .map(([id, need]) => {
                    const v = values.get(id)
                    const withReserve = need * (1 + settings.reservePct / 100)
                    const have = usable.get(id)
                    const diff = have == null ? null : have - withReserve
                    const out = season.runsOut.get(id)
                    return (
                      <tr key={id}>
                        <td className="px-3 py-1.5 text-gray-900">{v?.name ?? '?'}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">
                          {tonnes(need)} t<span className="block text-[10px] text-gray-400">{yardAmount(need, v?.unit, v?.lbPerBale)}</span>
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-gray-600">{tonnes(withReserve)} t</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{have == null ? <span className="text-xs text-gray-400">not counted</span> : `${tonnes(have)} t`}</td>
                        <td className={cn('px-2 py-1.5 text-right font-semibold tabular-nums', diff == null ? 'text-gray-300' : diff < 0 ? 'text-red-700' : 'text-emerald-700')}>
                          {diff == null ? '—' : diff < 0 ? `${tonnes(-diff)} t short` : `${tonnes(diff)} t spare`}
                        </td>
                        <td className={cn('px-3 py-1.5 text-right text-xs', out ? 'font-semibold text-red-700' : 'text-gray-400')}>{out ? fmtDate(out) : have == null ? '—' : 'lasts'}</td>
                      </tr>
                    )
                  })}
                {season.extraGrainLb > 1 && (
                  <tr>
                    <td className="px-3 py-1.5 text-amber-900">Grain to add where a ration falls short</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-amber-900">{tonnes(season.extraGrainLb)} t</td>
                    <td colSpan={4} className="px-2 py-1.5 text-xs text-amber-800">not in any ration — cold months, late pregnancy or thin cows push the need past what the forage carries</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {/* The one home for "will the feed last". Feed records shows only
              what is left, at the rate it has actually gone out. */}
          <HelpNote
            className="border-t border-gray-100 px-3 py-2"
            summary={
              <>
                {n0(season.dmLb / 2204.62)} t of dry matter eaten, waste on top
                {season.stubbleCowDays > 0 && ` · stalks carry ${n0(season.stubbleCowDays)} cow-days`}
              </>
            }
            title="How the season is worked out"
          >
            <p>
              Day by day: each group at its stage that day, this month&apos;s average cold, head as counted today. Usable in the yard is what is left × (1 − storage loss
              still to come).
            </p>
            <p>
              Feed records → Feed left works it the other way: how many days each feed lasts at the rate it actually went out over the last 30 days of feed sheets.
            </p>
          </HelpNote>
        </section>
      )}

      {/* Corn stubble */}
      <CornStubble
        ranchId={ranchId}
        rows={stubble ?? []}
        groups={(counts ?? []).filter((g) => g.head_count > 0)}
        isManager={isManager}
        savedLb={[...(season?.stubbleSavedLb ?? new Map<string, number>())].filter(([, lb]) => lb > 0).map(([id, lb]) => ({ name: values.get(id)?.name ?? '?', lb }))}
      />

      {/* Feed quality */}
      <FeedQuality types={types ?? []} tests={tests ?? []} values={values} isManager={isManager} />

      {/* Crops to grow for next winter */}
      <FeedRation isManager={isManager} ranchId={ranchId} plan={plan} herds={counts ?? []} />
    </div>
  )
}
