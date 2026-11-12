import { Fragment, Suspense, useEffect, useMemo, useState } from 'react'
import { lazyWithRetry } from '@/lib/lazyWithRetry'
import { CloudRain, Plus, Trash2 } from 'lucide-react'
import { Select } from '@/components/Select'
import {
  computeHerds,
  computePastures,
  grassBalance,
  grazingRain,
  type HerdCalc,
  useGrazingHerd,
  useGrazingPastures,
  useHerdMutations,
  usePastureFieldContext,
  usePastureMutations,
  usePastureSeasonFactors,
  useRanchPrecip,
} from '@/lib/grazing'
import { PastureFieldsLine } from './PastureFields'
import { GrassQuality } from './GrassQuality'
import { useSetRanch, type Ranch } from '@/lib/ranches'
import { useFeedPlan } from '@/lib/feed'
import { auFromWeight } from '@/lib/animal-units'
import { ACRES_PER_HECTARE } from '@/lib/forage-yield'
import { shortDay } from '@/lib/field-residue'
import type { Database } from '@/lib/database.types'
import { cn } from '@/lib/utils'
import { HelpNote } from '@/components/HelpNote'
import { FeedInfo } from './feed/FeedInfo'
import { FromHerdChip } from './feed/bits'
import { n0, n1 } from '@/lib/format'
import { TABLE_HEAD } from '@/lib/table-style'
import { CardList, Dot, RowCard, SummaryLine } from '@/components/RowCards'

type PasturePatch = Database['public']['Tables']['grazing_pastures']['Update']
type HerdPatch = Database['public']['Tables']['herd_counts']['Update']

// Lazy so recharts only loads when the Grazing tab is opened.
const RainGraph = lazyWithRetry(() => import('./RainGraph').then((m) => ({ default: m.RainGraph })))

const DETAIL_KEY = 'grazing_pasture_detail'
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
  return (
    <input
      type="number"
      step={step}
      disabled={disabled}
      defaultValue={value ?? 0}
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

  const utilization = ranch.grazing_utilization_rate ?? 0.8
  /*
   * The plan is THIS season, not an average one.
   *
   * It used to be the 10-year normal, with this year's rain shown beside it as
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

  // Crop fields inside the fences, from the farming side: grass all season,
  // stubble only once harvested and not worked (field-residue.ts).
  const fieldCtx = usePastureFieldContext(ranchId, herd)
  const seasonCtx = useMemo(() => fieldCtx.ctx(), [fieldCtx])
  /*
   * Where the satellite has watched a paddock grow and no cattle have been on
   * it this year, its own measured growth beats the rain gauge: a paddock that
   * caught a storm the gauge missed shows it, and so does one that did not.
   * Those paddocks are costed on the NORMAL season's rain times their measured
   * factor — the factor already IS this year, and using the wet-year rainfall
   * as well would count the same weather twice.
   */
  const { data: factors } = usePastureSeasonFactors(ranchId)
  const factorFor = useMemo(() => {
    const m = new Map<string, number>()
    for (const f of factors ?? []) if (f.factor != null) m.set(f.grazing_pasture_id, f.factor)
    return m
  }, [factors])
  const calc = useMemo(
    () => computePastures(pastures ?? [], rain, utilization, seasonCtx, factorFor),
    [pastures, rain, utilization, seasonCtx, factorFor],
  )
  // The same pastures on a normal season, so the difference this year made is
  // a number beside the plan rather than something only the plan knows.
  const normalAuds = useMemo(
    () =>
      computePastures(pastures ?? [], { forecastMm: rain.forecastMm, projectedMm: null }, utilization, seasonCtx)
        .reduce((a, p) => a + p.auds, 0),
    [pastures, rain, utilization, seasonCtx],
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
    rain,
    precip,
    calc,
    normalAuds,
    measuredCount,
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

export function GrazingCalculator({ isManager, ranch }: { isManager: boolean; ranch: Ranch }) {
  const ranchId = ranch.id
  const {
    pastures,
    measured,
    precipLoading,
    precipError,
    utilization,
    rain,
    precip,
    calc,
    normalAuds,
    measuredCount,
    herdCalc,
    totals,
    audsRequired,
    surplus,
    cowsOver,
  } = useGrazingCalc(ranch)
  const setRanch = useSetRanch()
  const pastureM = usePastureMutations()
  const herdM = useHerdMutations()

  const addPasture = () =>
    pastureM.create.mutate({
      name: `Pasture ${(pastures?.length ?? 0) + 1}`,
      sort_order: (pastures?.at(-1)?.sort_order ?? 0) + 1,
      ranch_id: ranchId,
    })
  const patchP = (id: string, patch: PasturePatch) => pastureM.update.mutate({ id, patch })
  /**
   * Acres is what everybody here says a pasture is; km² is only how the column
   * happens to be stored. Typing acres writes the km² behind it (Sam, 10 Nov
   * 2026: East Ranch's Main Pasture is 2,923 acres and there was nowhere to put
   * the number — the only size box was km², hidden behind the detail switch).
   */
  const setAcres = (id: string, acres: number) => patchP(id, { km2: Math.max(0, acres) / (100 * ACRES_PER_HECTARE) })
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
                          <span title={`10-year average of ${measured!.normal!.years.map((y) => y.year).join(', ')}`}>
                            {measured!.normal!.years.length}-yr avg
                          </span>
                        )
                      : measured
                        ? 'no 10-year average — using manual'
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
                  title="This year's rain since the season started, against the 10-year average to the same day."
                >
                  {n0(rain.toDateMm)} mm to {throughLabel}
                  {rain.pctOfNormal != null && ` · ${rain.pctOfNormal}% of normal`}
                </p>
              )}
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
            <NumCell
              value={Math.round(utilization * 100)}
              step="5"
              disabled={!isManager}
              onCommit={(v) => v > 0 && v <= 100 && setRanchField({ grazing_utilization_rate: v / 100 })}
              className="w-20 text-lg font-bold"
            />
            <span className="text-sm text-gray-400">% of forage</span>
          </div>
          <p className="mt-0.5 text-[11px] text-gray-400">Grazed; the rest stays as residue. Default 80%.</p>
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
          {rain.forecastSource === 'normal' && Math.round(normalAuds) !== Math.round(totals.auds) && (
            <p
              className="mt-0.5 text-[11px] text-gray-500"
              title={`The same paddocks on a normal season: ${n0(rain.forecastMm)} mm and no measured growth`}
            >
              A normal season: {n0(normalAuds)} AUDs
              {measuredCount > 0 && ` · ${measuredCount} paddock${measuredCount === 1 ? '' : 's'} measured from orbit`}
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
            <h2 className="text-sm font-semibold text-gray-900">This year's rainfall — {ranch.name}</h2>
            {/* With Auto on, the mm to date and the share of normal are on the
                rain card above; here they stay in the tooltip. */}
            <span
              className="text-xs text-gray-500"
              title={`${n0(measured.total_mm)} mm through ${throughLabel}${measured.normal ? ` · 10-year average to date ${n0(measured.normal.avg_to_date_mm)} mm` : ''}`}
            >
              {!ranch.precip_auto && `${n0(measured.total_mm)} mm through ${throughLabel} · `}
              dotted lines are the estimator&apos;s rainfall rows
            </span>
          </div>
          <Suspense fallback={<p className="py-16 text-center text-sm text-gray-400">Loading chart…</p>}>
            <RainGraph series={measured.series} normal={measured.normal?.cumulative} projectedMm={precip} />
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
          {/* Phones: one card per pasture, the same inputs as the row. */}
          <CardList>
            {calc.map((p) => (
              <RowCard
                key={p.id}
                heading={
                  <input
                    defaultValue={p.name}
                    disabled={!isManager}
                    onBlur={(e) => e.target.value !== p.name && patchP(p.id, { name: e.target.value })}
                    // Reads as the heading it is until it is tapped. An always-
                    // bordered 160 px box made every card look like a form.
                    className="w-full max-w-[11rem] rounded-md border border-transparent bg-transparent px-1 py-0.5 text-sm font-semibold hover:border-gray-200 focus:border-gray-300 focus:bg-white"
                    aria-label="Pasture name"
                  />
                }
                actions={
                  <>
                    {/* The figure the list is read for, where the eye lands. */}
                    <span className="whitespace-nowrap text-sm font-semibold tabular-nums text-gray-900">
                      {n0(p.auds)} <span className="text-[11px] font-normal text-gray-400">AUDs</span>
                    </span>
                    {isManager && (
                      <button onClick={() => pastureM.remove.mutate(p.id)} className="p-1 text-gray-300 hover:text-red-600" aria-label={`Delete ${p.name}`}>
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
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
                      {/* A card with a summary shows the summary INSTEAD of its
                          facts, so the acres box has to live here too or the
                          phone is back to a read-only number. */}
                      <span className="flex items-center gap-1">
                        <NumCell value={Math.round(p.acres)} disabled={!isManager} onCommit={(v) => setAcres(p.id, v)} className="w-20" />
                        ac
                      </span>
                      <Dot />
                      <span className="tabular-nums">{n0(p.totalGrazeableAc)} grazeable</span>
                      <Dot />
                      <GrassQuality
                        p={p}
                        disabled={!isManager}
                        className="w-24"
                        onChange={(patch) => patchP(p.id, patch)}
                      />
                    </SummaryLine>
                  )
                }
                facts={[
                  { label: 'Acres', node: <NumCell value={Math.round(p.acres)} disabled={!isManager} onCommit={(v) => setAcres(p.id, v)} className="w-20" /> },
                  ...(detail
                    ? [
                        { label: 'Non-grazeable ac', node: <NumCell value={p.non_grazeable_ac} step="0.1" disabled={!isManager} onCommit={(v) => patchP(p.id, { non_grazeable_ac: v })} /> },
                        ...(p.fieldsLinked
                          ? [{ label: 'Crop field ac', node: n0(p.fieldAc) }]
                          : [
                              { label: 'Irrigated ac', node: <NumCell value={p.irrigated_ac} step="1" disabled={!isManager} onCommit={(v) => patchP(p.id, { irrigated_ac: v })} /> },
                              { label: 'Grazeable irrigated', node: <NumCell value={p.grazeable_irrigated_ac} step="1" disabled={!isManager} onCommit={(v) => patchP(p.id, { grazeable_irrigated_ac: v })} /> },
                            ]),
                        { label: 'Native', node: n0(p.nativeGrassAc) },
                      ]
                    : []),
                  { label: 'Grazeable', node: n0(p.totalGrazeableAc) },
                  {
                    label: 'Quality',
                    node: (
                      <GrassQuality
                        p={p}
                        disabled={!isManager}
                        className="w-28"
                        onChange={(patch) => patchP(p.id, patch)}
                      />
                    ),
                  },
                  ...(detail
                    ? [
                        { label: 'lb/ac', node: n0(p.foragePerAcreUtil) },
                        { label: 'AUMs', node: n1(p.aums) },
                        { label: 'Native AUDs', node: n0(p.nativeAuds) },
                        { label: 'Field AUDs', node: n0(p.fieldAuds) },
                      ]
                    : []),
                  { label: 'AUDs', node: <span className="font-semibold">{n0(p.auds)}</span> },
                ]}
              >
                {(p.fieldsLinked || p.irrigated_ac > 0) && <PastureFieldsLine p={p} />}
              </RowCard>
            ))}
            <li className="bg-gray-50 px-3 py-2 text-sm font-semibold">
              Total · {n0(totals.grazeable)} grazeable ac · {n0(totals.auds)} AUDs
              {totals.fieldAuds > 0 && <span className="font-normal text-gray-500"> · {n0(totals.fieldAuds)} off the crop fields</span>}
            </li>
          </CardList>
          <table className={cn('hidden w-full text-sm sm:table', detail ? 'min-w-[960px]' : 'min-w-[480px]')}>
            <thead className={TABLE_HEAD}>
              <tr>
                <th className="px-2 py-2 font-medium">Pasture</th>
                <th className="px-2 py-2 text-right font-medium" title="The whole pasture inside the fence. Type it here.">Acres</th>
                {detail && (
                  <>
                    <th className="px-2 py-2 text-right font-medium" title="Non-grazeable acres (island, riverbed, yard…)">Non-graz</th>
                    <th className="px-2 py-2 text-right font-medium" title="Crop field acres inside the pasture: from the field boundaries, typed by hand only where no field is mapped">Field ac</th>
                    <th className="px-2 py-2 text-right font-medium" title="Field acres that give grazing for the season (stubble after harvest, forage)">Graz field</th>
                    <th className="px-2 py-2 text-right font-medium" title="Acres − non-grazeable − crop fields">Native</th>
                  </>
                )}
                <th className="px-2 py-2 text-right font-medium" title="Native grass + field acres that give grazing">Grazeable</th>
                <th className="px-2 py-2 font-medium">Quality</th>
                {detail && (
                  <>
                    <th className="px-2 py-2 text-right font-medium" title="Forage supply after utilization (lbs/acre)">lb/ac</th>
                    <th className="px-2 py-2 text-right font-medium" title="Animal-unit months: 780 lb of forage each">AUMs</th>
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
                <tr className={cn('border-gray-100', p.fieldsLinked || p.irrigated_ac > 0 ? '' : 'border-b')}>
                  <td className="px-2 py-1.5">
                    <input
                      defaultValue={p.name}
                      disabled={!isManager}
                      onBlur={(e) => e.target.value !== p.name && patchP(p.id, { name: e.target.value })}
                      className="w-24 rounded-md border border-gray-200 px-1.5 py-1 text-sm font-medium disabled:border-transparent disabled:bg-transparent"
                    />
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <NumCell value={Math.round(p.acres)} disabled={!isManager} onCommit={(v) => setAcres(p.id, v)} className="w-20" />
                  </td>
                  {detail && (
                    <>
                      <td className="px-2 py-1.5 text-right"><NumCell value={p.non_grazeable_ac} step="0.1" disabled={!isManager} onCommit={(v) => patchP(p.id, { non_grazeable_ac: v })} /></td>
                      {p.fieldsLinked ? (
                        <>
                          <td className="px-2 py-1.5 text-right tabular-nums text-gray-500" title="From the field boundaries inside this pasture">{n0(p.fieldAc)}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-gray-500">{n0(p.totalGrazeableAc - p.nativeGrassAc)}</td>
                        </>
                      ) : (
                        <>
                          <td className="px-2 py-1.5 text-right"><NumCell value={p.irrigated_ac} step="1" disabled={!isManager} onCommit={(v) => patchP(p.id, { irrigated_ac: v })} /></td>
                          <td className="px-2 py-1.5 text-right"><NumCell value={p.grazeable_irrigated_ac} step="1" disabled={!isManager} onCommit={(v) => patchP(p.id, { grazeable_irrigated_ac: v })} /></td>
                        </>
                      )}
                      <td className="px-2 py-1.5 text-right tabular-nums text-gray-500">{n0(p.nativeGrassAc)}</td>
                    </>
                  )}
                  <td className="px-2 py-1.5 text-right font-medium tabular-nums">{n0(p.totalGrazeableAc)}</td>
                  <td className="px-2 py-1.5">
                    <GrassQuality
                      p={p}
                      disabled={!isManager}
                      className="w-28"
                      onChange={(patch) => patchP(p.id, patch)}
                    />
                  </td>
                  {detail && (
                    <>
                      <td className="px-2 py-1.5 text-right tabular-nums text-gray-500">{n0(p.foragePerAcreUtil)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{n1(p.aums)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-gray-500">{n0(p.fieldAuds)}</td>
                    </>
                  )}
                  <td className="px-2 py-1.5 text-right font-medium tabular-nums">{n0(p.auds)}</td>
                  {isManager && (
                    <td className="px-2 py-1.5 text-right">
                      <button onClick={() => pastureM.remove.mutate(p.id)} className="text-gray-300 hover:text-red-600" aria-label={`Delete ${p.name}`}>
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  )}
                </tr>
                {(p.fieldsLinked || p.irrigated_ac > 0) && (
                  <tr className="border-b border-gray-100">
                    <td colSpan={99} className="px-2 pb-1.5 pl-4">
                      <PastureFieldsLine p={p} />
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
                {detail && (
                  <>
                    <td />
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
            summary="Forage from the estimator's precipitation row and each pasture's grass quality."
            title="How pasture capacity is worked out"
          >
            <p>
              1 Animal Unit eats 26 lbs/day (AUM = 780 lbs). Forage supply is looked up from the Alberta Forage
              Manual&apos;s precipitation rows, fed this season&apos;s rainfall (the 10-year average when Auto), and
              each pasture&apos;s grass quality, then reduced by the utilization rate. Crop fields inside a fence are counted from the farming side — stubble only after
              harvest, nothing once worked (the ⓘ under each pasture). The pasture is owned, so it carries no rent. Grey
              columns are calculated.
            </p>
          </HelpNote>
        </div>
      </section>

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

