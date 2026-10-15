import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { CloudSun, Droplets, RefreshCw, TrendingUp } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { useRotationContext } from '@/lib/rotation-context'
import { CHU_NEED, type buildPlan } from '@/lib/rotation-engine'
import { cn } from '@/lib/utils'
import { InfoPopover } from '@/components/InfoPopover'
import { useFarmSettings, useFeature } from '@/lib/farm-setup'
import { WaterSupplyList } from './WaterSupply'

type Ctx = Extract<ReturnType<typeof useRotationContext>, { ready: true }>
type Plan = ReturnType<typeof buildPlan>
type Water = ReturnType<Ctx['waterFor']>

const n0 = (v: number) => Math.round(v).toLocaleString('en-CA')
const md = (iso: string | null | undefined) =>
  iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '—'

type CansipsWindow = { temp_above: number | null; temp_below: number | null; precip_above: number | null; precip_below: number | null; issued: string | null }
type Outlook = { plan_year?: number; cansips?: Record<string, CansipsWindow>; seas5?: { month: string; temp_anom_c: number; precip_anom_mm: number }[]; chu_shift?: number | null }

/** How a three-way CanSIPS split reads: only a lean past 40% is said to be one. */
function lean(above: number | null, below: number | null, up: string, down: string): string {
  if (above == null || below == null) return 'no outlook'
  if (above >= 40 && above > below) return `leaning ${up} (${Math.round(above)}% chance)`
  if (below >= 40 && below > above) return `leaning ${down} (${Math.round(below)}% chance)`
  return `no clear lean (${Math.round(above)}% ${up}, ${Math.round(below)}% ${down})`
}

/**
 * The season ahead, beside the recommendations: the water the plan has to
 * live inside (with a dry-year what-if), what the reservoirs and snowpack
 * say about it, heat units and the seasonal outlook, and where each crop's
 * margin comes from.
 */
export function SeasonAhead({
  ctx,
  year,
  plan,
  water,
  whatIf,
  setWhatIf,
  coolSummer,
  setCoolSummer,
  minAcres,
  feed,
  fieldIds,
  fieldNames,
  isManager,
}: {
  ctx: Ctx
  year: number
  plan: Plan
  water: Water
  whatIf: number | null
  setWhatIf: (v: number | null) => void
  coolSummer: boolean
  setCoolSummer: (v: boolean) => void
  minAcres: Map<string, { acres: number; bushels: number }>
  /** The herd's winter feed from this crop year, per crop (Cattle → Feed). */
  feed: ReturnType<Ctx['feedMinimums']>
  fieldIds: string[]
  /** field id → name, for the fields with no water right on file. */
  fieldNames: Map<string, string>
  isManager: boolean
}) {
  const [refreshing, setRefreshing] = useState<string | null>(null)
  const qc = useQueryClient()
  const { districtName } = useFarmSettings()
  // The what-if is about the district's allotment; without one there is nothing to vary.
  const districtOn = useFeature('district_allotment')

  // --- water supply signals
  const reservoirs = ctx.waterSupply.filter((w) => w.kind === 'reservoir')
  const snow = ctx.waterSupply.filter((w) => w.kind === 'snow')
  const smridDown = reservoirs.filter((r) => r.feeds === 'SMRID' && r.pct_full != null && r.pct_full_last_year != null && Number(r.pct_full) < Number(r.pct_full_last_year) - 10)
  const lowSnow = snow.filter((s) => s.pct_of_median != null && Number(s.pct_of_median) < 80)
  const shortYear = smridDown.length > 0 || lowSnow.length > 0

  // --- climate for the cells these fields sit in
  const cells = new Map<string, Ctx['climate'][number]>()
  for (const id of fieldIds) {
    const c = ctx.climateByField.get(id)
    if (c) cells.set(c.cell_key, c)
  }
  const cellList = [...cells.values()]
  const outlook = (cellList[0]?.outlook ?? null) as Outlook | null
  const summer = outlook?.plan_year === year ? outlook.cansips?.['06'] : undefined

  const refresh = async () => {
    setRefreshing('Starting…')
    const {
      data: { session },
    } = await supabase.auth.getSession()
    const res = await fetch('/.netlify/functions/season-outlook-background', { method: 'POST', headers: { Authorization: `Bearer ${session?.access_token ?? ''}` } })
    const started = res.ok || res.status === 202
    setRefreshing(started ? 'Refreshing in the background — this panel updates in a minute or two.' : `Could not start (${res.status})`)
    // The rotation data is cached for ten minutes; pull it again once the job has had time to write.
    if (started) for (const ms of [60_000, 120_000]) setTimeout(() => void qc.invalidateQueries({ queryKey: ['rotation-context'] }), ms)
  }

  const noRight = water.noRight.filter((id) => fieldIds.includes(id) && fieldNames.has(id))
  const smridOwn = water.smridSetFor != null ? ctx.waterFor(year, new Map(), null).smridInches : null

  return (
    <div className="grid gap-2 lg:grid-cols-2">
      {/* Water */}
      <div className="rounded-md border border-sky-200 bg-white p-2 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <Droplets className="h-4 w-4 text-sky-600" />
          <h4 className="font-semibold text-gray-900">Water for {year}</h4>
          <InfoPopover title="How the water budget works" width={360}>
            <p>
              Inches over the irrigated acres. Crop needs are average-year estimates, editable per crop below; every plan above stays
              inside what each source has.
            </p>
          </InfoPopover>
          {districtOn && (
          <label className="ml-auto flex items-center gap-1 text-gray-600">
            {districtName} allotment
            <select
              value={whatIf ?? ''}
              onChange={(e) => setWhatIf(e.target.value === '' ? null : Number(e.target.value))}
              className="rounded border border-gray-300 px-1 py-0.5"
              aria-label={`${districtName} allotment what-if`}
            >
              <option value="">{smridOwn != null ? `${smridOwn}" (on file)` : 'on file'}</option>
              {[8, 10, 12, 14, 17, 18].map((v) => (
                <option key={v} value={v}>
                  {v}" what-if
                </option>
              ))}
            </select>
          </label>
          )}
        </div>
        <table className="mt-1.5 w-full">
          <thead className="text-left text-[10px] uppercase tracking-wide text-gray-400">
            <tr>
              <th className="py-0.5 font-medium">Source</th>
              <th className="py-0.5 pl-3 text-right font-medium">Acres</th>
              <th className="py-0.5 pl-4 text-right font-medium">Has</th>
              <th className="py-0.5 pl-4 text-right font-medium">Plan needs</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {water.sources.map((s) => {
              const need = plan.water.get(s.key) ?? 0
              const has = s.acreInches
              const over = has > 0 && need > has + 0.5
              return (
                <tr key={s.key}>
                  <td className="py-1 text-gray-800">
                    {/* The fields are what mean something; the licence number is the reference. */}
                    {[...water.byField].filter(([, v]) => v.source === s.key).map(([id]) => fieldNames.get(id) ?? ctx.pivotFieldNames.get(id) ?? 'unnamed field').sort((a, b) => a.localeCompare(b, 'en', { numeric: true })).join(', ') || s.label}
                    <span className="block text-[10px] text-gray-400">
                      {s.label} · {s.basis}
                    </span>
                  </td>
                  <td className="py-1 pl-3 text-right tabular-nums text-gray-600">{n0(s.acres)}</td>
                  <td className="py-1 pl-4 text-right tabular-nums text-gray-700">{s.acres > 0 && has > 0 ? `${(has / s.acres).toFixed(1)}"` : '—'}</td>
                  <td className={cn('py-1 text-right tabular-nums', over ? 'font-semibold text-red-700' : 'text-gray-800')}>
                    {s.acres > 0 ? `${(need / s.acres).toFixed(1)}"` : '—'}
                    {over && <span className="block text-[10px]">short {n0((need - has) / 12)} ac-ft</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {noRight.length > 0 && (
          <p className="mt-1 rounded bg-gray-50 px-1.5 py-1 text-[11px] text-gray-600">
            No {districtName} parcel or licence on file for {noRight.map((id) => fieldNames.get(id)).join(', ')} — not limited here. Add the licence on the
            Irrigation page to bring them into the budget.
          </p>
        )}

        <div className="mt-2 space-y-0.5 border-t border-gray-100 pt-1.5 text-[11px] text-gray-700">
          <WaterSupplyList rows={ctx.waterSupply.filter((w) => w.kind === 'reservoir' || w.kind === 'snow')} />
          {!reservoirs.length && !snow.length && <p className="text-gray-400">No reservoir or snow readings yet{isManager ? ' — refresh the outlook below.' : '.'}</p>}
          {shortYear && (
            <p className="mt-1 rounded bg-amber-50 px-1.5 py-1 text-amber-900">
              {smridDown.length ? `${smridDown.map((r) => r.name).join(', ')} well below last year. ` : ''}
              {lowSnow.length ? `Snowpack under 80% of median. ` : ''}
              Worth checking the plan against a short year —{' '}
              <button type="button" onClick={() => setWhatIf(10)} className="font-semibold underline">
                try 10&quot;
              </button>
              .
            </p>
          )}
          {ctx.notices.length > 0 && (
            <p className="pt-1 text-gray-600">
              {districtName}:{' '}
              {ctx.notices.slice(0, 2).map((n, i) => (
                <span key={n.observed_on + n.name}>
                  {i > 0 && ' · '}
                  <a href={n.url ?? '#'} target="_blank" rel="noreferrer" className="text-sky-700 underline">
                    {n.name}
                  </a>{' '}
                  <span className="text-gray-400">({md(n.observed_on)})</span>
                </span>
              ))}
            </p>
          )}
        </div>
      </div>

      {/* Heat and outlook */}
      <div className="rounded-md border border-amber-200 bg-white p-2 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <CloudSun className="h-4 w-4 text-amber-600" />
          <h4 className="font-semibold text-gray-900">Heat, frost and the {year} outlook</h4>
          <InfoPopover title="Where these figures come from" width={380}>
            <p>
              Corn heat units from 15 May to the first −2 °C frost; the earliest corn wants about {n0(CHU_NEED.corn!)}, dry beans about{' '}
              {n0(CHU_NEED.dry_bean!)}. Twenty years of ERA5 weather — a regional figure, so low spots run cooler.
            </p>
            <p>
              The June–August outlook is Environment and Climate Change Canada&apos;s CanSIPS seasonal forecast, which reaches about ten
              months ahead. The heat-unit adjustment comes from ECMWF&apos;s SEAS5 seasonal forecast.
            </p>
            <p>A summer outlook this far out is right a little more often than a coin — a reason to check the plan, not to change it.</p>
          </InfoPopover>
          <label className="ml-auto flex items-center gap-1 text-gray-600">
            <input type="checkbox" checked={coolSummer} onChange={(e) => setCoolSummer(e.target.checked)} />
            Plan for a cool summer
          </label>
        </div>
        {cellList.length === 0 ? (
          <p className="mt-2 text-gray-400">No heat-unit history yet{isManager ? ' — refresh the outlook below.' : '.'}</p>
        ) : (
          <table className="mt-1.5 w-full">
            <thead className="text-left text-[10px] uppercase tracking-wide text-gray-400">
              <tr>
                <th className="py-0.5 font-medium">Area</th>
                <th className="py-0.5 text-right font-medium">Heat units</th>
                <th className="py-0.5 text-right font-medium">Cool year</th>
                <th className="py-0.5 text-right font-medium">Frost-free</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {cellList.map((c) => (
                <tr key={c.cell_key}>
                  <td className="py-1 text-gray-700">
                    {Number(c.lat).toFixed(2)}°, {Number(c.lon).toFixed(2)}°
                    <span className="block text-[10px] text-gray-400">
                      {c.years_from}–{c.years_to}
                    </span>
                  </td>
                  <td className="py-1 text-right tabular-nums text-gray-800">{c.chu_median != null ? n0(Number(c.chu_median)) : '—'}</td>
                  <td className="py-1 text-right tabular-nums text-gray-600">{c.chu_p20 != null ? n0(Number(c.chu_p20)) : '—'}</td>
                  <td className="py-1 text-right tabular-nums text-gray-600">
                    {c.ffd_median != null ? `${Math.round(Number(c.ffd_median))} d` : '—'}
                    <span className="block text-[10px] text-gray-400">
                      {md(c.spring_frost_median)} – {md(c.fall_frost_median)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="mt-2 space-y-0.5 border-t border-gray-100 pt-1.5 text-[11px] text-gray-700">
          {summer ? (
            <>
              <p>
                <b>June–August {year}</b> (seasonal forecast, issued {md(summer.issued)}): temperature {lean(summer.temp_above, summer.temp_below, 'warm', 'cool')}; rain{' '}
                {lean(summer.precip_above, summer.precip_below, 'wet', 'dry')}.
              </p>
              {outlook?.chu_shift != null && (
                <p>
                  A second seasonal forecast reaches into that summer: about {outlook.chu_shift >= 0 ? '+' : '−'}
                  {n0(Math.abs(outlook.chu_shift))} heat units on normal, already in the plan.
                </p>
              )}
            </>
          ) : (
            <p className="text-gray-400">No seasonal outlook for {year} yet — the seasonal forecast reaches about ten months ahead.</p>
          )}
        </div>
      </div>

      {/* Margins */}
      <div className="rounded-md border border-emerald-200 bg-white p-2 text-xs lg:col-span-2">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-emerald-600" />
          <h4 className="font-semibold text-gray-900">Where the {year} margins come from</h4>
          <InfoPopover title="How the margins are built" width={380}>
            <p>
              Each field uses its own yield history where it has one. Prices: a contract, then your target price for {year} (crop page),
              then the latest Alberta farm-gate price, then your last target. Costs: the crop&apos;s input budget. Land, water and
              machinery are left out.
            </p>
          </InfoPopover>
        </div>
        <div className="mt-1.5 overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead className="text-left text-[10px] uppercase tracking-wide text-gray-400">
              <tr>
                <th className="py-0.5 font-medium">Crop</th>
                <th className="py-0.5 text-right font-medium">Yield</th>
                <th className="py-0.5 text-right font-medium">Price</th>
                <th className="py-0.5 text-right font-medium">Cost / ac</th>
                <th className="py-0.5 text-right font-medium">Margin / ac</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {ctx.cropInfo
                .filter((c) => c.key !== 'other' && !c.renterOnly)
                .map((c) => {
                  const b = ctx.marginBasis(c.id, year)
                  const k = minAcres.get(c.id)
                  const fm = feed.get(c.id)
                  const short = plan.shortOfContract.get(c.id)
                  const sister = ctx.sisterValue.get(c.id)
                  return (
                    <tr key={c.id}>
                      <td className="py-1 text-gray-800">
                        {c.name}
                        {b.ownUse && <span className="ml-1 rounded bg-emerald-50 px-1 text-[10px] text-emerald-800">own feed</span>}
                        {k && (
                          <span className={cn('block text-[10px]', short && !fm ? 'text-red-700' : 'text-gray-500')}>
                            {n0(k.bushels)} {b.unit} contracted → {n0(k.acres)} ac{short && !fm ? `, ${n0(short)} ac short` : ''}
                          </span>
                        )}
                        {fm && (
                          <span className={cn('block text-[10px]', short ? 'text-red-700' : 'text-emerald-800')}>
                            Herd&apos;s {year}–{String(year + 1).slice(2)} winter: {n0(fm.tonnes)} t
                            {fm.acres != null ? ` → ${n0(fm.acres)} ac` : ' — no yield to size the acres'}
                            {short ? `, ${n0(short)} ac short` : ''}
                          </span>
                        )}
                        {sister && (
                          <span className="block text-[10px] text-violet-700" title={sister.note ?? undefined}>
                            {sister.perAcre != null ? `+ $${n0(sister.perAcre)}/ac to a sister company, not in this margin` : sister.note}
                          </span>
                        )}
                      </td>
                      <td className="py-1 text-right tabular-nums text-gray-700">
                        {b.yield != null ? `${b.yield < 20 ? b.yield.toFixed(1) : n0(b.yield)} ${b.unit}` : '—'}
                        <span className="block text-[10px] text-gray-400">{b.yieldFrom}</span>
                      </td>
                      <td className="py-1 text-right tabular-nums text-gray-700">
                        {b.price != null ? `$${b.price < 1 ? b.price.toFixed(3) : b.price.toFixed(2)}` : '—'}
                        <span className="block text-[10px] text-gray-400">{b.priceFrom}</span>
                      </td>
                      <td className="py-1 text-right tabular-nums text-gray-700">
                        {b.cost != null ? `$${n0(b.cost)}` : '—'}
                        <span className="block text-[10px] text-gray-400">{b.costFrom}</span>
                      </td>
                      <td className={cn('py-1 text-right font-semibold tabular-nums', b.margin != null && b.margin < 0 ? 'text-red-700' : 'text-gray-900')}>
                        {b.margin != null ? `${b.margin < 0 ? '−' : ''}$${n0(Math.abs(b.margin))}` : '—'}
                        <span className="block text-[10px] font-normal text-gray-400">{b.from === 'built' ? (b.ownUse ? 'yield × feed value − cost' : 'yield × price − cost') : b.from === 'budget' ? 'margin typed on the crop' : b.ownUse ? 'own feed — set its value' : 'nothing on file'}</span>
                      </td>
                    </tr>
                  )
                })}
            </tbody>
          </table>
        </div>
      </div>

      {isManager && (
        <div className="flex items-center gap-2 text-[11px] text-gray-500 lg:col-span-2">
          <button type="button" onClick={refresh} className="inline-flex items-center gap-1 rounded border border-gray-300 bg-white px-2 py-0.5 font-medium text-gray-700 hover:bg-gray-50">
            <RefreshCw className="h-3 w-3" /> Refresh the outlook
          </button>
          {refreshing ?? `Refreshes itself on the 1st and 15th: heat units, reservoirs, snowpack, ${districtName} notices and the seasonal outlook.`}
        </div>
      )}
    </div>
  )
}
