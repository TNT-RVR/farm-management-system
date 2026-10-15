import { useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, CalendarClock, ChevronDown } from 'lucide-react'
import { InfoPopover } from '@/components/InfoPopover'
import { SETUP_LINKS, SetupLink } from '@/components/SetupLink'
import { ColumnHelp } from '@/components/ColumnHelp'
import { PLAN_HELP } from '@/lib/irrigation-overview-help'
import { supabase } from '@/lib/supabase'
import { useCropPlans, useCrops, useFields } from '@/lib/queries'
import { useAllCropZones } from '@/lib/cropZones'
import { STATUS_COLOR, STATUS_LABEL, useFieldPivots, useFieldSeasons, usePumps } from '@/lib/irrigation'
import {
  edmontonWallMs,
  fmtWallDay,
  fmtWallTime,
  isoOfWall,
  PLAN_RULES,
  planField,
  plannerSummary,
  pumpClashes,
  sortPlans,
  wallOfDate,
  type FieldPlan,
  type PlanBalance,
  type PlanPivot,
  type PlanWeather,
} from '@/lib/irrigation-planner'
import { conv, useUnitSystem, type UnitSystem } from '@/lib/units'
import { cn } from '@/lib/utils'

const DAY = 86_400_000
const PAGE = 1000

/** A FieldNET raw value as a number: they arrive as numbers or numeric strings. */
const n = (v: unknown): number | null => {
  if (v == null || v === '') return null
  const x = Number(v)
  return Number.isFinite(x) ? x : null
}

/**
 * The balance the plan needs: the last fortnight of actual days (for the
 * recent ETc) and the forecast after them, for every field at once. PostgREST
 * stops at 1000 rows, and a zoned farm passes that, so it is read in pages on
 * an order that is unique per row.
 */
function usePlannerBalance(today: string, year: number) {
  return useQuery({
    queryKey: ['irrigation_planner', 'balance', today, year],
    queryFn: async () => {
      const fortnight = isoOfWall(wallOfDate(today) - 14 * DAY)
      const since = fortnight > `${year}-01-01` ? fortnight : `${year}-01-01`
      const rows: PlanBalance[] = []
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase
          .from('water_balance_daily')
          .select('field_id, zone_id, date, is_forecast, avail_100_mm, taw_mm, raw_mm, etc_mm, status')
          .gte('date', since)
          .lte('date', `${year}-12-31`)
          .order('field_id')
          .order('zone_id', { nullsFirst: true })
          .order('date')
          .range(from, from + PAGE - 1)
        if (error) throw error
        rows.push(...data)
        if (data.length < PAGE) break
      }
      return rows
    },
  })
}

/** Each linked pivot's lap at 100%, depth at 100%, arc and measured correction. */
function usePlannerSystems() {
  return useQuery({
    queryKey: ['irrigation_planner', 'fieldnet_systems'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('fieldnet_systems')
        .select('field_id, name, arc_start_deg, arc_end_deg, depth_correction, run100:raw->run_time_100_percent, depth100:raw->application_depth_at_full_speed')
        .not('field_id', 'is', null)
        .order('name')
      if (error) throw error
      return data
    },
  })
}

/** Rain and its chance at each station the plan's fields use, today onward. */
function usePlannerWeather(stationIds: string[], today: string) {
  return useQuery({
    queryKey: ['irrigation_planner', 'weather', stationIds, today],
    enabled: stationIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('weather_daily')
        .select('station_id, date, precip_mm, precip_prob')
        .in('station_id', stationIds)
        .gte('date', today)
        .lte('date', isoOfWall(wallOfDate(today) + 10 * DAY))
        .order('date')
      if (error) throw error
      const by = new Map<string, PlanWeather[]>()
      for (const r of data) {
        const list = by.get(r.station_id) ?? []
        list.push({ date: r.date, precip_mm: r.precip_mm, precip_prob: r.precip_prob })
        by.set(r.station_id, list)
      }
      return by
    },
  })
}

type Row = { plan: FieldPlan; name: string; crop: string | null; zone: string | null }

const ADVICE_COLOR: Record<FieldPlan['advice']['kind'], string> = {
  hold: 'bg-sky-100 text-sky-900',
  watch: 'bg-amber-100 text-amber-900',
  irrigate: 'bg-red-100 text-red-800',
  none: 'bg-green-50 text-green-800',
}

function adviceText(p: FieldPlan, u: UnitSystem) {
  const unit = conv.depthUnit(u)
  const a = p.advice
  switch (a.kind) {
    case 'hold':
      return `Hold — ${a.prob != null ? `${Math.round(a.prob)}% chance of ` : ''}${conv.depth(a.mm, u, u === 'metric' ? 0 : 2)} ${unit}${a.byDay ? ` by ${fmtWallDay(wallOfDate(a.byDay))}` : ''}`
    case 'watch':
      return `Watch the forecast — ${Math.round(a.prob)}% chance of ${conv.depth(a.mm, u, u === 'metric' ? 0 : 2)} ${unit} ${fmtWallDay(wallOfDate(a.day))}`
    case 'irrigate':
      return 'Irrigate'
    case 'none':
      return 'No water needed this week'
  }
}

/** A header with its "what is this?" button. */
function PlanTh({ help, children }: { help: keyof typeof PLAN_HELP; children: ReactNode }) {
  return (
    <th className="py-0.5 pr-2 font-medium">
      <span className="inline-flex items-center gap-0.5">
        {children}
        <ColumnHelp help={PLAN_HELP[help]} width={360} />
      </span>
    </th>
  )
}

/** A cell's label, shown only when the row is stacked on a phone. */
function Lbl({ children }: { children: ReactNode }) {
  return <span className="block text-[10px] uppercase tracking-wide text-gray-400 sm:hidden">{children}</span>
}

function PlanRules({ u }: { u: UnitSystem }) {
  const unit = conv.depthUnit(u)
  const r = PLAN_RULES
  return (
    <InfoPopover title="How the plan is worked out">
      <p>
        <b>Trigger</b> is the available water at which the crop starts to need it: field capacity over the root zone less the readily available water (TAW − RAW).{' '}
        <b>Days of water left</b> is the water above the trigger divided by the last {r.etcDays} days&apos; average crop water use (ETc).
      </p>
      <p>
        <b>Crosses</b> is the first forecast day the balance reaches the trigger if nothing is applied, placed within the day by how far each day sits from it. Past the
        forecast&apos;s end (about a week) it runs on at the recent ETc and is marked extrapolated.
      </p>
      <p>
        <b>Start by</b> = crossing − one lap. The pass is planned to refill to field capacity from where the soil will be when the pivot starts (the deficit at the trigger, or
        today&apos;s if already past it), divided by the pivot&apos;s efficiency (default {r.defaultEfficiency}) and capped at {conv.depth(r.maxPassGrossMm, u, 0)} {unit} gross. From
        FieldNET: speed = depth at 100% × the pivot&apos;s depth correction ÷ that depth (kept between {r.minSpeed * 100}% and {r.maxSpeed * 100}%), and the lap = the 100% lap time ÷
        speed, scaled to the arc a part-circle pivot sweeps. A pivot FieldNET doesn&apos;t describe uses Setup&apos;s time to full circle.
      </p>
      <p>
        <b>Rain</b>: expected rain over the next {r.rainWindowH} h = Σ chance × forecast depth for each day (part days counted in part).{' '}
        <b>Hold</b> when that is at least {r.holdShare * 100}% of the net depth the pass would put down. <b>Watch the forecast</b> when a day before the start-by has at least a{' '}
        {r.watchProb}% chance of {conv.depth(r.watchMm, u, u === 'metric' ? 0 : 1)} {unit} or more. Otherwise <b>Irrigate</b>, or <b>No water needed this week</b> when the start-by is
        more than {r.horizonDays} days off. Days without a chance figure yet don&apos;t count towards a hold.
      </p>
      <p>
        <b>Shares a pump</b>: two fields on one pump that both have to start within 24 h — stagger them, or neither lap runs at full flow. A zoned field is planned from its
        driest zone.
      </p>
    </InfoPopover>
  )
}

function PlanRow({ row, u, nowMs, clash, onPickField }: { row: Row; u: UnitSystem; nowMs: number; clash: string[]; onPickField?: (fieldId: string) => void }) {
  const { plan: p } = row
  const unit = conv.depthUnit(u)
  const dp = u === 'metric' ? 0 : 1
  const past = p.crossing.kind === 'now'
  const late = p.startByMs != null && p.startByMs <= nowMs
  const beyondWeek = p.crossing.ms != null && p.crossing.ms > nowMs + PLAN_RULES.horizonDays * DAY
  return (
    <tr className="grid grid-cols-2 gap-x-3 gap-y-1.5 py-2 sm:table-row sm:py-0">
      <td className="col-span-2 align-top sm:py-1.5 sm:pr-2">
        <button type="button" onClick={() => onPickField?.(p.fieldId)} className="text-left font-medium text-brand-700 hover:underline">
          {row.name}
        </button>
        {row.crop && <span className="block text-gray-500">{row.crop}</span>}
        {row.zone && <span className="block text-[11px] text-gray-400">driest zone: {row.zone}</span>}
      </td>
      <td className="align-top sm:py-1.5 sm:pr-2">
        <Lbl>Status</Lbl>
        <span className={cn('inline-block whitespace-nowrap rounded-full px-2 py-0.5 font-medium', STATUS_COLOR[p.status ?? 'ok'])}>{STATUS_LABEL[p.status ?? 'ok'] ?? p.status}</span>
      </td>
      <td className="align-top tabular-nums sm:py-1.5 sm:pr-2" title="Water the crop can still use in its root zone now / the level at which it needs irrigating">
        <Lbl>Water / trigger</Lbl>
        {conv.depth(p.availMm, u, dp)} <span className="text-gray-400">/ {conv.depth(p.thresholdMm, u, dp)} {unit}</span>
        <span className="block text-[11px] text-gray-500">
          {past
            ? 'past the trigger'
            : p.daysLeft != null
              ? p.daysLeft < 1
                ? 'under a day of water left'
                : `${Math.round(p.daysLeft)} day${Math.round(p.daysLeft) === 1 ? '' : 's'} of water left`
              : 'no recent crop-use figure'}
        </span>
      </td>
      <td className="align-top sm:py-1.5 sm:pr-2">
        <Lbl>Crosses trigger</Lbl>
        {p.crossing.kind === 'now' ? (
          <span className="font-medium text-red-700">already</span>
        ) : p.crossing.kind === 'forecast' ? (
          <span className="font-medium">{fmtWallDay(p.crossing.ms)}</span>
        ) : p.crossing.kind === 'extrapolated' ? (
          <span className="text-gray-600">
            {beyondWeek && <span className="block">not in the next 7 days</span>}
            <span className="text-[11px] text-gray-500">~{fmtWallDay(p.crossing.ms)} (extrapolated)</span>
          </span>
        ) : (
          <span className="text-gray-400">{p.thresholdMm == null ? '—' : 'not in the next 7 days'}</span>
        )}
      </td>
      <td className="align-top sm:py-1.5 sm:pr-2">
        <Lbl>Start by</Lbl>
        {p.crossing.ms == null ? (
          <span className="text-gray-400">—</span>
        ) : p.startByMs == null ? (
          <span className="text-gray-500">
            lap time unknown
            <span className="block text-[11px] text-gray-400">start well before {fmtWallDay(p.crossing.ms)}</span>
          </span>
        ) : (
          <>
            <span className={cn('font-medium', late ? 'text-red-700' : !p.needsWater && 'text-gray-500')}>
              {late ? 'Now' : `${p.crossing.kind === 'extrapolated' ? '~' : ''}${fmtWallTime(p.startByMs)}`}
            </span>
            {late && !past && <span className="text-[11px] text-red-700"> ({Math.round((nowMs - p.startByMs) / 3_600_000)} h late)</span>}
            <span className="block text-[11px] text-gray-500">
              {p.lap.source === 'fieldnet'
                ? `${Math.round(p.lap.lapHours!)} h lap at ${Math.round(p.lap.speedPct!)}% → ${conv.depth(p.lap.appliedGrossMm, u, u === 'metric' ? 0 : 2)} ${unit}`
                : p.lap.source === 'pivot'
                  ? `${Math.round(p.lap.lapHours!)} h lap (Setup)`
                  : 'lap time unknown'}
              {p.lap.arc < 1 && ` · ${Math.round(p.lap.arc * 360)}° arc`}
            </span>
          </>
        )}
      </td>
      <td className="col-span-2 align-top sm:py-1.5">
        <Lbl>Advice</Lbl>
        <span className={cn('inline-block rounded px-1.5 py-0.5 font-medium', ADVICE_COLOR[p.advice.kind])}>{adviceText(p, u)}</span>
        {p.advice.kind === 'irrigate' && p.advice.rainUnknown && <span className="block text-[11px] text-gray-400">rain chance not in yet for a wet day</span>}
        {clash.map((c) => (
          <span key={c} className="mt-0.5 flex items-center gap-1 text-[11px] text-amber-800">
            <AlertTriangle className="h-3 w-3 shrink-0" /> {c}
          </span>
        ))}
      </td>
    </tr>
  )
}

/**
 * This week's irrigation plan: every field with a season, most urgent first —
 * when it reaches its trigger, when its pivot must start to finish a lap
 * before then, and whether the rain forecast makes it worth waiting.
 */
export function IrrigationPlanner({ year, onPickField }: { year: number; onPickField?: (fieldId: string) => void }) {
  const u = useUnitSystem()
  const [nowMs] = useState(() => edmontonWallMs(new Date()))
  const today = isoOfWall(nowMs)
  const [open, setOpen] = useState(true)

  const { data: fields } = useFields()
  const { data: seasons, isLoading: seasonsLoading } = useFieldSeasons(year)
  const { data: plans } = useCropPlans(year)
  const { data: crops } = useCrops()
  const { data: zones } = useAllCropZones()
  const { data: fieldPivots } = useFieldPivots()
  const { data: pumps } = usePumps()
  const { data: systems } = usePlannerSystems()
  const { data: balance, isLoading: balanceLoading, error } = usePlannerBalance(today, year)

  // Fields in the plan: active, with a season this year that isn't finished.
  const { planFields, doneCount } = useMemo(() => {
    const byField = new Map<string, { live: boolean }>()
    for (const s of seasons ?? []) {
      if (!s.active) continue
      const e = byField.get(s.field_id) ?? { live: false }
      if (!s.irrigation_done_at) e.live = true
      byField.set(s.field_id, e)
    }
    const list = (fields ?? []).filter((f) => byField.get(f.id)?.live)
    const done = (fields ?? []).filter((f) => byField.has(f.id) && !byField.get(f.id)!.live).length
    return { planFields: list, doneCount: done }
  }, [fields, seasons])

  const stationIds = useMemo(
    () => [...new Set(planFields.map((f) => f.assigned_station_id).filter((x): x is string => Boolean(x)))].sort(),
    [planFields],
  )
  const { data: weather } = usePlannerWeather(stationIds, today)

  const rows = useMemo<Row[]>(() => {
    if (!balance) return []
    const byField = new Map<string, PlanBalance[]>()
    for (const r of balance) {
      const list = byField.get(r.field_id) ?? []
      list.push(r)
      byField.set(r.field_id, list)
    }
    const cropName = (id: string | null | undefined) => crops?.find((c) => c.id === id)?.name ?? null
    const out: Row[] = []
    for (const f of planFields) {
      const sys = systems?.find((s) => s.field_id === f.id)
      const fp = fieldPivots?.find((p) => p.field_id === f.id)
      const pivot: PlanPivot | null =
        sys || fp
          ? {
              run100S: n(sys?.run100),
              depth100In: n(sys?.depth100),
              arcStartDeg: sys?.arc_start_deg ?? null,
              arcEndDeg: sys?.arc_end_deg ?? null,
              depthCorrection: n(sys?.depth_correction),
              timeToFullCircleH: n(fp?.time_to_full_circle_h),
              efficiency: n(fp?.application_efficiency),
            }
          : null
      const plan = planField({
        fieldId: f.id,
        rows: byField.get(f.id) ?? [],
        pivot,
        weather: (f.assigned_station_id && weather?.get(f.assigned_station_id)) || [],
        nowMs,
      })
      if (!plan) continue
      const planted = (plans ?? [])
        .filter((p) => p.field_id === f.id)
        .sort((a, b) => Number(b.planned_acres ?? 0) - Number(a.planned_acres ?? 0))
        .map((p) => cropName(p.crop_id))
        .filter((x): x is string => Boolean(x))
      const zone = plan.zoneId ? (cropName(zones?.find((z) => z.id === plan.zoneId)?.crop_id) ?? 'unnamed zone') : null
      out.push({ plan, name: f.name, crop: planted.length ? [...new Set(planted)].join(', ') : null, zone })
    }
    const order = sortPlans(
      out.map((r) => r.plan),
      nowMs,
    )
    return order.map((p) => out.find((r) => r.plan === p)!)
  }, [balance, planFields, systems, fieldPivots, weather, plans, crops, zones, nowMs])

  const clashes = useMemo(() => {
    const pumpOf = (id: string) => fieldPivots?.find((p) => p.field_id === id)?.pump_id
    const raw = pumpClashes(
      rows.map((r) => r.plan),
      pumpOf,
      nowMs,
    )
    const nameOf = new Map(rows.map((r) => [r.plan.fieldId, r.name]))
    const text = new Map<string, string[]>()
    for (const [fid, list] of raw) {
      text.set(
        fid,
        list.map((c) => `shares ${pumps?.find((p) => p.id === c.pumpId)?.name ?? 'a pump'} with ${nameOf.get(c.otherFieldId) ?? 'another field'} — stagger the starts`),
      )
    }
    return text
  }, [rows, fieldPivots, pumps, nowMs])

  const summary = plannerSummary(
    rows.map((r) => r.plan),
    nowMs,
  )
  const nextName = summary.next ? rows.find((r) => r.plan === summary.next)?.name : null
  const asOf = rows.length ? rows.map((r) => r.plan.asOf).sort()[0] : null
  const loading = balanceLoading || seasonsLoading

  const headline = loading
    ? 'Working out the week…'
    : summary.count === 0
      ? 'No field needs water this week'
      : `${summary.count} field${summary.count === 1 ? ' needs' : 's need'} water this week; ` +
        (summary.next && summary.nextMs != null
          ? `next start: ${nextName} ${summary.nextMs <= nowMs ? 'now' : `by ${fmtWallTime(summary.nextMs)}`}`
          : 'rain may cover them — watch the forecast')

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-3">
      <div className="flex items-start gap-1.5">
        <button type="button" onClick={() => setOpen((o) => !o)} className="flex min-w-0 flex-1 items-start gap-1.5 text-left" aria-expanded={open}>
          <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-brand-700" />
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-gray-800">This week&apos;s irrigation plan</span>
            <span className={cn('block text-xs', summary.count > 0 && !loading ? 'text-gray-700' : 'text-gray-500')}>{headline}</span>
          </span>
          <ChevronDown className={cn('ml-auto mt-0.5 h-4 w-4 shrink-0 text-gray-400 transition-transform', !open && '-rotate-90')} />
        </button>
        <PlanRules u={u} />
      </div>
      {open && (
        <div className="mt-2">
          {error ? (
            <p className="text-xs text-red-700">{(error as Error).message}</p>
          ) : loading ? (
            <p className="py-3 text-center text-xs text-gray-400">Reading the water balance…</p>
          ) : rows.length === 0 ? (
            <p className="text-xs text-gray-500">
              No {year} field has a water balance in the last two weeks. They need planting dates, then Sync.{' '}
              <SetupLink to={SETUP_LINKS.plantingDate()}>Set planting dates</SetupLink>
            </p>
          ) : (
            <>
              <table className="w-full text-xs">
                <thead className="hidden text-left text-[10px] uppercase tracking-wide text-gray-400 sm:table-header-group">
                  <tr>
                    <th className="py-0.5 pr-2 font-medium">Field</th>
                    <PlanTh help="status">Status</PlanTh>
                    <PlanTh help="waterTrigger">Water / trigger</PlanTh>
                    <PlanTh help="crosses">Crosses</PlanTh>
                    <PlanTh help="startBy">Start by</PlanTh>
                    <PlanTh help="advice">Advice</PlanTh>
                  </tr>
                </thead>
                <tbody className="block divide-y divide-gray-100 sm:table-row-group">
                  {rows.map((r) => (
                    <PlanRow key={r.plan.fieldId} row={r} u={u} nowMs={nowMs} clash={clashes.get(r.plan.fieldId) ?? []} onPickField={onPickField} />
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-[11px] text-gray-400">
                From the balance as of {asOf ? fmtWallDay(wallOfDate(asOf)) : '—'} and its forecast; times are local.
                {doneCount > 0 && ` ${doneCount} field${doneCount === 1 ? '' : 's'} marked done for the season ${doneCount === 1 ? 'is' : 'are'} left out.`} Tap a field
                for its Detailed View.
              </p>
            </>
          )}
        </div>
      )}
    </section>
  )
}
