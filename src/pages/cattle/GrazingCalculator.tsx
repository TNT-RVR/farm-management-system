import { DateField } from '@/components/DateField'
import { Suspense, useEffect, useMemo, useState } from 'react'
import { lazyWithRetry } from '@/lib/lazyWithRetry'
import { CloudRain, Plus, Trash2 } from 'lucide-react'
import { Select } from '@/components/Select'
import {
  computeHerd,
  computePasture,
  GRASS_QUALITIES,
  grazingRain,
  useGrazingHerd,
  useGrazingPastures,
  useHerdMutations,
  usePastureMutations,
  useRanchPrecip,
} from '@/lib/grazing'
import { useSetRanch, type Ranch } from '@/lib/ranches'
import type { Database } from '@/lib/database.types'
import { cn } from '@/lib/utils'
import { HelpNote } from '@/components/HelpNote'
import { FeedInfo } from './feed/FeedInfo'
import { FromHerdChip } from './feed/bits'

type PasturePatch = Database['public']['Tables']['grazing_pastures']['Update']
type HerdPatch = Database['public']['Tables']['herd_counts']['Update']

// Lazy so recharts only loads when the Grazing tab is opened.
const RainGraph = lazyWithRetry(() => import('./RainGraph').then((m) => ({ default: m.RainGraph })))

const n0 = (v: number) => Math.round(v).toLocaleString('en-CA')
const n1 = (v: number) => v.toLocaleString('en-CA', { maximumFractionDigits: 1 })
const DETAIL_KEY = 'grazing_pasture_detail'
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

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

export function GrazingCalculator({
  isManager,
  ranch,
  onTotals,
}: {
  isManager: boolean
  ranch: Ranch
  /**
   * Reports this ranch's figures upward so several can be summed.
   *
   * The OUTPUTS are aggregated, never the inputs. Each ranch has its own
   * rainfall and its own utilisation rate, so pooling acres and applying one
   * ranch's precipitation would produce a carrying capacity for a place that
   * does not exist. Computing each with its own settings and adding the
   * results is the only sum that means anything.
   */
  onTotals?: (t: GrazingTotals) => void
}) {
  const ranchId = ranch.id
  const { data: pastures } = useGrazingPastures(ranchId)
  const { data: herd } = useGrazingHerd(ranchId)
  const { data: measured, isLoading: precipLoading, isError: precipError } = useRanchPrecip(ranch)
  const setRanch = useSetRanch()
  const pastureM = usePastureMutations()
  const herdM = useHerdMutations()

  const utilization = ranch.grazing_utilization_rate ?? 0.8
  // The forecast plans on a normal season - the 10-year average - when auto is
  // on; otherwise the manually-entered figure, which is also the fallback while
  // the archive loads, so the calc never blanks out. This year's own rain is
  // shown beside it, not used for the plan (see grazingRain).
  const rain = grazingRain(ranch, measured)
  const precip = rain.forecastMm

  const calc = useMemo(
    () => (pastures ?? []).map((p) => computePasture(p, precip, utilization)),
    [pastures, precip, utilization],
  )
  // The same pastures at this year's pace, so a dry year shows up as a smaller
  // number next to the plan rather than silently changing the plan.
  const paceAuds = useMemo(
    () =>
      rain.projectedMm == null
        ? null
        : (pastures ?? []).reduce((a, p) => a + computePasture(p, rain.projectedMm!, utilization).auds, 0),
    [pastures, rain.projectedMm, utilization],
  )
  const herdCalc = useMemo(() => (herd ?? []).map(computeHerd), [herd])

  const totals = useMemo(
    () =>
      calc.reduce(
        (a, p) => ({
          acres: a.acres + p.acres,
          grazeable: a.grazeable + p.totalGrazeableAc,
          lbs: a.lbs + p.totalLbs,
          aums: a.aums + p.aums,
          auds: a.auds + p.auds,
        }),
        { acres: 0, grazeable: 0, lbs: 0, aums: 0, auds: 0 },
      ),
    [calc],
  )
  const audsRequired = useMemo(() => herdCalc.reduce((a, h) => a + h.audsRequired, 0), [herdCalc])
  const surplus = totals.auds - audsRequired

  useEffect(() => {
    onTotals?.({
      ranchId,
      acres: totals.acres,
      grazeable: totals.grazeable,
      auds: totals.auds,
      audsRequired,
      surplus,
    })
  }, [onTotals, ranchId, totals, audsRequired, surplus])

  const addPasture = () =>
    pastureM.create.mutate({
      name: `Pasture ${(pastures?.length ?? 0) + 1}`,
      sort_order: (pastures?.at(-1)?.sort_order ?? 0) + 1,
      ranch_id: ranchId,
    })
  const patchP = (id: string, patch: PasturePatch) => pastureM.update.mutate({ id, patch })
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
                  : rain.forecastSource === 'normal'
                    ? (
                        <span title={`10-year average of ${measured!.normal!.years.map((y) => y.year).join(', ')}`}>
                          5-yr avg
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
                  title="This year's rain since the season started, against the 10-year average to the same day. Used for in-season decisions, not for the plan."
                >
                  This year {n0(rain.toDateMm)} mm to {throughLabel}
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
          <p className="mt-0.5 text-[11px] text-gray-400">{n0(totals.aums)} AUMs · {n0(totals.grazeable)} grazeable ac</p>
          {paceAuds != null && rain.forecastSource === 'normal' && Math.round(paceAuds) !== Math.round(totals.auds) && (
            <p
              className="mt-0.5 text-[11px] text-gray-500"
              title={`This year's rain so far plus a normal rest of season: ${n0(rain.projectedMm!)} mm`}
            >
              At this year&apos;s pace: {n0(paceAuds)} AUDs
            </p>
          )}
        </div>
        <div className={cn('rounded-lg border p-3', surplus >= 0 ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50')}>
          <p className="text-xs text-gray-600">{surplus >= 0 ? 'Surplus' : 'Deficit'} vs herd</p>
          <p className={cn('mt-1 text-lg font-bold tabular-nums', surplus >= 0 ? 'text-green-800' : 'text-red-800')}>
            {surplus >= 0 ? '+' : ''}{n0(surplus)} <span className="text-sm font-normal opacity-70">AUDs</span>
          </p>
          <p className="mt-0.5 text-[11px] text-gray-500">Herd needs {n0(audsRequired)} AUDs</p>
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
              dashed lines are forage-yield bands
            </span>
          </div>
          <Suspense fallback={<p className="py-16 text-center text-sm text-gray-400">Loading chart…</p>}>
            <RainGraph series={measured.series} normal={measured.normal?.cumulative} />
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
          <table className={cn('w-full text-sm', detail ? 'min-w-[880px]' : 'min-w-[480px]')}>
            <thead>
              <tr className="border-b border-gray-200 text-left text-[11px] uppercase tracking-wide text-gray-500">
                <th className="px-2 py-2 font-medium">Pasture</th>
                {detail && <th className="px-2 py-2 text-right font-medium">Km²</th>}
                <th className="px-2 py-2 text-right font-medium">Acres</th>
                {detail && (
                  <>
                    <th className="px-2 py-2 text-right font-medium" title="Non-grazeable acres (island, riverbed, yard…)">Non-graz</th>
                    <th className="px-2 py-2 text-right font-medium" title="Irrigated field acres inside the pasture">Irrig ac</th>
                    <th className="px-2 py-2 text-right font-medium" title="Grazeable acres of the irrigated field">Graz irrig</th>
                    <th className="px-2 py-2 text-right font-medium" title="Acres − non-grazeable − irrigated">Native</th>
                  </>
                )}
                <th className="px-2 py-2 text-right font-medium" title="Grazeable irrigated + native grass">Grazeable</th>
                <th className="px-2 py-2 font-medium">Quality</th>
                {detail && (
                  <>
                    <th className="px-2 py-2 text-right font-medium" title="Forage supply after utilization (lbs/acre)">lb/ac</th>
                    <th className="px-2 py-2 text-right font-medium" title="Animal-unit months: 780 lb of forage each">AUMs</th>
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
                <tr key={p.id} className="border-b border-gray-100 last:border-0">
                  <td className="px-2 py-1.5">
                    <input
                      defaultValue={p.name}
                      disabled={!isManager}
                      onBlur={(e) => e.target.value !== p.name && patchP(p.id, { name: e.target.value })}
                      className="w-24 rounded-md border border-gray-200 px-1.5 py-1 text-sm font-medium disabled:border-transparent disabled:bg-transparent"
                    />
                  </td>
                  {detail && <td className="px-2 py-1.5 text-right"><NumCell value={p.km2} step="0.001" disabled={!isManager} onCommit={(v) => patchP(p.id, { km2: v })} className="w-16" /></td>}
                  <td className="px-2 py-1.5 text-right tabular-nums text-gray-500">{n0(p.acres)}</td>
                  {detail && (
                    <>
                      <td className="px-2 py-1.5 text-right"><NumCell value={p.non_grazeable_ac} step="0.1" disabled={!isManager} onCommit={(v) => patchP(p.id, { non_grazeable_ac: v })} /></td>
                      <td className="px-2 py-1.5 text-right"><NumCell value={p.irrigated_ac} step="1" disabled={!isManager} onCommit={(v) => patchP(p.id, { irrigated_ac: v })} /></td>
                      <td className="px-2 py-1.5 text-right"><NumCell value={p.grazeable_irrigated_ac} step="1" disabled={!isManager} onCommit={(v) => patchP(p.id, { grazeable_irrigated_ac: v })} /></td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-gray-500">{n0(p.nativeGrassAc)}</td>
                    </>
                  )}
                  <td className="px-2 py-1.5 text-right font-medium tabular-nums">{n0(p.totalGrazeableAc)}</td>
                  <td className="px-2 py-1.5">
                    <Select
                      value={p.grass_quality}
                      size="sm"
                      disabled={!isManager}
                      ariaLabel="Grass quality"
                      className="w-28"
                      onChange={(v) => patchP(p.id, { grass_quality: v })}
                      options={GRASS_QUALITIES.map((q) => ({ value: q, label: q }))}
                    />
                  </td>
                  {detail && (
                    <>
                      <td className="px-2 py-1.5 text-right tabular-nums text-gray-500">{n0(p.foragePerAcreUtil)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{n1(p.aums)}</td>
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
              ))}
              <tr className="border-t-2 border-gray-200 bg-gray-50 font-semibold">
                <td className="px-2 py-2">Total</td>
                {detail && <td />}
                <td className="px-2 py-2 text-right tabular-nums">{n0(totals.acres)}</td>
                {detail && <td colSpan={4} />}
                <td className="px-2 py-2 text-right tabular-nums">{n0(totals.grazeable)}</td>
                <td />
                {detail && (
                  <>
                    <td />
                    <td className="px-2 py-2 text-right tabular-nums">{n0(totals.aums)}</td>
                  </>
                )}
                <td className="px-2 py-2 text-right tabular-nums">{n0(totals.auds)}</td>
                {isManager && <td />}
              </tr>
            </tbody>
          </table>
          <HelpNote
            className="border-t border-gray-100 px-3 py-2"
            summary="Forage from the season's rain band and each pasture's grass quality."
            title="How pasture capacity is worked out"
          >
            <p>
              1 Animal Unit eats 26 lbs/day (AUM = 780 lbs). Forage supply is looked up from the season&apos;s
              precip band (the 10-year average when Auto) and each pasture&apos;s grass quality, then reduced by
              the utilization rate. The pasture is owned, so it carries no rent. Grey columns are calculated.
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
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-[11px] uppercase tracking-wide text-gray-500">
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
                  <td className="px-2 py-1.5 text-right"><NumCell value={h.au_equivalent} step="0.05" disabled={!isManager} onCommit={(v) => patchH(h.id, { au_equivalent: v })} /></td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-gray-600" title="Set on the Herd tab">{n0(h.head_count)}</td>
                  <td className="px-2 py-1.5 text-right font-medium tabular-nums">{n1(h.totalAU)}</td>
                  <td className="px-2 py-1.5">
                    <DateField value={h.graze_start ?? ''}
                      onChange={(v) => v !== (h.graze_start ?? '') && patchH(h.id, { graze_start: v || null })}
                      ariaLabel="Graze start" className="min-w-[9rem]" />
                  </td>
                  <td className="px-2 py-1.5">
                    <DateField value={h.graze_end ?? ''}
                      onChange={(v) => v !== (h.graze_end ?? '') && patchH(h.id, { graze_end: v || null })}
                      ariaLabel="Graze end" className="min-w-[9rem]" />
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-gray-500">{h.days}</td>
                  <td className="px-2 py-1.5 text-right font-medium tabular-nums">{n0(h.audsRequired)}</td>
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
          </HelpNote>
        </div>
      </section>

    </div>
  )
}

