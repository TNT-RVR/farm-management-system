import { useQuery } from '@tanstack/react-query'
import { canSeeFinances, useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { useHailEvents } from '@/lib/queries'
import { useYieldHistory } from '@/lib/forecast-data'
import { useHarvestEstimates } from '@/lib/harvest-estimate-data'
import { FIXED_CATEGORIES, linePerAcre, useFixedCostLines, useFixedPerAcre, useRentedOutAcres } from '@/lib/farm-costs'
import { workTypeLabel } from '@/lib/field-work'
import type { HookRun } from '@/pages/reports/gatherers'
import { useCropBooks } from './crop-books'
import { fetchAll, num, pick, yearParam } from './framework'
import { buildWrapUp, wrapUpCsv, wrapUpPdf, type FixedPart, type WrapInspection, type WrapScouting, type WrapWeatherDay, type WrapWork } from './season-wrap-up'

/**
 * What the season wrap-up reads (season-wrap-up.ts). The rows, yields and
 * money come through the hooks the Financials page and the Crop P&L already
 * use (useCropBooks, which carries the plan's scored rows), the dates through
 * the harvest estimate, hail through the Hail page's query; the one read of
 * its own is the field-level record the other screens keep apart — water,
 * the water balance's season, work entered by hand, scouting, inspections and
 * the measured weather for heat and frost.
 *
 * Everything goes through the person's own session, so the database's rules
 * decide what they get: the fixed-cost parts are asked for only by those who
 * may see them, and come back empty for anyone else regardless.
 */

/** A table an older database may not have reads as none, rather than stopping the report. */
async function soft<T>(page: (a: number, b: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  try {
    return await fetchAll<T>(page)
  } catch {
    return []
  }
}

export type WrapExtras = {
  irrigation: Map<string, { mm: number; days: number }>
  seasonWater: Map<string, { rainMm: number | null; stressDays: number | null }>
  weather: Map<string, WrapWeatherDay[]>
  work: WrapWork[]
  scouting: WrapScouting[]
  inspections: WrapInspection[]
}

export async function loadWrapUpExtras(year: number, today: string): Promise<WrapExtras> {
  const y0 = `${year}-01-01`
  const y1 = `${year}-12-31`
  const [fields, irrigation, seasonWater, work, workTypes, scouting, inspections] = await Promise.all([
    fetchAll<{ id: string; assigned_station_id: string | null }>((a, b) => supabase.from('fields').select('id, assigned_station_id').order('id').range(a, b)),
    // The gross the pivots logged, as the Field season summary and Water use reports total it.
    fetchAll<{ field_id: string; date: string; gross_mm: unknown; net_mm: unknown }>((a, b) =>
      supabase.from('irrigation_events').select('field_id, date, gross_mm, net_mm').gte('date', y0).lte('date', y1).order('id').range(a, b),
    ),
    soft<{ field_id: string; rain_mm: unknown; stress_days: unknown }>((a, b) => supabase.from('field_season_water').select('field_id, rain_mm, stress_days').eq('year', year).order('field_id').range(a, b)),
    soft<{ field_id: string; zone_id: string | null; crop_id: string | null; work_type: string; work_type_other: string | null; counts_as: string | null; started_at: string | null }>((a, b) =>
      supabase.from('field_work_records').select('id, field_id, zone_id, crop_id, work_type, work_type_other, counts_as, started_at').eq('crop_year', year).order('id').range(a, b),
    ),
    soft<{ id: string; label: string }>((a, b) => supabase.from('field_work_types').select('id, label').order('id').range(a, b)),
    soft<WrapScouting>((a, b) => supabase.from('scouting_notes').select('id, field_id, category, severity, resolved_at').eq('crop_year', year).order('id').range(a, b)),
    soft<WrapInspection>((a, b) => supabase.from('field_inspections').select('id, field_id, crop_id, status, rating, inspected_on').eq('crop_year', year).order('id').range(a, b)),
  ])

  // A field with no station of its own reads the one most fields use (as the harvest estimate does).
  const counts = new Map<string, number>()
  for (const f of fields) if (f.assigned_station_id) counts.set(f.assigned_station_id, (counts.get(f.assigned_station_id) ?? 0) + 1)
  const farmStation = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
  const stationOf = new Map(fields.map((f) => [f.id, f.assigned_station_id ?? farmStation]))
  const stations = [...new Set([...stationOf.values()].filter((s): s is string => !!s))]
  const wx = stations.length
    ? await soft<{ station_id: string; date: string; tmax_c: unknown; tmin_c: unknown; source: string }>((a, b) =>
        supabase
          .from('weather_daily')
          .select('station_id, date, tmax_c, tmin_c, source')
          .in('station_id', stations)
          .gte('date', y0)
          .lte('date', today < y1 ? today : y1)
          // Measured days only: the Open-Meteo rows are the forecast.
          .neq('source', 'openmeteo')
          .order('station_id')
          .order('date')
          .range(a, b),
      )
    : []
  const byStation = new Map<string, WrapWeatherDay[]>()
  for (const w of wx) byStation.set(w.station_id, [...(byStation.get(w.station_id) ?? []), { date: w.date, tmax: num(w.tmax_c), tmin: num(w.tmin_c) }])

  const irr = new Map<string, { mm: number; days: Set<string> }>()
  for (const e of irrigation) {
    const cur = irr.get(e.field_id) ?? { mm: 0, days: new Set<string>() }
    cur.mm += num(e.gross_mm) ?? num(e.net_mm) ?? 0
    cur.days.add(e.date)
    irr.set(e.field_id, cur)
  }

  const typeLabel = new Map(workTypes.map((t) => [t.id, t.label]))
  return {
    irrigation: new Map([...irr].map(([k, v]) => [k, { mm: v.mm, days: v.days.size }])),
    seasonWater: new Map(seasonWater.map((s) => [s.field_id, { rainMm: num(s.rain_mm), stressDays: num(s.stress_days) }])),
    weather: new Map(fields.map((f) => [f.id, byStation.get(stationOf.get(f.id) ?? '') ?? []])),
    // Seeding and harvest are the dates; the rest is the hand-entered work worth a note.
    work: work
      .filter((w) => w.counts_as !== 'seeding' && w.counts_as !== 'harvest')
      .map((w) => ({ field_id: w.field_id, zone_id: w.zone_id, crop_id: w.crop_id, counts_as: w.counts_as, started_at: w.started_at, label: typeLabel.get(w.work_type) ?? workTypeLabel(w) })),
    scouting: scouting.map((s) => ({ ...s, severity: Number(s.severity) || 0 })),
    inspections,
  }
}

/** The report, through the same hooks as the Crop P&L; the PDF is a page a field, the CSV a row a crop area. */
export const useSeasonWrapUpRun: HookRun = (p, ctx) => {
  const year = yearParam(p, ctx)
  const fieldId = pick(p, 'field')
  const { profile } = useAuth()
  const finance = canSeeFinances(profile)
  const books = useCropBooks(year)
  const history = useYieldHistory()
  const estimates = useHarvestEstimates(year)
  const hail = useHailEvents(year)
  const fixed = useFixedPerAcre(year)
  const sourceYear = fixed.setting?.crop_year ?? null
  // The parts are the owners' and the accountant's: nobody else asks.
  const parts = useFixedCostLines(sourceYear, finance)
  const rentedOut = useRentedOutAcres(year)
  const extras = useQuery({ queryKey: ['season-wrap-up', 'extras', year, ctx.today], queryFn: () => loadWrapUpExtras(year, ctx.today) })

  const qs = [history, estimates, hail, extras, fixed]
  const partsReady = !finance || sourceYear == null || (parts.status !== 'pending' && rentedOut.status !== 'pending')
  const ready = books.ready && qs.every((q) => q.data !== undefined) && partsReady
  const error = books.error ?? ((qs.find((q) => q.error)?.error as Error | undefined) ?? null)

  return {
    ready,
    error,
    build: () => {
      let fixedParts: FixedPart[] | null = null
      if (finance && parts.data?.length) {
        fixedParts = FIXED_CATEGORIES.flatMap((c) =>
          (parts.data ?? [])
            .filter((l) => l.category === c.key)
            .map((l) => ({ label: l.note ? `${c.label} (${l.note})` : c.label, perAcre: linePerAcre({ basis: l.basis, amount: l.amount, category: l.category }, num(fixed.setting?.spread_acres), rentedOut.data ?? 0) })),
        )
      }
      const x = extras.data!
      const wrap = buildWrapUp({
        year,
        today: ctx.today,
        fieldId,
        planRows: books.planRows,
        books: books.build(),
        estimates: estimates.data ?? [],
        history: history.data ?? [],
        hail: (hail.data ?? []).map((h) => ({ field_id: h.field_id, event_date: h.event_date, loss_pct: num(h.loss_pct), acres: num(h.acres), notes: h.notes })),
        irrigation: x.irrigation,
        seasonWater: x.seasonWater,
        weather: x.weather,
        work: x.work,
        scouting: x.scouting,
        inspections: x.inspections,
        finance,
        fixedParts,
      })
      const title = 'Season wrap-up'
      return ctx.format === 'CSV' ? wrapUpCsv(wrap, title) : wrapUpPdf(wrap, title)
    },
  }
}
