import { Fragment, Suspense, useEffect, useMemo, useState } from 'react'
import { lazyWithRetry } from '@/lib/lazyWithRetry'
import { ChevronRight, CloudRain, Plus } from 'lucide-react'
import { Select } from '@/components/Select'
import {
  computeHerds,
  computePastures,
  grassBalance,
  grazingRain,
  grazingUtilization,
  GRASS_QUALITIES,
  type PastureCalc,
  type HerdCalc,
  useGrazingHerd,
  useGrazingPastures,
  useHerdMutations,
  usePastureFieldContext,
  usePastureMutations,
  useMeasuredYields,
  usePastureSeasonFactors,
  useRanchPrecip,
} from '@/lib/grazing'
import { PastureFeedBreakdown } from './PastureFields'
import { DeleteButton, EditButton, RecordEditModal, rowClick } from '@/components/RecordEditor'
import { GrassQuality } from './GrassQuality'
import { useSetRanch, type Ranch } from '@/lib/ranches'
import { useFeedPlan } from '@/lib/feed'
import { auFor, auFromWeight } from '@/lib/animal-units'
import {
  ACRES_PER_HECTARE,
  AU_INTAKE_LB_PER_DAY,
  AU_TOTAL_LB_PER_DAY,
  AU_WASTE_LB_PER_DAY,
  forageYieldPerAcre,
  ratedAnchors,
} from '@/lib/forage-yield'
import { useActivations } from '@/lib/eshepherd'
import { forageCalibration, grazedSeasons, mobUnits } from '@/lib/grazed-yield'
import { LB_PER_KG } from '@/lib/bushels'
import { RAIN_NORMAL_YEARS } from '@/lib/rain-normals'
import { GAUGE_GAP_FLAG, gaugeGap, useRanchGauge } from '@/lib/ranch-gauge'
import { shortDay } from '@/lib/field-residue'
import type { Database } from '@/lib/database.types'
import { cn } from '@/lib/utils'
import { HelpNote } from '@/components/HelpNote'
import { InfoPopover } from '@/components/InfoPopover'
import { essrTotals, usePastureEssr } from '@/lib/range-sites'
import { FeedInfo } from './feed/FeedInfo'
import { FromHerdChip } from './feed/bits'
import { n0, n1 } from '@/lib/format'
import { TABLE_HEAD } from '@/lib/table-style'
import { CardList, Dot, RowCard, SummaryLine } from '@/components/RowCards'
import { DEFAULT_UTILIZATION } from '@/lib/forage-response'

type PasturePatch = Database['public']['Tables']['grazing_pastures']['Update']
type HerdPatch = Database['public']['Tables']['herd_counts']['Update']

// Lazy so recharts only loads when the Grazing tab is opened.
const RainGraph = lazyWithRetry(() => import('./RainGraph').then((m) => ({ default: m.RainGraph })))

const DETAIL_KEY = 'grazing_pasture_detail'

/**
 * Pounds over kilograms, in one cell.
 *
 * The forage tables, the AUM and everything else on this page are in pounds,
 * so pounds stay the figure you read; the kilograms under them are for the
 * feed tests and ration sheets that come back in metric. Two columns of the
 * same number in different units would have been four columns of feed.
 */
function Lb({ lb, bold = false }: { lb: number; bold?: boolean }) {
  return (
    <>
      <span className={cn('tabular-nums', bold && 'font-medium')}>{n0(lb)}</span>
      <span className="block text-[11px] tabular-nums text-gray-400">{n0(lb / LB_PER_KG)} kg</span>
    </>
  )
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']


/**
 * A class's turnout or coming-off, as a month and a day with no year.
 *
 * The herd goes out and comes home on the same days every year, so the year
 * was only ever something to retype each spring. It is still kept on a date
 * column — every reader maps the month and day onto the year it is asking
 * about — so the year written here is simply this one, and nothing reads it.
 */
function GrazeDay({
  value,
  which,
  disabled,
  onChange,
}: {
  value: string | null
  which: string
  disabled?: boolean
  onChange: (v: string | null) => void
}) {
  const month = value ? Number(value.slice(5, 7)) : null
  const day = value ? Number(value.slice(8, 10)) : null
  const set = (m: number | null, d: number | null) => {
    if (m == null || d == null) {
      if (value != null) onChange(null)
      return
    }
    const year = new Date().getFullYear()
    // Day 0 of the next month is the last of this one, so 31 Feb lands on the 28th
    // rather than being refused by the date column.
    const last = new Date(Date.UTC(year, m, 0)).getUTCDate()
    const iso = `${year}-${String(m).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`
    if (iso !== value) onChange(iso)
  }
  return (
    /*
     * shrink-0 and nowrap so a date never breaks between its month and its
     * day. The two boxes are narrower under sm because the pair plus the word
     * between them came to 323 px inside a 317 px card — six pixels over, so
     * "to" wrapped and hung off the end of the first line. At w-20 and w-12
     * the line needs 291 and has 26 px in hand, which survives a longer month
     * and a scrollbar. The table from sm up keeps the original widths.
     */
    <div className="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
      <Select
        value={month == null ? '' : String(month)}
        size="sm"
        disabled={disabled}
        ariaLabel={`${which} month`}
        className="w-20 sm:w-[5.5rem]"
        onChange={(v) => set(v === '' ? null : Number(v), v === '' ? null : (day ?? 1))}
        /*
         * The empty label is a dash, not "Month". A chosen month is three
         * letters and fits w-20 easily; the word "Month" needs 88 px with its
         * chevron and clipped to "Mo..." on the calves' row, which has no
         * dates. Widening the box back to 88 would put the line 10 px from
         * wrapping again, and the box beside it already says Day.
         */
        options={[{ value: '', label: '—' }, ...MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))]}
      />
      <input
        type="number"
        min={1}
        max={31}
        placeholder="Day"
        disabled={disabled}
        defaultValue={day ?? ''}
        key={`${month}-${day}`}
        aria-label={`${which} day`}
        onBlur={(e) => set(month, e.target.value === '' ? null : Math.min(31, Math.max(1, Math.round(Number(e.target.value)))))}
        className="w-12 rounded-md border border-gray-300 px-2 py-1 text-right text-sm tabular-nums disabled:bg-gray-50 sm:w-14"
      />
    </div>
  )
}

/** Under a class's dates: the season it is counted over when it has none, or that its calves are in the cows' row. */
function SeasonNote({ h }: { h: HerdCalc }) {
  if (h.withCows) return <p className="mt-0.5 text-[11px] text-gray-400">at side — in the cows&apos; row</p>
  if (!h.assumedSeason || !h.start || !h.end) return null
  return (
    <p className="mt-0.5 text-[11px] text-gray-400" title="No grazing dates typed, so counted over the ranch's grazing season. Type dates to change it.">
      assumed season {shortDay(h.start)} – {shortDay(h.end)}
    </p>
  )
}

/** Inline numeric cell that persists on blur (mirrors the Irrigation Setup pattern). */
function NumCell({
  value,
  disabled,
  step = '1',
  onCommit,
  className,
}: {
  value: number | null
  disabled: boolean
  step?: string
  onCommit: (v: number) => void
  className?: string
}) {
  /*
   * Typed text while the box has focus, the prop's value otherwise.
   *
   * It was defaultValue, which reads the prop once and never again -- so
   * switching ranch left the other ranch's figure sitting in the box while
   * everything round it updated, and a blur would then have written that
   * figure onto the ranch you had just switched to. The sync has to happen in
   * render rather than an effect, or the box shows the wrong number for a
   * frame and a fast blur still commits it.
   */
  const [typed, setTyped] = useState({ text: String(value ?? 0), from: value })
  if (typed.from !== value) setTyped({ text: String(value ?? 0), from: value })
  return (
    <input
      type="number"
      step={step}
      disabled={disabled}
      value={typed.text}
      onChange={(e) => setTyped({ text: e.target.value, from: value })}
      onBlur={(e) => {
        const v = e.target.value === '' ? 0 : Number(e.target.value)
        if (v !== value) onCommit(v)
      }}
      className={cn(
        'w-16 rounded-md border border-gray-200 px-1.5 py-1 text-right text-sm tabular-nums disabled:border-transparent disabled:bg-transparent disabled:opacity-70',
        className,
      )}
    />
  )
}

/** What one ranch contributes to a whole-operation total. */
export type GrazingTotals = {
  ranchId: string
  acres: number
  grazeable: number
  auds: number
  audsRequired: number
  surplus: number
}

/**
 * One ranch's grazing figures, worked out without drawing anything.
 *
 * Split out of the calculator so a total can be had WITHOUT the calculator:
 * the All-ranches tab adds the ranches up and shows nothing per ranch, because
 * each ranch already has its own tab (Sam, 11 Nov 2026). It mounts a
 * `GrazingRanchTotals` per ranch instead, which is this hook and no markup.
 *
 * The OUTPUTS are what get aggregated, never the inputs. Each ranch has its
 * own rainfall and its own utilisation rate, so pooling acres and applying one
 * ranch's precipitation would produce a carrying capacity for a place that
 * does not exist. Computing each with its own settings and adding the results
 * is the only sum that means anything.
 */
function useGrazingCalc(ranch: Ranch) {
  const ranchId = ranch.id
  const { data: pastures } = useGrazingPastures(ranchId)
  const { data: herd } = useGrazingHerd(ranchId)
  const { data: measured, isLoading: precipLoading, isError: precipError } = useRanchPrecip(ranch)

  const setRate = ranch.grazing_utilization_rate ?? DEFAULT_UTILIZATION
  /*
   * The plan is THIS season, not an average one.
   *
   * It used to be the long-term normal, with this year's rain shown beside it as
   * a number that changed nothing. In 2026 that gap was the whole story: 379 mm
   * fell against a 270 mm normal and the plan went on reporting the grass an
   * ordinary year would have grown, which is most of why the Grazing tab read a
   * 54,631 AUD deficit on a ranch that was visibly carrying its herd.
   *
   * `projectedMm` is the rain so far plus a normal rest of season, so in May it
   * is mostly the average and by September it is almost entirely measurement.
   * The normal is still shown, as the comparison it always was.
   */
  // Memoised so the object identity is stable: grazingRain builds a fresh
  // one every call, and the costing memos below take it whole.
  const rain = useMemo(() => grazingRain(ranch, measured), [ranch, measured])
  const precip = rain.projectedMm ?? rain.forecastMm
  /*
   * Take less in a dry year. Grazing a drought-stressed plant to the usual
   * mark leaves it without the leaf to rebuild its roots and the pasture comes
   * back worse NEXT year however that year rains, so the rate slides down as
   * the season factor falls below 0.8. It never slides up: taking more in a
   * good year is a decision for a person. See droughtUtilization.
   */
  const utilization = grazingUtilization(setRate, rain)
  const droughtCut = utilization < setRate - 0.001
  /*
   * Whether a grazing day draws the grass the herd tramples, beds on and fouls
   * as well as the grass it eats: Alberta's 455 kg animal-unit month (33.3 lb a
   * day) against the Forage Manual's 780 lb one (26 lb). A fifth of the
   * grazing days hang on it. Nothing to do with the utilization rate above —
   * that is how much of the stand the herd may take, this is how much of what
   * it took actually leaves the paddock.
   */
  const countWaste = ranch.grazing_count_waste ?? true

  // Crop fields inside the fences, from the farming side: grass all season,
  // stubble only once harvested and not worked (field-residue.ts).
  const fieldCtx = usePastureFieldContext(ranchId, herd)
  const seasonCtx = useMemo(() => fieldCtx.ctx(), [fieldCtx])
  /*
   * Where the satellite has watched a paddock grow and no cattle have been on
   * it this year, its own measured growth beats the rain gauge: a paddock that
   * caught a storm the gauge missed shows it, and so does one that did not.
   * Those paddocks are costed on the zone times their measured factor — the
   * factor already IS this year, and applying the rain ratio as well would
   * count the same weather twice.
   */
  const { data: factors } = usePastureSeasonFactors(ranchId)
  const factorFor = useMemo(() => {
    const m = new Map<string, number>()
    for (const f of factors ?? []) if (f.factor != null) m.set(f.grazing_pasture_id, f.factor)
    return m
  }, [factors])
  // A pasture someone has cut and weighed is read off its own grass.
  const { data: clipped } = useMeasuredYields()
  /*
   * And where nobody has, the table is checked against what the cattle
   * actually took off this ranch, and lifted to meet it if it falls short.
   *
   * The grass rating keeps the job it is good at -- which paddock is better
   * than which -- and the grazing record supplies the part a relative rating
   * never could, which is the absolute level. See grazed-yield.ts for why the
   * table reads low here and why this can only ever raise it.
   */
  const { data: activations } = useActivations()
  const mine = useMemo(() => new Set((pastures ?? []).map((p) => p.pasture_id).filter(Boolean) as string[]), [pastures])
  const units = useMemo(() => mobUnits(herd ?? [], auFor), [herd])
  const seasons = useMemo(
    () => grazedSeasons((activations ?? []).filter((a) => a.pasture_id && mine.has(a.pasture_id)), units),
    [activations, mine, units],
  )
  /*
   * What a MEDIAN paddock here grows in an ordinary year, lb/acre, BEFORE the
   * grazing record has its say: the ranch's own figure where somebody has set
   * one, otherwise the estimator's Fair row at its zone.
   */
  const setBaseLbAc = ranch.forage_base_lb_ac ?? forageYieldPerAcre(rain.zoneMm, 'Fair')
  const baseIsOwn = ranch.forage_base_lb_ac != null
  /*
   * A level read from orbit and a level somebody typed should not look the
   * same on the card. East Ranch's came from its canopy cover against Grassy
   * Lake's median paddock, because a one-paddock ranch's own rel is 1.000 by
   * construction and the satellite can only reach it through the level.
   */
  const baseFromOrbit = baseIsOwn && ranch.forage_base_source === 'satellite'
  /* Each paddock read at that level, for the comparison below only. */
  const baseAnchors = useMemo(
    () => ratedAnchors(pastures ?? [], setBaseLbAc, clipped, 'rated'),
    [pastures, setBaseLbAc, clipped],
  )
  /*
   * The model's own answer for an ordinary year, before any lift: the thing
   * the grazing record is measured against.
   *
   * It has to be measured against the LEVEL, not against the table. Sam's
   * 780 lb/ac for Home Ranch was itself read partly off these same collars;
   * measuring the record against the table instead would find the same
   * shortfall a second time and multiply his number by it.
   */
  const baseNormalAuds = useMemo(
    () =>
      computePastures(pastures ?? [], { ...rain, rainFactor: 1 }, setRate, seasonCtx, null, baseAnchors, countWaste)
        .reduce((a, p) => a + p.auds, 0),
    [pastures, rain, setRate, seasonCtx, baseAnchors, countWaste],
  )
  const calibration = useMemo(
    // Only this season's rain factor is known; an older season is read as an
    // ordinary one, which errs toward leaving the table alone.
    () => forageCalibration(seasons, baseNormalAuds, (s) => (s === new Date().getFullYear() ? rain.rainFactor : 1)),
    [seasons, baseNormalAuds, rain.rainFactor],
  )
  /*
   * The level the app actually reads with, once the grazing record has had
   * its say. The record is a FLOOR and nothing more: forageCalibration never
   * returns under 1, so a level that already covers what the cattle took is
   * left exactly where it was set, and only a level the cattle have beaten
   * gets lifted to meet them.
   */
  const baseLbAc = setBaseLbAc * calibration.factor
  /*
   * Each paddock, best evidence first: its own clip-and-weigh, then this
   * ranch's level times the paddock's own measured cover, then the table.
   *
   * The middle rung is the fix for a rating that was being read as something
   * it never was. grass_quality_rel is a paddock against its own ranch's
   * MEDIAN paddock, so handing it to a table of absolute pounds threw the
   * ranch's level away; here it only decides the spread. It also ends the
   * four-word bucketing: Pasture K at 0.79 of the median is read at 0.79,
   * not rounded down to "Poor" and 19% under its own measurement.
   */
  const anchors = useMemo(() => {
    const lifted = calibration.factor > 1.001
    const m = ratedAnchors(pastures ?? [], baseLbAc, clipped, lifted ? 'grazed' : 'rated')
    if (!lifted) return m
    // A paddock with no satellite cover has no rel to scale, so where the
    // record has lifted the ranch it gets the table lifted by the same hand.
    for (const p of pastures ?? []) {
      if (m.has(p.id)) continue
      m.set(p.id, {
        lbPerAcre: forageYieldPerAcre(rain.zoneMm, p.grass_quality) * calibration.factor,
        source: 'grazed',
      })
    }
    return m
  }, [clipped, pastures, rain.zoneMm, baseLbAc, calibration.factor])
  /*
   * And what the SOIL sustains, which is a third opinion on the same ground
   * (range-sites.ts).
   *
   * The two above are both measurements of this ranch: a clip-and-weigh, or
   * what the cattle actually took. This one is not a measurement at all -- it
   * is Alberta's published rate for the kind of ground each paddock sits on,
   * and it is a long-run SUSTAINABLE rate rather than a capacity. So it never
   * feeds the calculation; it sits beside it. Where the grazing record lifts
   * the table above this line, that is worth seeing rather than reconciling:
   * a wet year can carry more than the ground sustains every year.
   *
   * A paddock with no boundary drawn has no soil to read and simply has none.
   */
  const { data: essrByPaddock } = usePastureEssr(ranchId)
  const essr = useMemo(() => essrTotals(essrByPaddock), [essrByPaddock])
  const calc = useMemo(
    () => computePastures(pastures ?? [], rain, utilization, seasonCtx, factorFor, anchors, countWaste),
    [pastures, rain, utilization, seasonCtx, factorFor, anchors, countWaste],
  )
  const measuredYieldCount = useMemo(
    () => (pastures ?? []).filter((p) => clipped?.has(p.id)).length,
    [pastures, clipped],
  )
  // The same pastures in an ordinary year: the same zone, with the season's
  // multiplier set to 1. So the difference this year made is a number beside
  // the plan rather than something only the plan knows.
  const normalAuds = useMemo(
    () =>
      computePastures(pastures ?? [], { ...rain, rainFactor: 1 }, setRate, seasonCtx, null, anchors, countWaste)
        .reduce((a, p) => a + p.auds, 0),
    [pastures, rain, setRate, seasonCtx, anchors, countWaste],
  )
  /*
   * The same pastures, this year's weather, but the rate Sam set rather
   * than the dry-year one. It exists so the two things that moved the number
   * can be shown apart: the weather is not a decision and the grazing rate
   * is, and a single combined figure labelled "from this year's rain" was
   * telling the truth about neither.
   */
  const rainAuds = useMemo(
    () =>
      computePastures(pastures ?? [], rain, setRate, seasonCtx, factorFor, anchors, countWaste)
        .reduce((a, p) => a + p.auds, 0),
    [pastures, rain, setRate, seasonCtx, factorFor, anchors, countWaste],
  )
  const measuredCount = useMemo(
    () => (pastures ?? []).filter((p) => factorFor.has(p.id)).length,
    [pastures, factorFor],
  )
  // Cows carry their calves at side until weaning (calving from the feed plan).
  const { data: feedPlan } = useFeedPlan(ranchId)
  const herdCalc = useMemo(
    () => computeHerds(herd ?? [], feedPlan ? { month: feedPlan.calving_month, day: feedPlan.calving_day } : null, ranch.weaning_date),
    [herd, feedPlan, ranch.weaning_date],
  )

  const totals = useMemo(
    () =>
      calc.reduce(
        (a, p) => ({
          acres: a.acres + p.acres,
          grazeable: a.grazeable + p.totalGrazeableAc,
          lbs: a.lbs + p.totalLbs,
          aums: a.aums + p.aums,
          auds: a.auds + p.auds,
          fieldAuds: a.fieldAuds + p.fieldAuds,
        }),
        { acres: 0, grazeable: 0, lbs: 0, aums: 0, auds: 0, fieldAuds: 0 },
      ),
    [calc],
  )
  // The same sum the Herd page's "the grass carries about N cows" is read from.
  const balance = useMemo(() => grassBalance(totals.auds, herdCalc), [totals.auds, herdCalc])
  const audsRequired = balance.need
  const surplus = balance.surplus
  const cowsOnGrass = herdCalc.filter((h) => h.feed_class === 'cow').reduce((a, h) => a + h.head_count, 0)
  const cowsOver = balance.capacityCows == null ? null : Math.round(cowsOnGrass - balance.capacityCows)

  const ranchTotals = useMemo<GrazingTotals>(
    () => ({
      ranchId,
      acres: totals.acres,
      grazeable: totals.grazeable,
      auds: totals.auds,
      audsRequired,
      surplus,
    }),
    [ranchId, totals, audsRequired, surplus],
  )

  return {
    pastures,
    measured,
    precipLoading,
    precipError,
    utilization,
    setRate,
    droughtCut,
    countWaste,
    essr,
    essrByPaddock,
    rain,
    precip,
    calc,
    normalAuds,
    rainAuds,
    calibration,
    baseLbAc,
    setBaseLbAc,
    baseIsOwn,
    baseFromOrbit,
    // Which paddocks are scaled by their own satellite growth rather than by
    // the ranch's rain: the grass-rating panel says which figure it is reading.
    factorFor,
    measuredCount,
    measuredYieldCount,
    herdCalc,
    totals,
    audsRequired,
    surplus,
    cowsOver,
    ranchTotals,
  }
}

/**
 * A ranch's figures reported upward, with nothing drawn.
 *
 * One of these per ranch is how the All-ranches total is added up now that the
 * per-ranch calculators are no longer shown there. It is a component rather
 * than a loop over `useGrazingCalc` because a hook cannot be called once per
 * item of a list.
 */
export function GrazingRanchTotals({
  ranch,
  onTotals,
}: {
  ranch: Ranch
  onTotals: (t: GrazingTotals) => void
}) {
  const { ranchTotals } = useGrazingCalc(ranch)
  useEffect(() => {
    onTotals(ranchTotals)
  }, [onTotals, ranchTotals])
  return null
}

const WASTE_PILL = 'rounded px-1.5 py-0.5 text-[11px] font-medium transition-colors disabled:cursor-default'

/**
 * Which pound figure the AUDs are counted in: what the herd eats, or that plus
 * what it tramples and fouls.
 *
 * Both are standard and they are 22% apart, so the figure above means nothing
 * without saying which one it is — hence a control beside the number rather
 * than a setting on another page. Sam asked for the split on 12 Nov 2026
 * after the two conventions turned up side by side in the app: 26 lb a day out
 * of the Alberta Forage Manual, 33.3 out of the public-lands range guides.
 *
 * The utilization card next door answers a different question and is left
 * alone — Sam sets that himself.
 */
function AuWasteToggle({
  countWaste,
  disabled,
  onChange,
}: {
  countWaste: boolean
  disabled?: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="mt-1.5 flex items-center gap-1">
      <span className="text-[11px] text-gray-400">Counting</span>
      <div className="inline-flex overflow-hidden rounded border border-gray-200">
        {([true, false] as const).map((v) => (
          <button
            key={String(v)}
            type="button"
            disabled={disabled}
            aria-pressed={countWaste === v}
            onClick={() => !disabled && countWaste !== v && onChange(v)}
            className={cn(
              WASTE_PILL,
              countWaste === v ? 'bg-brand-700 text-white' : 'text-gray-500 hover:bg-gray-100',
            )}
          >
            {v ? 'eaten + wasted' : 'eaten only'}
          </button>
        ))}
      </div>
      <InfoPopover title="What one grazing day costs a paddock" width={430}>
        <p>
          A cow eats about <b>{AU_INTAKE_LB_PER_DAY} lb</b> of dry matter a day — 2.6 % of a
          1,000 lb body weight. She also treads on, beds down on and fouls roughly{' '}
          <b>{AU_WASTE_LB_PER_DAY.toFixed(1)} lb</b> more. That grass leaves the paddock just as
          surely as the grass she swallows.
        </p>
        <p>
          <b>Eaten + wasted</b> charges a grazing day the full{' '}
          <b>{AU_TOTAL_LB_PER_DAY.toFixed(1)} lb</b>, which is Alberta&apos;s animal-unit month of
          455 kg (1,000 lb). Every stocking rate in the province&apos;s range plant community
          guides is written in it. <b>Eaten only</b> charges {AU_INTAKE_LB_PER_DAY} lb, the figure
          behind the Alberta Forage Manual&apos;s yield tables and the BCRC&apos;s carrying-capacity
          calculator.
        </p>
        <p>
          The switch moves no grass: the pounds standing out there are the same either way. It
          changes how many grazing days those pounds come to — a fifth of them, which is a paddock
          lasting 31 days against 40.
        </p>
        <p className="text-gray-500">
          The crop-field acres inside the fences are not affected. Their pounds already have
          trampling taken off upstream, so charging them again would take it twice. This is also
          not the utilization rate beside it — that is how much of the stand the herd may take
          before the plants suffer.
        </p>
      </InfoPopover>
    </div>
  )
}

/**
 * Where the sustainable rate comes from, and why it is not a verdict on this
 * year. Beside the figure it sits next to, because the two are easy to read as
 * one number disagreeing with itself.
 */
function EssrInfo({
  essr,
  thisYear,
}: {
  essr: NonNullable<ReturnType<typeof essrTotals>>
  thisYear: number
}) {
  const over = thisYear > essr.high
  return (
    <InfoPopover title="What the ground sustains" width={460}>
      <p>
        The soil map says what kind of ground each paddock is — loamy, sandy, gravel — and Alberta&apos;s
        Dry Mixedgrass range plant community guide says what that kind of ground carries: <b>{n0(essr.auds)} AUDs</b>{' '}
        across {essr.paddocks} mapped paddock{essr.paddocks === 1 ? '' : 's'}, somewhere between{' '}
        {n0(essr.low)} and {n0(essr.high)} depending which plant community each site actually carries.
      </p>
      <p>
        It is a <b>sustainable</b> rate, not this year&apos;s capacity: a quarter to half the herbage
        taken and the rest left as litter and root reserve, year after year, without the stand going
        backwards. A wet season grows more and carries more, so the figure above being higher is not
        a contradiction{over ? ' — and this year it is higher' : ''}.
      </p>
      <p>
        Utilization is already inside it, so it is not reduced again by the rate beside it. Its animal
        unit is Alberta&apos;s 455 kg month, which is the &ldquo;eaten + wasted&rdquo; setting — on
        &ldquo;eaten only&rdquo; the two are a fifth apart and not like for like.
      </p>
      {essr.ratedShare < 0.995 && (
        <p className="text-gray-500">
          {Math.round(essr.ratedShare * 100)} % of the mapped acres carry a published rate. The rest sit
          on range sites the guide lists no plant community for, so they are left unrated rather than
          counted as nothing. A paddock with no boundary drawn has no soil to read at all.
        </p>
      )}
      <p className="text-gray-500">
        Adams 2005, from 1,716 vegetation plots. The chain is soil series → ecological range site →
        the communities on it → their stocking rate.
      </p>
    </InfoPopover>
  )
}

export function GrazingCalculator({ isManager, ranch }: { isManager: boolean; ranch: Ranch }) {
  const ranchId = ranch.id
  const {
    pastures,
    measured,
    precipLoading,
    precipError,
    utilization,
    setRate,
    droughtCut,
    countWaste,
    essr,
    essrByPaddock,
    rain,
    precip,
    calc,
    normalAuds,
    rainAuds,
    calibration,
    baseLbAc,
    setBaseLbAc,
    baseIsOwn,
    baseFromOrbit,
    factorFor,
    measuredCount,
    measuredYieldCount,
    herdCalc,
    totals,
    audsRequired,
    surplus,
    cowsOver,
  } = useGrazingCalc(ranch)
  /*
   * The nearest real gauge's total for the same window, shown beside the
   * gridded one the model plans on. Called here rather than in useGrazingCalc
   * so the All-ranches totals component does not fetch it for a figure it
   * never draws. See ranch-gauge.ts for why the model still runs on the grid.
   */
  const { data: gauge } = useRanchGauge(ranch, measured?.through)
  const gaugeOff = gauge ? gaugeGap(gauge.mm, rain.toDateMm) : null
  const setRanch = useSetRanch()
  const pastureM = usePastureMutations()
  const herdM = useHerdMutations()

  const addPasture = () =>
    pastureM.create.mutate({
      name: `Pasture ${(pastures?.length ?? 0) + 1}`,
      sort_order: (pastures?.at(-1)?.sort_order ?? 0) + 1,
      ranch_id: ranchId,
    })
  /**
   * Which pastures are open to their feed breakdown, and which one is being
   * edited. Several can be open at once — comparing where two paddocks' feed
   * comes from is the reason to open either. Not remembered between visits:
   * an expanded row is a question you asked today.
   */
  const [opened, setOpened] = useState<Set<string>>(() => new Set())
  const toggleOpen = (id: string) =>
    setOpened((o) => {
      const next = new Set(o)
      if (!next.delete(id)) next.add(id)
      return next
    })
  const [editing, setEditing] = useState<PastureCalc | null>(null)
  // Only a pasture with cropland inside the fence has anything to break out.
  const breakdownOf = (x: PastureCalc) => x.fieldsLinked || x.irrigated_ac > 0
  const patchH = (id: string, patch: HerdPatch) => herdM.update.mutate({ id, patch })
  const setRanchField = (patch: Database['public']['Tables']['ranches']['Update']) =>
    setRanch.mutate({ id: ranchId, patch })
  const [cfg, setCfg] = useState(false)
  // The pasture table opens on the five columns the plan is read from; the
  // area breakdown and the forage per acre are one tap away.
  const [detail, setDetail] = useState(() => {
    try {
      return localStorage.getItem(DETAIL_KEY) === '1'
    } catch {
      return false
    }
  })
  const toggleDetail = () =>
    setDetail((d) => {
      try {
        localStorage.setItem(DETAIL_KEY, d ? '0' : '1')
      } catch {
        // Blocked storage: the toggle still works, it just forgets.
      }
      return !d
    })
  const throughLabel = measured
    ? new Date(measured.through + 'T00:00:00').toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })
    : null

  return (
    <div className="space-y-5">
      {/* Parameters + headline balance */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-gray-200 bg-white p-3">
          <div className="flex items-center justify-between">
            <p className="flex items-center gap-1 text-xs text-gray-500">
              <CloudRain className="h-3.5 w-3.5" /> Season rain forecast
            </p>
            {isManager && (
              <button
                onClick={() => setRanchField({ precip_auto: !ranch.precip_auto })}
                className={cn(
                  'rounded border px-1.5 py-0.5 text-[10px] font-semibold',
                  ranch.precip_auto
                    ? 'border-sky-200 bg-sky-50 text-sky-700'
                    : 'border-gray-200 text-gray-500 hover:bg-gray-50',
                )}
                title="Toggle between measured rainfall and a manual value"
              >
                {ranch.precip_auto ? 'Auto' : 'Manual'}
              </button>
            )}
          </div>
          {ranch.precip_auto ? (
            <>
              <div className="mt-1 flex items-baseline gap-1">
                <span className="text-lg font-bold tabular-nums text-gray-900">
                  {precipLoading ? '…' : n0(precip)}
                </span>
                <span className="text-sm text-gray-400">mm</span>
              </div>
              <p className="mt-0.5 text-[11px] text-gray-400">
                {precipError
                  ? 'rain data down — using manual'
                  : rain.projectedMm != null
                    ? (
                        <span title={`This year's ${n0(rain.toDateMm!)} mm to ${throughLabel} plus a normal rest of season. The ${measured!.normal!.years.length}-year average is ${n0(rain.forecastMm)} mm.`}>
                          this season
                        </span>
                      )
                    : rain.forecastSource === 'normal'
                      ? (
                          <span title={`${RAIN_NORMAL_YEARS}-year average of ${measured!.normal!.years.map((y) => y.year).join(', ')}`}>
                            {measured!.normal!.years.length}-yr avg
                          </span>
                        )
                      : measured
                        ? `no ${RAIN_NORMAL_YEARS}-year average — using manual`
                        : ranch.latitude == null || ranch.longitude == null
                          ? 'add the ranch’s location to measure rain — using manual'
                          : 'loading rainfall…'}
              </p>
              {rain.toDateMm != null && (
                <p
                  className={cn(
                    'mt-0.5 text-[11px]',
                    rain.pctOfNormal != null && rain.pctOfNormal < ranch.move_dry_pct
                      ? 'font-medium text-amber-700'
                      : 'text-gray-500',
                  )}
                  title={`This year's rain since the season started, against the ${RAIN_NORMAL_YEARS}-year average to the same day.`}
                >
                  {n0(rain.toDateMm)} mm to {throughLabel}
                  {rain.pctOfNormal != null && ` · ${rain.pctOfNormal}% of normal`}
                </p>
              )}
              {/*
               * The nearest real gauge, beside the gridded figure above it.
               *
               * It drives nothing — the model needs one instrument on both
               * halves of its ratio, and only the grid has thirty years
               * (ranch-gauge.ts). What the gauge adds is where the rain
               * actually fell, which a grid cell averages away: in 2026 the
               * three gauges here spread 93 mm while the grid put the same
               * points within 12 mm. So it goes amber when the two part
               * company, because that is the case worth a second look.
               */}
              {gauge && (
                <p
                  className={cn(
                    'mt-0.5 text-[11px]',
                    gaugeOff != null && Math.abs(gaugeOff) >= GAUGE_GAP_FLAG
                      ? 'font-medium text-amber-700'
                      : 'text-gray-500',
                  )}
                  title={
                    `${gauge.station}, the nearest gauge, ${gauge.km} km from the ranch: ${n0(gauge.mm)} mm over the same ${gauge.days} days.` +
                    (gaugeOff != null && Math.abs(gaugeOff) >= GAUGE_GAP_FLAG
                      ? ` That is ${Math.abs(Math.round(gaugeOff * 100))}% ${gaugeOff < 0 ? 'less' : 'more'} than the ${n0(rain.toDateMm ?? 0)} mm the forage figures use, which is enough to matter. The model plans on the gridded figure because its ${RAIN_NORMAL_YEARS}-year normal comes from the same source and a ratio needs both halves off one instrument — but a gauge this far out is worth a look before you stock on it.`
                      : ' It agrees with the gridded figure the forage numbers use, so there is nothing to reconcile.')
                  }
                >
                  gauge {n0(gauge.mm)} mm
                  {gaugeOff != null && Math.abs(gaugeOff) >= GAUGE_GAP_FLAG &&
                    ` · ${Math.abs(Math.round(gaugeOff * 100))}% ${gaugeOff < 0 ? 'under' : 'over'}`}
                  {' · '}
                  {gauge.station}, {gauge.km} km
                </p>
              )}
              {/* What the forage table is actually read at: the zone picks the
                  row, this season scales what the row yields. The zone is a
                  classification of the ranch, so it is editable here rather
                  than measured — see the ZoneHelp note under the table. */}
              <p
                className="mt-0.5 flex items-center gap-1 text-[11px] text-gray-500"
                title={
                  rain.zoneSource === 'soil'
                    ? `The forage row is read at ${n0(rain.zoneMm)} mm, the ranch's annual precipitation zone. The manual reads that row off the soil climatic zone — 300 mm Brown, 400 mm Dark Brown — but the soil here remembers a drier climate than the ground produces in, so both ranches are classified on measured rainfall instead. This season is worth ${Math.round(rain.rainFactor * 100)}% of a normal one's grass${rain.rainWeighted ? ', weighted by the month the rain fell in' : ''} — not the same thing as its rain, because the first 100 mm grows nothing and a wet year runs into a nitrogen ceiling.`
                    : `No zone set for this ranch, so the forage row is read at ${n0(rain.zoneMm)} mm from measured rainfall. Set the zone from the soil climatic zone instead.`
                }
              >
                <span>forage zone</span>
                <NumCell
                  value={rain.zoneMm}
                  disabled={!isManager}
                  onCommit={(v) => setRanchField({ forage_zone_mm: v > 0 ? v : null })}
                  className="w-12 text-[11px]"
                />
                <span>mm · season ×{rain.rainFactor.toFixed(2)}</span>
              </p>
              {/* The ranch's own yield level, which the grass rating cannot
                  set: the rating is a paddock against this ranch's median
                  paddock, so its median is 1.00 whatever the ranch grows. */}
              <p
                className="mt-0.5 flex items-center gap-1 text-[11px] text-gray-500"
                title={
                  `What a middling paddock here grows in an ordinary year. Each paddock is then read at this times its own measured cover against the ranch's median — Pasture K at 0.79 of the median is read at 0.79 of this, rather than rounded down to a word.` +
                  (baseFromOrbit
                    ? ' Measured from orbit: this ranch’s canopy cover against a ranch whose level was set by hand. Type over it and it becomes yours.'
                    : baseIsOwn
                      ? ' Set by hand for this ranch.'
                      : ` Not set, so this is the estimator's Fair row at ${n0(rain.zoneMm)} mm — a provincial average, and the one figure in the model that nothing on this farm has measured.`) +
                  (calibration.factor > 1.001
                    ? ` Your cattle took more off these paddocks than that allows, so it is read at ${n0(baseLbAc)} — the grazing record is a floor and can only raise it.`
                    : '')
                }
              >
                <span>median paddock</span>
                {/* The figure SET, never the lifted one: typing in a box that
                    showed the lift would save the lift and then lift it again. */}
                <NumCell
                  value={Math.round(setBaseLbAc)}
                  disabled={!isManager}
                  onCommit={(v) => setRanchField({ forage_base_lb_ac: v > 0 ? v : null, forage_base_source: 'manual' })}
                  className="w-14 text-[11px]"
                />
                <span>
                  lb/ac
                  {calibration.factor > 1.001
                    ? ` · ${n0(baseLbAc)} from the grazing record`
                    : baseFromOrbit
                      ? ' · from orbit'
                      : baseIsOwn
                        ? ''
                        : ' · from the table'}
                </span>
              </p>
            </>
          ) : (
            <>
              <div className="mt-1 flex items-baseline gap-1">
                <NumCell
                  value={ranch.grazing_precip_mm}
                  disabled={!isManager}
                  onCommit={(v) => setRanchField({ grazing_precip_mm: v })}
                  className="w-20 text-lg font-bold"
                />
                <span className="text-sm text-gray-400">mm</span>
              </div>
              <p className="mt-0.5 text-[11px] text-gray-400">manual · sets the forage-yield band</p>
            </>
          )}
          {isManager && (
            <button onClick={() => setCfg((c) => !c)} className="mt-1 text-[10px] font-medium text-brand-700 hover:underline">
              {cfg ? 'hide' : 'location & season'}
            </button>
          )}
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-3">
          <p className="text-xs text-gray-500">Grazing utilization</p>
          <div className="mt-1 flex items-baseline gap-1">
            {/* Shown and typed as a percent; stored as a fraction (0.8). */}
            {/* The rate Sam set, not the one in use: typing into a box that
                shows a drought-reduced figure would save the reduction. */}
            <NumCell
              value={Math.round(setRate * 100)}
              step="5"
              disabled={!isManager}
              onCommit={(v) => v > 0 && v <= 100 && setRanchField({ grazing_utilization_rate: v / 100 })}
              className="w-20 text-lg font-bold"
            />
            <span className="text-sm text-gray-400">% of forage</span>
          </div>
          {/* What you set, and what the season has made of it. Both are
              shown in either kind of year: a rate that silently differs from
              the box above it is worse than one that explains itself. */}
          {droughtCut ? (
            <p
              className="mt-0.5 text-[11px] font-medium text-amber-700"
              title={`This season is worth ${Math.round(rain.rainFactor * 100)}% of a normal one's grass. Grazing drought-stressed plants to the usual mark costs next year's growth as well as this year's, so the rate slides toward two thirds of what you set.`}
            >
              Dry year — grazing at {Math.round(utilization * 100)}% of {Math.round(setRate * 100)}%
            </p>
          ) : (
            <p
              className="mt-0.5 text-[11px] text-gray-400"
              title={
                rain.rainFactor > 1.02
                  ? `This season is worth ${Math.round(rain.rainFactor * 100)}% of a normal one's grass, and the extra is already in the forage figures. The rate stays where you set it: a good year grows more grass to take half of, and taking a bigger share of it is a decision for a person, not something the arithmetic should do on its own.`
                  : 'The rest stays as residue — the leaf a plant rebuilds its roots from. The rate only ever slides down, in a dry year.'
              }
            >
              {rain.rainFactor > 1.02 ? 'Good year — still grazing at' : 'Grazing at'} {Math.round(setRate * 100)}%, as set
            </p>
          )}
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-3">
          <p className="flex items-center gap-1 text-xs text-gray-500">
            Land capacity <FeedInfo k="aud" />
          </p>
          <p className="mt-1 text-lg font-bold tabular-nums text-gray-900">
            {n0(totals.auds)} <span className="text-sm font-normal text-gray-400">AUDs (animal-unit days)</span>
          </p>
          <p className="mt-0.5 text-[11px] text-gray-400">
            {n0(totals.aums)} animal-unit months (AUMs) · {n0(totals.grazeable)} grazeable ac
            {totals.fieldAuds > 0 && ` · ${n0(totals.fieldAuds)} AUDs off the crop fields`}
          </p>
          {/*
            * Which pound figure the AUDs above are counted in. It belongs
            * beside the number it moves, not in a settings page: the two
            * conventions are 22% apart and the figure means nothing without
            * knowing which one it is.
            */}
          <AuWasteToggle
            countWaste={countWaste}
            disabled={!isManager}
            onChange={(v) => setRanchField({ grazing_count_waste: v })}
          />
          {/*
            * What the weather is worth, in the unit the ranch thinks in.
            *
            * The baseline is the ranch's precipitation zone, which does not
            * move year to year, so the gap between these two lines IS this
            * year's rain and nothing else. Sam, 12 Nov 2026: a wet year has
            * to show up as feed, without anyone reading the baseline as
            * "what happened this year".
            */}
          {rain.forecastSource === 'normal' && normalAuds > 0 && (
            <p className="mt-1 flex flex-wrap items-baseline gap-x-1.5 text-[11px]">
              <span className="text-gray-500" title={`The same paddocks in an ordinary year: the ${n0(rain.zoneMm)} mm zone, with no scaling for this season and no measured growth. This figure does not move with the weather.`}>
                {n0(normalAuds)} AUDs in a normal year
              </span>
              {Math.round(totals.auds) !== Math.round(normalAuds) && (
                <span
                  className={cn(
                    'rounded px-1 py-0.5 font-medium',
                    totals.auds >= normalAuds ? 'bg-green-50 text-green-800' : 'bg-amber-50 text-amber-800',
                  )}
                  title={`This season is worth ${Math.round(rain.rainFactor * 100)}% of a normal one's grass${measuredCount > 0 ? `, and ${measuredCount} paddock${measuredCount === 1 ? ' is' : 's are'} measured from orbit instead` : ''}. Both figures are at the ${Math.round(setRate * 100)}% rate you set, so this is the weather on its own. The zone it is read against has not changed.`}
                >
                  {rainAuds >= normalAuds ? '+' : ''}{n0(rainAuds - normalAuds)} AUDs from this year’s rain
                  {' '}({Math.round(rain.rainFactor * 100)}%)
                </span>
              )}
              {/* The rate cut is its own line. Folded into the one above it,
                  a dry year's rain and its lighter grazing arrived as one
                  number that was neither. */}
              {Math.round(totals.auds) !== Math.round(rainAuds) && (
                <span
                  className="rounded bg-amber-50 px-1 py-0.5 font-medium text-amber-800"
                  title={`Grazing at ${Math.round(utilization * 100)}% instead of the ${Math.round(setRate * 100)}% you set, because the plants are under stress. Taking the usual share now costs next year's growth too.`}
                >
                  {n0(totals.auds - rainAuds)} AUDs from grazing lighter
                </span>
              )}
              {calibration.factor > 1.001 && (
                <span
                  className="rounded bg-sky-50 px-1 py-0.5 font-medium text-sky-800"
                  title={`The forage table put this ranch at ${n0(calibration.modelledAuds)} AUDs in an ordinary year. Your own collars say the cattle took ${n0(calibration.grazedAuds)} AUDs off these paddocks in ${calibration.season} — ${n0(calibration.normalisedAuds)} read as an ordinary year — and left grass standing. So every paddock without a clip-and-weigh is read at ${calibration.factor.toFixed(2)} times the table. Calves at side are left out of the grazed figure, so this is a floor, not a ceiling.`}
                >
                  ×{calibration.factor.toFixed(2)} from your {calibration.season} grazing record
                </span>
              )}
              {measuredCount > 0 && (
                <span className="text-gray-400">
                  · {measuredCount} paddock{measuredCount === 1 ? '' : 's'} measured from orbit
                </span>
              )}
            </p>
          )}
          {/*
            * What the ground sustains, beside what this season grew.
            *
            * Both are right and they answer different questions: the figure
            * above is this year, read off the estimator and scaled by the
            * weather; this one is the rate the soil carries year after year
            * without the stand declining. Sam, 13 Nov 2026 — beside it, not
            * replacing it, because the collars grazed well above the
            * sustainable rate in a 131% season and still left grass.
            */}
          {essr && (
            <p className="mt-1 flex flex-wrap items-baseline gap-x-1.5 border-t border-gray-100 pt-1 text-[11px]">
              <span className="text-gray-500">{n0(essr.auds)} AUDs the ground sustains</span>
              <span
                className={cn(
                  'rounded px-1 py-0.5 font-medium',
                  totals.auds > essr.high ? 'bg-amber-50 text-amber-800' : 'bg-gray-100 text-gray-600',
                )}
                title={`Alberta's Dry Mixedgrass guide, by the range sites under this ranch: ${n0(essr.low)}–${n0(essr.high)} AUDs depending which plant community each site carries. A sustainable long-run rate, already net of utilization — not a cap on a wet year.`}
              >
                {n0(essr.low)}–{n0(essr.high)} range
              </span>
              {essr.ratedShare < 0.995 && (
                <span className="text-gray-400" title="The rest sits on range sites the guide lists no plant community for, so it carries no published rate. Unrated, not zero.">
                  · {Math.round(essr.ratedShare * 100)}% of the mapped acres rated
                </span>
              )}
              <EssrInfo essr={essr} thisYear={totals.auds} />
            </p>
          )}
        </div>
        <div className={cn('rounded-lg border p-3', surplus >= 0 ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50')}>
          <p className="text-xs text-gray-600">{surplus >= 0 ? 'Surplus' : 'Deficit'} vs herd</p>
          <p className={cn('mt-1 text-lg font-bold tabular-nums', surplus >= 0 ? 'text-green-800' : 'text-red-800')}>
            {surplus >= 0 ? '+' : ''}{n0(surplus)} <span className="text-sm font-normal opacity-70">AUDs</span>
          </p>
          <p className="mt-0.5 text-[11px] text-gray-500">
            Herd needs {n0(audsRequired)} AUDs
            {cowsOver != null && cowsOver !== 0 && ` · about ${n0(Math.abs(cowsOver))} cows ${cowsOver > 0 ? 'over' : 'of room'}`}
          </p>
        </div>
      </div>

      {/* Weather-point config for measured rainfall */}
      {cfg && isManager && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-gray-200 bg-white p-3 text-xs text-gray-600">
          <span className="font-medium text-gray-700">Rainfall point for {ranch.name}</span>
          <label className="flex items-center gap-1">
            Lat
            <input type="number" step="0.0001" defaultValue={ranch.latitude ?? ''} disabled={!isManager}
              onBlur={(e) => Number(e.target.value) !== ranch.latitude && setRanchField({ latitude: e.target.value === '' ? null : Number(e.target.value) })}
              className="w-24 rounded-md border border-gray-200 px-1.5 py-1 text-right tabular-nums" />
          </label>
          <label className="flex items-center gap-1">
            Lon
            <input type="number" step="0.0001" defaultValue={ranch.longitude ?? ''} disabled={!isManager}
              onBlur={(e) => Number(e.target.value) !== ranch.longitude && setRanchField({ longitude: e.target.value === '' ? null : Number(e.target.value) })}
              className="w-24 rounded-md border border-gray-200 px-1.5 py-1 text-right tabular-nums" />
          </label>
          <label className="flex items-center gap-1">
            Season
            <Select value={String(ranch.precip_start_month)} size="sm" ariaLabel="Season start month" className="w-28"
              onChange={(v) => setRanchField({ precip_start_month: Number(v) })}
              options={MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))} />
            to
            <Select value={String(ranch.precip_end_month)} size="sm" ariaLabel="Season end month" className="w-28"
              onChange={(v) => setRanchField({ precip_end_month: Number(v) })}
              options={MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))} />
          </label>
          {measured && <span className="text-gray-400">{measured.days} days summed</span>}
        </div>
      )}

      {/* Cumulative rainfall this growing season */}
      {measured && measured.series.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white p-3">
          <div className="mb-1 flex flex-wrap items-baseline justify-between gap-1">
            <h2 className="text-sm font-semibold text-gray-900">This year's rain against normal — {ranch.name}</h2>
            {/* With Auto on, the mm to date and the share of normal are on the
                rain card above; here they stay in the tooltip. */}
            <span
              className="text-xs text-gray-500"
              title={`${n0(measured.total_mm)} mm through ${throughLabel}${measured.normal ? ` · ${RAIN_NORMAL_YEARS}-year average to date ${n0(measured.normal.avg_to_date_mm)} mm` : ''}`}
            >
              {!ranch.precip_auto && `${n0(measured.total_mm)} mm through ${throughLabel} · `}
              scales the forage · the {n0(rain.zoneMm)} mm zone sets the baseline
            </span>
          </div>
          <Suspense fallback={<p className="py-16 text-center text-sm text-gray-400">Loading chart…</p>}>
            <RainGraph
              series={measured.series}
              normal={measured.normal?.cumulative}
              projectedMm={precip}
              normalSeasonMm={measured.normal?.avg_season_mm}
            />
          </Suspense>
        </div>
      )}

      {/* Pastures */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900">Pastures</h2>
          <div className="flex items-center gap-3">
            <button onClick={toggleDetail} className="text-xs font-medium text-brand-700 hover:underline">
              {detail ? 'Hide detail' : 'Show detail'}
            </button>
            {isManager && (
              <button onClick={addPasture} className="flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50">
                <Plus className="h-3.5 w-3.5" /> Add pasture
              </button>
            )}
          </div>
        </div>
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          {/* Phones: one card per pasture. Tap it for the feed breakdown, the
              pencil to change it. */}
          <CardList>
            {calc.map((p) => (
              <RowCard
                key={p.id}
                onClick={breakdownOf(p) ? rowClick(() => toggleOpen(p.id)) : undefined}
                heading={
                  <span className="flex items-center gap-1">
                    {breakdownOf(p) && (
                      <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 text-gray-400 transition-transform', opened.has(p.id) && 'rotate-90')} />
                    )}
                    {p.name}
                  </span>
                }
                actions={
                  <>
                    {/* The figure the list is read for, where the eye lands. */}
                    <span className="whitespace-nowrap text-sm font-semibold tabular-nums text-gray-900">
                      {n0(p.auds)} <span className="text-[11px] font-normal text-gray-400">AUDs</span>
                    </span>
                    {isManager && <EditButton onClick={() => setEditing(p)} />}
                  </>
                }
                /*
                 * Simple view: one wrapped line, because every figure on it
                 * carries its own unit. Detail view keeps the label column —
                 * nine figures with no units of their own need their names.
                 */
                summary={
                  detail ? undefined : (
                    <SummaryLine>
                      <span className="tabular-nums">{n0(p.acres)} ac</span>
                      <Dot />
                      <span className="tabular-nums">{n0(p.totalGrazeableAc)} grazeable</span>
                      <Dot />
                      <GrassQuality p={p} rain={rain} utilization={utilization} measuredFromOrbit={factorFor.has(p.id)} essr={essrByPaddock?.get(p.id)} readOnly />
                      <Dot />
                      <span className="tabular-nums">{n0(p.totalLbs)} lb feed</span>
                    </SummaryLine>
                  )
                }
                facts={[
                  { label: 'Acres', node: n0(p.acres) },
                  ...(detail
                    ? [
                        { label: 'Non-grazeable ac', node: n1(p.non_grazeable_ac) },
                        ...(p.fieldsLinked
                          ? [{ label: 'Crop field ac', node: n0(p.fieldAc) }]
                          : [
                              { label: 'Irrigated ac', node: n0(p.irrigated_ac) },
                              { label: 'Grazeable irrigated', node: n0(p.grazeable_irrigated_ac) },
                            ]),
                        { label: 'Native', node: n0(p.nativeGrassAc) },
                      ]
                    : []),
                  { label: 'Grazeable', node: n0(p.totalGrazeableAc) },
                  {
                    label: 'Cover',
                    node: <GrassQuality p={p} rain={rain} utilization={utilization} measuredFromOrbit={factorFor.has(p.id)} essr={essrByPaddock?.get(p.id)} readOnly />,
                  },
                  { label: 'Feed lb/ac', node: <Lb lb={p.foragePerAcreUtil} /> },
                  { label: 'Total feed lb', node: <Lb lb={p.totalLbs} /> },
                  ...(detail
                    ? [
                        { label: 'AUMs', node: n1(p.aums) },
                        { label: 'Native AUDs', node: n0(p.nativeAuds) },
                        { label: 'Field AUDs', node: n0(p.fieldAuds) },
                      ]
                    : []),
                  { label: 'AUDs', node: <span className="font-semibold">{n0(p.auds)}</span> },
                ]}
              >
                {breakdownOf(p) && opened.has(p.id) && <PastureFeedBreakdown p={p} />}
              </RowCard>
            ))}
            <li className="bg-gray-50 px-3 py-2 text-sm font-semibold">
              Total · {n0(totals.grazeable)} grazeable ac · {n0(totals.lbs)} lb feed · {n0(totals.auds)} AUDs
              {totals.fieldAuds > 0 && <span className="font-normal text-gray-500"> · {n0(totals.fieldAuds)} off the crop fields</span>}
            </li>
          </CardList>
          <table className={cn('hidden w-full text-sm sm:table', detail ? 'min-w-[1040px]' : 'min-w-[620px]')}>
            <thead className={TABLE_HEAD}>
              <tr>
                <th className="px-2 py-2 font-medium">Pasture</th>
                <th className="px-2 py-2 text-right font-medium" title="The whole pasture inside the fence">Acres</th>
                {detail && (
                  <>
                    <th className="px-2 py-2 text-right font-medium" title="Non-grazeable acres (island, riverbed, yard…)">Non-graz</th>
                    <th className="px-2 py-2 text-right font-medium" title="Crop field acres inside the pasture: from the field boundaries, typed by hand only where no field is mapped">Field ac</th>
                    <th className="px-2 py-2 text-right font-medium" title="Field acres that give grazing for the season (stubble after harvest, forage)">Graz field</th>
                    <th className="px-2 py-2 text-right font-medium" title="Acres − non-grazeable − crop fields">Native</th>
                  </>
                )}
                <th className="px-2 py-2 text-right font-medium" title="Native grass + field acres that give grazing">Grazeable</th>
                <th
                  className="px-2 py-2 font-medium"
                  title="Canopy cover against this ranch's median paddock, measured from orbit. 1.00 is the middling paddock here; a paddock nobody has measured shows the old word instead."
                >
                  Cover
                </th>
                <th
                  className="px-2 py-2 text-right font-medium"
                  title="Estimated feed this pasture grows this season, per grazeable acre, after the utilization rate is taken off"
                >
                  Feed lb/ac
                </th>
                <th
                  className="px-2 py-2 text-right font-medium"
                  title="Feed per acre across the pasture's grazeable acres — what the whole paddock is estimated to grow"
                >
                  Total feed lb
                </th>
                {detail && (
                  <>
                    <th
                      className="px-2 py-2 text-right font-medium"
                      title={`Animal-unit months: thirty grazing days each, ${n0(countWaste ? AU_TOTAL_LB_PER_DAY * 30 : AU_INTAKE_LB_PER_DAY * 30)} lb of forage at the figure this ranch counts`}
                    >
                      AUMs
                    </th>
                    <th className="px-2 py-2 text-right font-medium" title="Of the pasture's AUDs, the ones off the crop fields inside the fence — the rest is native grass">Field AUDs</th>
                  </>
                )}
                <th className="px-2 py-2 text-right font-medium">
                  <span className="inline-flex items-center gap-1">
                    AUDs <FeedInfo k="aud" />
                  </span>
                </th>
                {isManager && <th className="px-2 py-2" />}
              </tr>
            </thead>
            <tbody>
              {calc.map((p) => (
                <Fragment key={p.id}>
                <tr
                  onClick={breakdownOf(p) ? rowClick(() => toggleOpen(p.id)) : undefined}
                  className={cn(
                    'border-gray-100',
                    breakdownOf(p) && opened.has(p.id) ? '' : 'border-b',
                    breakdownOf(p) && 'cursor-pointer hover:bg-gray-50',
                  )}
                >
                  <td className="px-2 py-1.5 font-medium">
                    <span className="flex items-center gap-1">
                      {/* Only a pasture with a pivot or hand-typed irrigated
                          acres has anything to break out; the rest is all
                          native grass and the row already says so. */}
                      {breakdownOf(p) && (
                        <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 text-gray-400 transition-transform', opened.has(p.id) && 'rotate-90')} />
                      )}
                      {p.name}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{n0(p.acres)}</td>
                  {detail && (
                    <>
                      <td className="px-2 py-1.5 text-right tabular-nums text-gray-500">{n1(p.non_grazeable_ac)}</td>
                      {p.fieldsLinked ? (
                        <>
                          <td className="px-2 py-1.5 text-right tabular-nums text-gray-500" title="From the field boundaries inside this pasture">{n0(p.fieldAc)}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-gray-500">{n0(p.totalGrazeableAc - p.nativeGrassAc)}</td>
                        </>
                      ) : (
                        <>
                          <td className="px-2 py-1.5 text-right tabular-nums text-gray-500">{n0(p.irrigated_ac)}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-gray-500">{n0(p.grazeable_irrigated_ac)}</td>
                        </>
                      )}
                      <td className="px-2 py-1.5 text-right tabular-nums text-gray-500">{n0(p.nativeGrassAc)}</td>
                    </>
                  )}
                  <td className="px-2 py-1.5 text-right font-medium tabular-nums">{n0(p.totalGrazeableAc)}</td>
                  <td className="px-2 py-1.5">
                    <GrassQuality p={p} rain={rain} utilization={utilization} measuredFromOrbit={factorFor.has(p.id)} essr={essrByPaddock?.get(p.id)} readOnly />
                  </td>
                  <td className="px-2 py-1.5 text-right"><Lb lb={p.foragePerAcreUtil} /></td>
                  <td className="px-2 py-1.5 text-right"><Lb lb={p.totalLbs} bold /></td>
                  {detail && (
                    <>
                      <td className="px-2 py-1.5 text-right tabular-nums">{n1(p.aums)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-gray-500">{n0(p.fieldAuds)}</td>
                    </>
                  )}
                  <td className="px-2 py-1.5 text-right font-medium tabular-nums">{n0(p.auds)}</td>
                  {isManager && (
                    <td className="px-2 py-1.5">
                      <div className="flex items-center justify-end gap-1">
                        <EditButton onClick={() => setEditing(p)} />
                        <DeleteButton
                          onDelete={() => pastureM.remove.mutate(p.id)}
                          confirm={`Delete ${p.name}? Its acres, grass quality and everything the plan works out from them go with it.`}
                          label=""
                        />
                      </div>
                    </td>
                  )}
                </tr>
                {breakdownOf(p) && opened.has(p.id) && (
                  <tr className="border-b border-gray-100 bg-gray-50/60">
                    <td colSpan={99} className="px-2 pb-2 pl-6 pt-1">
                      <PastureFeedBreakdown p={p} />
                    </td>
                  </tr>
                )}
                </Fragment>
              ))}
              <tr className="border-t-2 border-gray-200 bg-gray-50 font-semibold">
                <td className="px-2 py-2">Total</td>
                <td className="px-2 py-2 text-right tabular-nums">{n0(totals.acres)}</td>
                {detail && <td colSpan={4} />}
                <td className="px-2 py-2 text-right tabular-nums">{n0(totals.grazeable)}</td>
                <td />
                {/* An average over the ranch's grazeable acres, not the mean of
                    the rows: a 900 acre paddock and a 35 acre one do not weigh
                    the same. */}
                <td className="px-2 py-2 text-right">
                  <Lb lb={totals.grazeable > 0 ? totals.lbs / totals.grazeable : 0} />
                </td>
                <td className="px-2 py-2 text-right"><Lb lb={totals.lbs} bold /></td>
                {detail && (
                  <>
                    <td className="px-2 py-2 text-right tabular-nums">{n0(totals.aums)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{n0(totals.fieldAuds)}</td>
                  </>
                )}
                <td className="px-2 py-2 text-right tabular-nums">{n0(totals.auds)}</td>
                {isManager && <td />}
              </tr>
            </tbody>
          </table>
          <HelpNote
            className="border-t border-gray-100 px-3 py-2"
            summary="Forage from the ranch's precipitation zone, how the season is going, and each pasture's grass quality."
            title="How pasture capacity is worked out"
          >
            <p>
              1 Animal Unit is a 1,000 lb cow. She eats {AU_INTAKE_LB_PER_DAY} lb a day and{' '}
              {countWaste ? (
                <>
                  tramples or fouls {AU_WASTE_LB_PER_DAY.toFixed(1)} lb more, so a grazing day is costing this paddock{' '}
                  {AU_TOTAL_LB_PER_DAY.toFixed(1)} lb (AUM = {n0(AU_TOTAL_LB_PER_DAY * 30)} lb, Alberta&apos;s 455 kg)
                </>
              ) : (
                <>
                  only what she eats is being counted, so a grazing day costs {AU_INTAKE_LB_PER_DAY} lb (AUM ={' '}
                  {n0(AU_INTAKE_LB_PER_DAY * 30)} lb) — see &ldquo;Counting&rdquo; above
                </>
              )}
              . A normal year&apos;s forage comes from the Alberta Forage
              Manual&apos;s table (p.205) at the ranch&apos;s precipitation zone and each pasture&apos;s grass quality
              {measuredYieldCount > 0
                ? ` — except for ${measuredYieldCount} pasture${measuredYieldCount === 1 ? '' : 's'} read off its own clip-and-weigh instead`
                : ''}
              . That figure is then scaled by how this season is going, and reduced by the utilization rate.
            </p>
            <p>
              The season does <em>not</em> scale it 1:1 with the rain. The first 100 mm of a season goes to
              evaporation and runoff before a plant makes a leaf, so a dry year is shorter of grass than it is of
              rain — 10% less rain is about 12% less grass here, 40% less rain about 53% less. Rain is weighted by
              when it fell: April to June decides most of a year&apos;s forage, July and August under a fifth, and
              what fell last autumn and winter counts as stored moisture. A wet year is capped at 130% of normal,
              because without nitrogen the pasture cannot use more than that.
            </p>
            <p>
              The table itself is a rough provincial guide and knows nothing of either. It sets the level a pasture
              starts from and nothing else; once a pasture has been cut and weighed, that pasture is read off its
              own grass and the table stops applying to it.
            </p>
            <p>
              The grass rating says which paddock is better than which, and nothing about pounds. It is measured
              as a paddock&apos;s canopy cover against <em>this ranch&apos;s median paddock</em>, so the median
              scores 1.00 on any ranch, good or poor. Handing that to a table of absolute pounds threw the
              ranch&apos;s own level away and replaced it with a provincial average — which is why every paddock
              read low together and no amount of re-rating could say so. The level is now the{' '}
              <span className="font-medium">median paddock</span> figure on the rain card, and each paddock is
              read at that times its own cover.
            </p>
            {calibration.factor > 1.001 && (
              <p>
                It was also reading low here, and your cattle are what showed it: the collars say they took{' '}
                {n0(calibration.grazedAuds)} AUDs off these paddocks in {calibration.season} — {n0(calibration.normalisedAuds)}{' '}
                read as an ordinary year — where the table allowed {n0(calibration.modelledAuds)}. Every paddock
                without its own clip-and-weigh is now read at {calibration.factor.toFixed(2)} times the table.
                The grass rating still decides which paddock is better than which; this only sets the level they
                are all read at. A grazing record is a floor — it says what the grass carried, not what it could
                have — so this can raise the estimate and never lower it.
              </p>
            )}
            <p>
              The zone is <em>annual</em> precipitation, and it is a classification of the ranch rather than a
              reading of this year — no amount of rain in one season moves a ranch to a wetter zone. The manual
              takes it off the soil climatic zone, 300 mm for Brown and 400 mm for Dark Brown, and every polygon
              under both ranches is Brown Chernozem.
            </p>
            <p>
              They are classified on measured rainfall anyway — 379 mm at Home Ranch, 392 mm at East Ranch, both
              in the 350–450 band — because the grazing record says the Brown row is too low for this land. A
              Chernozem records the climate that <em>built</em> it over thousands of years; it does not know this
              ranch has river bottom and irrigated corners in it. Edit the figure on the rain card if that is ever
              wrong.
            </p>
            <p>
              What this year&apos;s weather does is scale what that row yields: the satellite&apos;s own measurement
              of a paddock where there is one, otherwise the projected season against a normal one — never both,
              because they measure the same weather.
            </p>
            <p>
              The rain figure is Open-Meteo&apos;s, because the {RAIN_NORMAL_YEARS}-year normal it is divided by comes
              from the same place, and a ratio between two instruments measures the instruments. The nearest real gauge
              is shown under it, and turns amber when the two are more than {Math.round(GAUGE_GAP_FLAG * 100)}% apart —
              a grid cell averages away where a storm actually fell, so a gauge that far out is worth a look before
              stocking on the number above it.
            </p>
            <p>
              Crop fields inside a fence are counted from the farming side — stubble only after
              harvest, nothing once worked. The pasture is owned, so it carries no rent. Grey
              columns are calculated. Feed lb/ac is that supply after utilization and total feed is it across the
              pasture’s grazeable acres — the pounds the AUDs beside them are counted from; a pasture with a pivot
              inside the fence opens to show which of those pounds are grass and which are stubble.
            </p>
          </HelpNote>
        </div>
      </section>

      {editing && (
        <RecordEditModal
          title={`Edit ${editing.name}`}
          /*
           * Acres, not km², is what a pasture is here — the column behind it is
           * km² and the form converts. The crop-field acres are not on the form
           * at all when the fields are mapped: they come from the boundaries on
           * the farming side, and a box that silently loses its value on the
           * next save is worse than no box.
           */
          fields={[
            { key: 'name', label: 'Name', kind: 'text', required: true },
            { key: 'acres', label: 'Acres', kind: 'number', step: '1', hint: 'The whole pasture inside the fence' },
            { key: 'non_grazeable_ac', label: 'Non-grazeable ac', kind: 'number', step: '0.1', hint: 'Island, riverbed, yard — acres that grow nothing a cow can reach' },
            ...(editing.fieldsLinked
              ? []
              : [
                  { key: 'irrigated_ac', label: 'Irrigated ac', kind: 'number' as const, step: '1', hint: 'Only for a pasture with no crop field mapped inside it' },
                  { key: 'grazeable_irrigated_ac', label: 'Grazeable irrigated ac', kind: 'number' as const, step: '1' },
                ]),
            {
              key: 'grass_quality',
              label: 'Grass quality',
              kind: 'select',
              options: GRASS_QUALITIES.map((q) => ({ value: q, label: q })),
              hint: 'Picking one by hand keeps the satellite pass off this paddock',
            },
          ]}
          row={{ ...editing, acres: Math.round(editing.acres) }}
          onClose={() => setEditing(null)}
          onSave={(patch) => {
            const { acres, grass_quality, ...rest } = patch as Record<string, unknown>
            const next: PasturePatch = { ...(rest as PasturePatch) }
            if (acres != null) next.km2 = Math.max(0, Number(acres)) / (100 * ACRES_PER_HECTARE)
            if (typeof grass_quality === 'string') {
              next.grass_quality = grass_quality
              // Only a change counts as somebody picking it: re-saving the name
              // should not quietly take the paddock off the satellite.
              if (grass_quality !== editing.grass_quality) next.grass_quality_source = 'manual'
            }
            return pastureM.update.mutateAsync({ id: editing.id, patch: next })
          }}
          onDelete={() => pastureM.remove.mutateAsync(editing.id)}
          deleteConfirm={`Delete ${editing.name}? Its acres, grass quality and everything the plan works out from them go with it.`}
        />
      )}

      {/* Herd */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900">Grazing herd</h2>
          <FromHerdChip />
        </div>
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          {/* Phones: one card per class, dates and knobs editable in place. */}
          <CardList>
            {herdCalc.map((h) => (
              <RowCard
                key={h.id}
                heading={h.class_name}
                actions={
                  <span className="whitespace-nowrap text-sm font-semibold tabular-nums text-gray-900">
                    {n0(h.audsRequired)} <span className="text-[11px] font-normal text-gray-400">AUDs</span>
                  </span>
                }
                /*
                 * Two lines: what the class is, then when it grazes. The
                 * weight and AU/head stay editable inline — they are the two
                 * a person actually changes here.
                 */
                summary={
                  <>
                    <SummaryLine>
                      <span className="tabular-nums">{n0(h.head_count)} head</span>
                      <Dot />
                      <NumCell value={h.avg_weight_lb} step="50" disabled={!isManager} onCommit={(v) => patchH(h.id, { avg_weight_lb: v })} className="w-16" />
                      <span className="text-gray-400">lb</span>
                      <Dot />
                      <NumCell value={h.au_equivalent} step="0.05" disabled={!isManager} onCommit={(v) => patchH(h.id, { au_equivalent: v })} className="w-14" />
                      {/* Total AU is head x AU/head and is in the table; on a
                          375 px line it only pushed itself onto a row of its
                          own behind a stranded dot. */}
                      <span className="text-gray-400">AU/head</span>
                    </SummaryLine>
                    <SummaryLine>
                      <GrazeDay value={h.graze_start} which="Graze start" disabled={!isManager}
                        onChange={(v) => patchH(h.id, { graze_start: v })} />
                      <span className="text-gray-400">to</span>
                      <GrazeDay value={h.graze_end} which="Graze end" disabled={!isManager}
                        onChange={(v) => patchH(h.id, { graze_end: v })} />
                    </SummaryLine>
                    <SummaryLine>
                      <span className="tabular-nums">{h.days} days</span>
                      <Dot />
                      <span className="tabular-nums">{n1(h.totalAU)} animal units</span>
                      <SeasonNote h={h} />
                    </SummaryLine>
                  </>
                }
                facts={[
                  { label: 'Head', node: n0(h.head_count) },
                  { label: 'Avg weight lb', node: <NumCell value={h.avg_weight_lb} step="50" disabled={!isManager} onCommit={(v) => patchH(h.id, { avg_weight_lb: v })} /> },
                  { label: 'AU/head', node: <NumCell value={h.au_equivalent} step="0.05" disabled={!isManager} onCommit={(v) => patchH(h.id, { au_equivalent: v })} /> },
                  { label: 'Total AU', node: n1(h.totalAU) },
                  {
                    label: 'Start',
                    node: (
                      <>
                        <GrazeDay value={h.graze_start} which="Graze start" disabled={!isManager}
                          onChange={(v) => patchH(h.id, { graze_start: v })} />
                        <SeasonNote h={h} />
                      </>
                    ),
                  },
                  {
                    label: 'End',
                    node: (
                      <GrazeDay value={h.graze_end} which="Graze end" disabled={!isManager}
                        onChange={(v) => patchH(h.id, { graze_end: v })} />
                    ),
                  },
                  { label: 'Days', node: String(h.days) },
                  { label: "AUDs req'd", node: <span className="font-semibold">{n0(h.audsRequired)}</span> },
                ]}
              />
            ))}
            <li className="bg-gray-50 px-3 py-2 text-sm font-semibold">Total AUDs required · {n0(audsRequired)}</li>
          </CardList>
          <table className="hidden w-full min-w-[820px] text-sm sm:table">
            <thead className={TABLE_HEAD}>
              <tr>
                <th className="px-2 py-2 font-medium">Class</th>
                <th className="px-2 py-2 text-right font-medium">Avg weight lb</th>
                <th className="px-2 py-2 text-right font-medium" title="Animal units per head">AU/head</th>
                <th className="px-2 py-2 text-right font-medium" title="From the Herd tab"># Head</th>
                <th className="px-2 py-2 text-right font-medium">Total AU</th>
                <th className="px-2 py-2 font-medium">Start</th>
                <th className="px-2 py-2 font-medium">End</th>
                <th className="px-2 py-2 text-right font-medium">Days</th>
                <th className="px-2 py-2 text-right font-medium">AUDs req'd</th>
              </tr>
            </thead>
            <tbody>
              {herdCalc.map((h) => (
                <tr key={h.id} className="border-b border-gray-100 last:border-0">
                  <td className="px-2 py-1.5 font-medium text-gray-800">{h.class_name}</td>
                  <td className="px-2 py-1.5 text-right"><NumCell value={h.avg_weight_lb} step="50" disabled={!isManager} onCommit={(v) => patchH(h.id, { avg_weight_lb: v })} /></td>
                  <td className="px-2 py-1.5 text-right"><NumCell value={Math.round(h.auPerHead * 100) / 100} step="0.05" disabled={!isManager} onCommit={(v) => patchH(h.id, { au_equivalent: v, au_override: Math.abs(v - auFromWeight(Number(h.avg_weight_lb))) > 0.005 })} className={h.au_override ? 'text-amber-700' : undefined} /></td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-gray-600" title="Set on the Herd tab">{n0(h.head_count)}</td>
                  <td className="px-2 py-1.5 text-right font-medium tabular-nums">{n1(h.totalAU)}</td>
                  <td className="px-2 py-1.5">
                    <GrazeDay value={h.graze_start} which="Graze start" disabled={!isManager}
                      onChange={(v) => patchH(h.id, { graze_start: v })} />
                    <SeasonNote h={h} />
                  </td>
                  <td className="px-2 py-1.5">
                    <GrazeDay value={h.graze_end} which="Graze end" disabled={!isManager}
                      onChange={(v) => patchH(h.id, { graze_end: v })} />
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-gray-500">{h.days}</td>
                  <td className="px-2 py-1.5 text-right font-medium tabular-nums" title={h.calfAuds > 0 ? `includes ${n0(h.calfAuds)} for the calves at side` : undefined}>{n0(h.audsRequired)}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-gray-200 bg-gray-50 font-semibold">
                <td className="px-2 py-2" colSpan={8}>Total AUDs required</td>
                <td className="px-2 py-2 text-right tabular-nums">{n0(audsRequired)}</td>
              </tr>
            </tbody>
          </table>
          <HelpNote className="border-t border-gray-100 px-3 py-2" summary="Animal units × days grazing." title="AUDs required">
            <p>AUDs required = total animal units × days grazing. Compare against land capacity above.</p>
            <p>
              A class with no dates is counted over the ranch&apos;s grazing season (the classes&apos; earliest turnout to latest coming-off, else
              1 May – 16 Nov). Turnout and coming-off are a month and a day, so they carry from year to year on their own.
            </p>
          </HelpNote>
        </div>
      </section>

    </div>
  )
}

