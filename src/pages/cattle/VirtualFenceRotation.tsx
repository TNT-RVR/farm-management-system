import { Fragment, useCallback, useMemo, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { HelpNote } from '@/components/HelpNote'
import { CardList, Dot, RowCard, SummaryLine } from '@/components/RowCards'
import { rowClick } from '@/components/RecordEditor'
import { auFor } from '@/lib/animal-units'
import { mobsForRanch, mobsNow, useActivations } from '@/lib/eshepherd'
import { useFeature } from '@/lib/farm-setup'
import { n0, n1 } from '@/lib/format'
import {
  computePastures,
  grazingRain,
  useGrazingHerd,
  useGrazingPastures,
  usePastureFieldContext,
  usePastureSeasonFactors,
  useRanchPrecip,
  type HerdRow,
} from '@/lib/grazing'
import { grazingSeason } from '@/lib/field-residue'
import { windowRainFactor } from '@/lib/forage-regrowth'
import { AU_INTAKE_LB_PER_DAY, AU_TOTAL_LB_PER_DAY, AU_WASTE_LB_PER_DAY } from '@/lib/forage-yield'
import { mobClass } from '@/lib/pasture-move'
import { useRanches, type Ranch } from '@/lib/ranches'
import { TABLE_HEAD } from '@/lib/table-style'
import { cn } from '@/lib/utils'
import { DEFAULT_UTILIZATION } from '@/lib/forage-response'
import {
  DEFAULT_DAYS_PER_ROTATION,
  fenceDemand,
  fencePlan,
  fenceTotals,
  secondPass,
  type FenceMob,
  type FencePaddockInput,
  type FencePaddockPlan,
  type SecondPass,
} from '@/lib/virtual-fence'

const DAYS_KEY = 'virtual_fence_days'
const CALVES_KEY = 'virtual_fence_calves'

const readNum = (key: string, fallback: number) => {
  try {
    const v = Number(localStorage.getItem(key))
    return Number.isFinite(v) && v > 0 ? v : fallback
  } catch {
    return fallback
  }
}
const write = (key: string, v: string) => {
  try {
    localStorage.setItem(key, v)
  } catch {
    // Blocked storage: the setting lasts until the page is reloaded.
  }
}

/** Acres to a tenth under ten, whole above: a one-day fence can be 4.3 ac. */
const ac = (v: number) => (v > 0 && v < 10 ? n1(v) : n0(v))

/** The herd class a collar mob belongs to, so its AU per head is the ranch's own figure. */
const CLASS_FEED: Record<string, string> = { Bulls: 'bull', 'Replacement heifers': 'bred_heifer', Cows: 'cow' }

/**
 * How big to make each virtual fence (Sam, 12 Nov 2026).
 *
 * The Grazing tab says how long a paddock lasts a herd. Behind collars the
 * question turns around: the paddock is cut into strips, and what needs
 * working out is how many acres one strip has to hold to keep the mob fed for
 * the days you mean to leave it there, how many strips the paddock makes, and
 * how long the lot of them lasts. The arithmetic is in lib/virtual-fence.ts.
 *
 * Mobs, not herd classes, where the collars are in use: a fence is set around
 * a mob, and the collar export already knows how many head are in it. Their AU
 * per head still comes from the ranch's own Herd tab, which is the only place
 * the cattle are weighed.
 */
export function VirtualFenceRotation({ ranch }: { ranch: Ranch }) {
  const [days, setDays] = useState(() => readNum(DAYS_KEY, DEFAULT_DAYS_PER_ROTATION))
  const [turnInPick, setTurnInPick] = useState<string | null>(null)
  const [picked, setPicked] = useState<Set<string> | null>(null)
  const [heads, setHeads] = useState<Record<string, number>>({})
  const [opened, setOpened] = useState<Set<string>>(() => new Set())
  const [calvesOn, setCalvesOn] = useState(() => {
    try {
      return localStorage.getItem(CALVES_KEY) !== '0'
    } catch {
      return true
    }
  })

  /* ---------------------------------------------------------- the mobs */

  const collarsOn = useFeature('collars')
  const { data: acts } = useActivations()
  const { data: ranches } = useRanches()
  const { data: herd } = useGrazingHerd(ranch.id)

  const classes = useMemo(() => (herd ?? []).filter((h) => h.head_count > 0), [herd])
  /*
   * Calves wear no collars, so a mob of cows is counted as cows and the calves
   * at side ride along: one calf a cow at most, at the calves class's own AU.
   * The same figure the planner uses for a cow stay. With the classes picked
   * by hand instead, the calves are a row of their own and are not added here
   * — that would count them twice.
   */
  const calfAuPerCow = useMemo(() => {
    if (!calvesOn) return 0
    const calves = classes.find((h) => h.feed_class === 'backgrounder' || /calf|calves/i.test(h.class_name))
    const cows = classes.filter((h) => h.feed_class === 'cow').reduce((a, h) => a + h.head_count, 0)
    if (!calves || cows <= 0) return 0
    return Math.min(1, calves.head_count / cows) * auFor(calves)
  }, [classes, calvesOn])

  const auOfClass = (feed: string, fallback: number) => {
    const row = classes.find((h) => h.feed_class === feed) ?? classes.find((h) => h.class_name.toLowerCase().includes(feed))
    return row ? auFor(row) : fallback
  }

  const collarMobs = useMemo<FenceMob[]>(() => {
    if (!collarsOn) return []
    const names = (ranches ?? []).map((r) => r.name)
    // A mob the export keeps after its last animal was moved out is not a mob.
    return mobsForRanch(mobsNow(acts ?? []), ranch.name, names)
      .filter((m) => (m.head_count ?? 0) > 0)
      .map((m) => {
        const cls = mobClass(m.mob)
        const au = auOfClass(CLASS_FEED[cls] ?? 'cow', cls === 'Bulls' ? 1.7 : cls === 'Cows' ? 1.4 : 1)
        return {
          id: `mob:${m.mob}`,
          name: m.mob,
          head: m.head_count ?? 0,
          auPerHead: au + (cls === 'Cows' ? calfAuPerCow : 0),
        }
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collarsOn, acts, ranches, ranch.name, classes, calfAuPerCow])

  // No collars on this farm, or none imported for this ranch: the herd classes
  // stand in for mobs, which is how the rest of the cattle side counts cattle.
  const classMobs = useMemo<FenceMob[]>(
    () => classes.map((h: HerdRow) => ({ id: `class:${h.id}`, name: h.class_name, head: h.head_count, auPerHead: auFor(h) })),
    [classes],
  )
  const byMob = collarMobs.length > 0
  const available = byMob ? collarMobs : classMobs

  const biggest = useMemo(
    () => [...available].sort((a, b) => b.head * b.auPerHead - a.head * a.auPerHead)[0]?.id ?? null,
    [available],
  )
  const chosenIds = useMemo(() => {
    const ids = new Set(available.map((m) => m.id))
    if (!picked) return new Set(biggest ? [biggest] : [])
    return new Set([...picked].filter((id) => ids.has(id)))
  }, [picked, available, biggest])
  const toggleMob = (id: string) =>
    setPicked(() => {
      const next = new Set(chosenIds)
      if (!next.delete(id)) next.add(id)
      return next
    })

  const mobs = useMemo(
    () => available.map((m) => ({ ...m, head: heads[m.id] ?? m.head })),
    [available, heads],
  )
  // Memoised so the paddock table below is not rebuilt on every keystroke
  // anywhere on the page: both `mobs` and `chosenIds` are themselves stable.
  // The same pounds the paddock's supply is counted in, or a strip reads as
  // lasting a fifth longer than it does.
  const countWaste = ranch.grazing_count_waste ?? true
  const demand = useMemo(
    () => fenceDemand(mobs.filter((m) => chosenIds.has(m.id)), countWaste),
    [mobs, chosenIds, countWaste],
  )

  /* ------------------------------------------------------ the paddocks */

  const { data: pastures } = useGrazingPastures(ranch.id)
  const { data: measured } = useRanchPrecip(ranch)
  const { data: factors } = usePastureSeasonFactors(ranch.id)
  const rain = useMemo(() => grazingRain(ranch, measured), [ranch, measured])
  const fieldCtx = usePastureFieldContext(ranch.id, herd)
  const seasonCtx = useMemo(() => fieldCtx.ctx(), [fieldCtx])
  const factorFor = useMemo(() => {
    const m = new Map<string, number>()
    for (const f of factors ?? []) if (f.factor != null) m.set(f.grazing_pasture_id, f.factor)
    return m
  }, [factors])
  // The Grazing tab's own figures, so a paddock's feed is the same number on
  // both screens: this season's rain or the satellite's factor, less the
  // utilisation rate, with the crop fields inside the fence counted.
  const inputs = useMemo<FencePaddockInput[]>(
    () =>
      computePastures(pastures ?? [], rain, utilizationOf(ranch), seasonCtx, factorFor, null, ranch.grazing_count_waste ?? true)
        .filter((p) => p.totalLbs > 0)
        .map((p) => ({
          id: p.id,
          name: p.name,
          grazeableAc: p.totalGrazeableAc,
          lbPerAc: p.foragePerAcreUtil,
          totalLb: p.totalLbs,
          surfaces: [
            { label: 'Native grass', acres: p.nativeGrassAc, lb: p.nativeLbs },
            {
              label: p.fieldsLinked ? 'Crop fields in the fence' : 'Irrigated grass',
              acres: Math.max(0, p.totalGrazeableAc - p.nativeGrassAc),
              lb: p.fieldLbs,
            },
          ],
        })),
    [pastures, rain, ranch, seasonCtx, factorFor],
  )

  const plans = useMemo(() => inputs.map((p) => fencePlan(p, demand, days)), [inputs, demand, days])
  const totals = fenceTotals(plans)

  /* ------------------------------------------------------ what grows back */

  // Turn-in defaults to the ranch's own turnout, next year's from August on,
  // the way the planner picks its season: in November, today would say every
  // paddock regrows nothing, which is true and useless.
  const thisYear = new Date().getFullYear()
  const planYear = new Date().getMonth() >= 7 ? thisYear + 1 : thisYear
  const season = useMemo(() => grazingSeason(herd ?? [], planYear), [herd, planYear])
  const today = new Date().toISOString().slice(0, 10)
  const turnIn = turnInPick ?? (today > season.from && today < season.to ? today : season.from)

  /*
   * Rain over the stretch a strip is resting, against the long-term average
   * for the same stretch — divided by how the season as a whole is going,
   * because that is already in the paddock's own lb/ac. Without the division
   * this year's weather would be counted twice, the same trap the zone/rain
   * split fixed on 12 Nov.
   *
   * A window with no measured day in it — next season's plan, or any stretch
   * past the last reading — is left at 1 rather than divided. Dividing there
   * would quietly discount next year's regrowth by however this year went,
   * which is not a thing the weather does.
   */
  const seasonFactor = rain.rainFactor || 1
  const lastMeasured = measured?.series?.length ? measured.series[measured.series.length - 1].t.slice(0, 10) : null
  const rainFactorFor = useCallback(
    (from: string, to: string) => {
      if (!lastMeasured || from >= lastMeasured) return 1
      const w = windowRainFactor(measured?.series ?? [], measured?.normal?.cumulative, from, to)
      return Math.min(3, Math.max(0.25, w / seasonFactor))
    },
    [measured, seasonFactor, lastMeasured],
  )

  const util = utilizationOf(ranch)
  const passes = useMemo(() => {
    const m = new Map<string, SecondPass>()
    for (const p of plans) {
      m.set(
        p.id,
        secondPass(p, demand, days, {
          // Gross: the utilisation rate comes off inside secondPass, once.
          seasonPotentialLbPerAc: util > 0 ? p.lbPerAc / util : 0,
          takePct: util,
          turnIn,
          rainFactorFor,
        }),
      )
    }
    return m
  }, [plans, demand, days, util, turnIn, rainFactorFor])
  const regrowDays = plans.reduce((a, p) => a + (passes.get(p.id)?.days ?? 0), 0)
  const toggleOpen = (id: string) =>
    setOpened((o) => {
      const next = new Set(o)
      if (!next.delete(id)) next.add(id)
      return next
    })

  if (available.length === 0 || inputs.length === 0) return null

  const nothing = demand.au <= 0

  return (
    <section>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-gray-900">Virtual fence rotation</h2>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <label className="flex items-center gap-1.5 text-xs text-gray-600">
          Turn in
          <input
            type="date"
            value={turnIn}
            onChange={(e) => e.target.value && setTurnInPick(e.target.value)}
            className="rounded-md border border-gray-300 px-1.5 py-1 text-sm tabular-nums"
          />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-gray-600">
          Days per rotation
          <input
            type="number"
            min="1"
            max="60"
            value={days}
            onChange={(e) => {
              const v = Math.min(60, Math.max(1, Math.round(Number(e.target.value) || 1)))
              setDays(v)
              write(DAYS_KEY, String(v))
            }}
            className="w-16 rounded-md border border-gray-300 px-1.5 py-1 text-right text-sm font-semibold tabular-nums"
          />
        </label>
        </div>
      </div>

      <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-3">
        {/* Who is behind the fence. Head is the collar export's, and typing
            over it splits a mob without changing anything but this screen. */}
        <div>
          <p className="text-xs font-medium text-gray-700">{byMob ? 'Mobs in the rotation' : 'Herd classes in the rotation'}</p>
          <div className="mt-1.5 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
            {mobs.map((m) => {
              const on = chosenIds.has(m.id)
              return (
                <div key={m.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    id={`vf-${m.id}`}
                    checked={on}
                    onChange={() => toggleMob(m.id)}
                    className="h-4 w-4 shrink-0 rounded border-gray-300 text-brand-700 focus:ring-brand-700"
                  />
                  <label htmlFor={`vf-${m.id}`} className="min-w-0 flex-auto truncate text-gray-800">
                    {m.name}
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={m.head}
                    disabled={!on}
                    aria-label={`${m.name} head`}
                    onChange={(e) => setHeads((h) => ({ ...h, [m.id]: Math.max(0, Math.round(Number(e.target.value) || 0)) }))}
                    className="w-16 shrink-0 rounded-md border border-gray-300 px-1.5 py-0.5 text-right text-sm tabular-nums disabled:border-transparent disabled:bg-transparent disabled:text-gray-400"
                  />
                  <span className={cn('w-20 shrink-0 text-right text-xs tabular-nums', on ? 'text-gray-500' : 'text-gray-300')}>
                    {n1(m.head * m.auPerHead)} AU
                  </span>
                </div>
              )
            })}
          </div>
          {byMob && calfAuPerCow > 0 && (
            <label className="mt-2 flex items-center gap-1.5 text-[11px] text-gray-500">
              <input
                type="checkbox"
                checked={calvesOn}
                onChange={() => {
                  const next = !calvesOn
                  setCalvesOn(next)
                  write(CALVES_KEY, next ? '1' : '0')
                }}
                className="h-3.5 w-3.5 rounded border-gray-300 text-brand-700 focus:ring-brand-700"
              />
              Count the calves at side with the cows (+{n1(calfAuPerCow)} AU a cow)
            </label>
          )}
        </div>

        {/* The answer in one line, before the paddock it is worked out for. */}
        <p className={cn('border-t border-gray-100 pt-2 text-sm', nothing ? 'text-gray-400' : 'text-gray-800')}>
          {nothing ? (
            byMob ? 'Tick a mob to size its fences.' : 'Tick a class to size its fences.'
          ) : (
            <>
              <span className="font-semibold tabular-nums">{n0(demand.head)}</span> head ·{' '}
              <span className="font-semibold tabular-nums">{n0(demand.au)}</span> AU eat{' '}
              <span className="font-semibold tabular-nums">{n0(demand.lbPerDay)}</span> lb a day, so one{' '}
              {days}-day fence has to hold <span className="font-semibold tabular-nums">{n0(demand.lbPerDay * days)}</span> lb
              of grazeable feed.
            </>
          )}
        </p>
      </div>

      <div className="mt-2 overflow-x-auto rounded-lg border border-gray-200 bg-white">
        {/* Phones: one card a paddock, tapped for the native-and-pivot split. */}
        <CardList>
          {plans.map((p) => (
            <RowCard
              key={p.id}
              onClick={rowClick(() => toggleOpen(p.id))}
              heading={
                <span className="flex items-center gap-1">
                  {(
                    <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 text-gray-400 transition-transform', opened.has(p.id) && 'rotate-90')} />
                  )}
                  {p.name}
                </span>
              }
              actions={
                <span className="whitespace-nowrap text-sm font-semibold tabular-nums text-gray-900">
                  {ac(p.acresPerRotation)} <span className="text-[11px] font-normal text-gray-400">ac a fence</span>
                </span>
              }
              facts={[]}
              summary={
                <SummaryLine>
                  <span className="tabular-nums">{n0(p.grazeableAc)} grazeable ac</span>
                  <Dot />
                  <span className="tabular-nums">{n0(p.lbPerAc)} lb/ac</span>
                  <Dot />
                  <Rotations p={p} />
                  <Dot />
                  <span className="tabular-nums">{n0(p.totalDays)} days</span>
                  <Dot />
                  <SecondPassDays sp={passes.get(p.id)} />
                </SummaryLine>
              }
            >
              {opened.has(p.id) && <FenceSplit p={p} sp={passes.get(p.id)} />}
            </RowCard>
          ))}
        </CardList>

        <table className="hidden w-full min-w-[640px] text-sm sm:table">
          <thead className={TABLE_HEAD}>
            <tr>
              <th className="px-2 py-2 font-medium">Paddock</th>
              <th className="px-2 py-2 text-right font-medium">Grazeable ac</th>
              <th className="px-2 py-2 text-right font-medium" title="Feed this paddock grows this season an acre, after the utilization rate">
                Feed lb/ac
              </th>
              <th className="px-2 py-2 text-right font-medium" title="Acres one virtual fence has to hold to feed the mobs for the days set above">
                Acres per rotation
              </th>
              <th className="px-2 py-2 text-right font-medium" title="Whole fences this paddock's grass holds — the times the fence gets moved inside it">
                Rotations
              </th>
              <th className="px-2 py-2 text-right font-medium" title="Days all of this paddock's grass feeds the mobs, the part rotation at the end included">
                Total days
              </th>
              <th
                className="px-2 py-2 text-right font-medium"
                title="Extra days the regrowth is worth by the time the fence comes back round to its first strip"
              >
                2nd pass
              </th>
            </tr>
          </thead>
          <tbody>
            {plans.map((p) => (
              <Fragment key={p.id}>
                <tr onClick={rowClick(() => toggleOpen(p.id))} className="cursor-pointer border-b border-gray-100 last:border-0 hover:bg-gray-50">
                  <td className="px-2 py-1.5 font-medium text-gray-800">
                    <span className="flex items-center gap-1">
                      <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 text-gray-400 transition-transform', opened.has(p.id) && 'rotate-90')} />
                      {p.name}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-gray-500">{n0(p.grazeableAc)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-gray-500">{n0(p.lbPerAc)}</td>
                  <td className="px-2 py-1.5 text-right font-medium tabular-nums">{ac(p.acresPerRotation)}</td>
                  <td className="px-2 py-1.5 text-right">
                    <Rotations p={p} />
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{n0(p.totalDays)}</td>
                  <td className="px-2 py-1.5 text-right">
                    <SecondPassDays sp={passes.get(p.id)} />
                  </td>
                </tr>
                {opened.has(p.id) && (
                  <tr className="border-b border-gray-100 bg-gray-50/60">
                    <td colSpan={7} className="px-2 py-2 pl-7">
                      <FenceSplit p={p} sp={passes.get(p.id)} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            <tr className="border-t border-gray-300 bg-gray-50 font-semibold text-gray-800">
              <td className="px-2 py-2">All paddocks</td>
              <td className="px-2 py-2 text-right tabular-nums">{n0(totals.grazeableAc)}</td>
              <td className="px-2 py-2 text-right tabular-nums">{n0(totals.lbPerAc)}</td>
              <td />
              <td className="px-2 py-2 text-right tabular-nums">{n0(totals.rotations)}</td>
              <td className="px-2 py-2 text-right tabular-nums">{n0(totals.totalDays)}</td>
              <td className="px-2 py-2 text-right tabular-nums text-emerald-700">{regrowDays >= 0.5 ? `+${n0(regrowDays)}` : '—'}</td>
            </tr>
          </tbody>
        </table>

        <HelpNote
          className="border-t border-gray-100 px-3 py-2"
          summary={`${n0(totals.rotations)} fences across the ranch, ${n0(totals.totalDays)} days of grazing for the mobs ticked${
            regrowDays >= 0.5 ? `, and ${n0(regrowDays)} more off the regrowth` : ''
          }.`}
          title="How the fences are sized"
        >
          <p>
            One animal unit is a 1,000 lb cow. She eats {AU_INTAKE_LB_PER_DAY} lb of feed a day, and this ranch is
            counting {countWaste ? `the ${AU_WASTE_LB_PER_DAY.toFixed(1)} lb she tramples and fouls as well, so ${AU_TOTAL_LB_PER_DAY.toFixed(1)} lb` : 'only what she eats'} a
            grazing day — set by &ldquo;Counting&rdquo; on the Grazing tab. Each mob&apos;s head comes from the collar
            export and its AU a head from the Herd tab, where the cattle are weighed. Type over the head to run the
            numbers for part of a mob.
          </p>
          <p className="mt-2">
            A fence has to hold what the mobs take for the days set above: animal units ×{' '}
            {(countWaste ? AU_TOTAL_LB_PER_DAY : AU_INTAKE_LB_PER_DAY).toFixed(1)} lb × days. Dividing that by
            the paddock&apos;s feed an acre gives the acres, and the paddock&apos;s whole feed divided by what the mobs
            eat a day gives the total days. <strong>Rotations</strong> is the whole number of fences the grass holds and{' '}
            <strong>total days</strong> is every pound of it, so the two seldom multiply out — the last fence of a
            paddock usually comes up short, and rounding it up would plan a move onto grass that is not there.
          </p>
          <p className="mt-2">
            Feed an acre is the Grazing tab&apos;s figure for this season, after the utilization rate, so nothing is
            taken off twice. It is an average over the paddock: a paddock with a pivot inside the fence opens to show
            how much smaller a strip over the stubble can be and still feed the mob, because stubble carries several
            times the feed of native grass.
          </p>
          <p className="mt-2">
            <strong>2nd pass</strong> is what has grown back by the time the fence gets round to its first strip again,
            a whole cycle later. Four things set it. The <em>season</em>: grass here grows on spring moisture and is
            finished by the end of August, so a strip grazed in June has half a year of growing left and one grazed in
            September has none, whatever the rain does. <em>How hard it was taken</em>: Crider (USDA Technical Bulletin
            1102, 1955) found that taking 40&nbsp;% of the leaf or less stops no root growth at all, taking 90&nbsp;%
            stops all of it, and root growth stays stopped 6 to 18 days — so a hard take loses days off the front of
            its recovery. The <em>rain</em> over that stretch against its own long-term average, divided by how the
            season is going so this year&apos;s weather is not counted twice. And <em>vigour</em>: a hard-grazed plant
            grows slower once it does start, taken from the USDA&apos;s 2006 grazing synthesis, where sites grazed over
            50&nbsp;% produced 58&nbsp;% of what ungrazed ones produced.
          </p>
          <p className="mt-2">
            Every paddock is worked out as though the mob turned in on the date at the top, so set that to when you
            would actually be in the one you are reading. Each strip is then costed on its own dates, so a pass that
            starts in May and ends in August gets most of its regrowth off the strips grazed first. Taking a paddock harder shows up as <em>less</em> grass grown back
            but slightly more second-pass feed, because a bigger share of a smaller crop is still more pounds — the
            price of a hard take is the grass left standing and the year after, and nothing here models next year. Bai
            and colleagues, working in Saskatchewan&apos;s northern mixed prairie, suggest a single May or June
            defoliation warrants a year of rest. Treat the second pass as the most uncertain figure on this page: it is
            a prediction, where everything above it is a measurement scaled by a published table.
          </p>
        </HelpNote>
      </div>
    </section>
  )
}

/** The whole fences a paddock holds; amber when it has not got the grass for one. */
function Rotations({ p }: { p: FencePaddockPlan }) {
  if (p.rotations > 0) return <span className="tabular-nums font-medium">{n0(p.rotations)}</span>
  return (
    <span className="tabular-nums text-amber-700" title="This paddock has less grass than one rotation needs — shorten the days, or split the mob.">
      0
    </span>
  )
}

/** The extra days the regrowth buys, or a dash when the year has nothing left to give. */
function SecondPassDays({ sp }: { sp: SecondPass | undefined }) {
  if (!sp || sp.days < 0.5) {
    return (
      <span className="text-gray-300" title="Nothing grows back before the fence is round again: the season has finished growing, or the paddock holds no whole rotation.">
        —
      </span>
    )
  }
  return (
    <span className="font-medium tabular-nums text-emerald-700" title={`Back on strip one ${sp.backOn}, after ${sp.restDays} days' rest`}>
      +{n0(sp.days)} d
    </span>
  )
}

/**
 * Where the strip lands. The acres a fence needs are an average over the
 * paddock, and a paddock with a pivot inside the fence is nothing like an
 * average: at 300 lb/ac of native grass against 1,000 off corn stubble, the
 * same three days of feed is a third of the acres. Both figures, so the fence
 * can be set to what it is crossing.
 *
 * No rotations column here, deliberately: each surface's whole fences are
 * floored on its own, so a paddock showing 4 broke down as 2 and 1 and read
 * like an error. Acres and days both add to the paddock's own line, which is
 * what a breakdown is for.
 */
function FenceSplit({ p, sp }: { p: FencePaddockPlan; sp: SecondPass | undefined }) {
  return (
    <div className="max-w-2xl space-y-2">
      {p.surfaces.length > 1 && (
      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-gray-400">
            <th className="py-1 pr-2 text-left font-medium">Where the fence lands</th>
            <th className="px-2 py-1 text-right font-medium">Acres</th>
            <th className="px-2 py-1 text-right font-medium">Feed lb/ac</th>
            <th className="px-2 py-1 text-right font-medium">Acres per rotation</th>
            <th className="px-2 py-1 text-right font-medium">Days</th>
          </tr>
        </thead>
        <tbody>
          {p.surfaces.map((s) => (
            <tr key={s.label} className="border-t border-gray-200">
              <td className="py-1 pr-2 font-medium text-gray-700">{s.label}</td>
              <td className="px-2 py-1 text-right tabular-nums">{n0(s.acres)}</td>
              <td className="px-2 py-1 text-right tabular-nums">{n0(s.lbPerAc)}</td>
              <td className="px-2 py-1 text-right tabular-nums">{ac(s.acresPerRotation)}</td>
              <td className="px-2 py-1 text-right tabular-nums">{n0(s.days)}</td>
            </tr>
          ))}
          <tr className="border-t border-gray-300 font-semibold text-gray-700">
            <td className="py-1 pr-2">This paddock</td>
            <td className="px-2 py-1 text-right tabular-nums">{n0(p.grazeableAc)}</td>
            <td className="px-2 py-1 text-right tabular-nums">{n0(p.lbPerAc)}</td>
            <td className="px-2 py-1 text-right tabular-nums">{ac(p.acresPerRotation)}</td>
            <td className="px-2 py-1 text-right tabular-nums">{n0(p.totalDays)}</td>
          </tr>
        </tbody>
      </table>
      )}
      {p.headPerAcre > 0 && (
        <p className="text-[11px] text-gray-400">
          {n1(p.headPerAcre)} head an acre behind the fence ({n1(p.auPerAcre)} AU an acre).
        </p>
      )}
      {sp && <SecondPassDetail p={p} sp={sp} />}
    </div>
  )
}

/** The ranch's utilization rate, the Grazing tab's default where none is set. */
function utilizationOf(ranch: Ranch) {
  return ranch.grazing_utilization_rate ?? DEFAULT_UTILIZATION
}

/**
 * What the fence finds when it gets back to strip one.
 *
 * Strip by strip would be a table of thirty rows for one paddock, so this is
 * the pass as a whole: when it comes round, what a strip grew back, and the
 * first and last strip to show how much the calendar matters within one pass.
 */
function SecondPassDetail({ p, sp }: { p: FencePaddockPlan; sp: SecondPass }) {
  if (sp.strips.length === 0) {
    return <p className="text-[11px] text-gray-400">No whole rotation here, so there is no second pass to work out.</p>
  }
  const first = sp.strips[0]
  const last = sp.strips[sp.strips.length - 1]
  return (
    <div className="rounded-md bg-white/70 p-2 ring-1 ring-gray-200">
      <p className="text-[11px] font-medium text-gray-700">
        Second pass — the fence is back on strip one {fmtDay(sp.backOn)}, after {sp.restDays} days
      </p>
      <table className="mt-1 w-full text-[11px]">
        <thead>
          <tr className="text-gray-400">
            <th className="py-1 pr-2 text-left font-medium">Strip</th>
            <th className="px-2 py-1 text-right font-medium">Grazed</th>
            <th className="px-2 py-1 text-right font-medium">Back on</th>
            <th className="px-2 py-1 text-right font-medium">Grown back lb/ac</th>
          </tr>
        </thead>
        <tbody>
          {[
            { k: 'first', label: 'First strip', s: first },
            ...(sp.strips.length > 1 ? [{ k: 'last', label: `Last strip (${sp.strips.length})`, s: last }] : []),
          ].map((r) => (
            <tr key={r.k} className="border-t border-gray-200">
              <td className="py-1 pr-2 font-medium text-gray-700">{r.label}</td>
              <td className="px-2 py-1 text-right tabular-nums">{fmtDay(r.s.grazedOn)}</td>
              <td className="px-2 py-1 text-right tabular-nums">{fmtDay(r.s.backOn)}</td>
              <td className="px-2 py-1 text-right tabular-nums">
                {p.acresPerRotation > 0 ? n0(r.s.lb / p.acresPerRotation) : '—'}
              </td>
            </tr>
          ))}
          <tr className="border-t border-gray-300 font-semibold text-gray-700">
            <td className="py-1 pr-2">Across the {sp.strips.length} fences</td>
            <td />
            <td />
            <td className="px-2 py-1 text-right tabular-nums">{n0(sp.grossLbPerAc)}</td>
          </tr>
        </tbody>
      </table>
      <p className="mt-1 text-[11px] text-gray-500">
        {n0(sp.grossLb)} lb grown back over {n0(sp.coveredAc)} ac, {n0(sp.lb)} lb of it taken at the utilization rate —{' '}
        <span className="font-medium text-emerald-700">{n1(sp.days)} more days</span> for the mobs.
      </p>
    </div>
  )
}

/** A date as people say it: "9 Aug". */
function fmtDay(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })
}
