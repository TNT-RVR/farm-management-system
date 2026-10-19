import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
import { fetchAll, num } from './reports/framework'
import { varietySettingFor, type VarietySettingRow } from './crop-variety-settings'
import { finishedDays, finishedFor, handDayByField, handWorkDays, type FinishRow, type HandWorkRow } from './field-work'
import { seedingDates } from './seeding-dates'
import { effectiveHarvestDate, farmDay, harvestEvidenceByField, type HarvestOpRow, type HarvestSource, type LastLoadRow } from './harvest-date'
import {
  estimateBasis,
  estimateMaturity,
  estimateReasons,
  heatKindFor,
  type Estimate,
  type HailHit,
  type NormalDay,
  type WxDay,
} from './harvest-estimate'

/**
 * Estimated harvest per field (and per crop area on a split field) for one
 * crop year, from data the app already has — computed in the browser, no
 * nightly job. The model is in harvest-estimate.ts.
 *
 *   seeding date   field_crop_seasons.planting_date (the area's, else the
 *                  field's), else the field's earliest Deere seeding pass,
 *                  else the earliest seeding entered by hand
 *   days           the variety's days to maturity, else the crop's
 *   weather        the field's AIMM station (weather_daily: measured and the
 *                  Open-Meteo forecast) and its long-term normals
 *   hail           field_hail_events, share = hailed acres / crop acres
 *   harvested      effectiveHarvestDate: Field finished (the crop area's,
 *                  else the whole field's), typed in Setup, last load from the
 *                  field, the later of the last Deere harvest pass and the
 *                  last harvest entered by hand; then the scale yield's date
 */

export type HarvestEstimateRow = {
  key: string
  fieldId: string
  fieldName: string
  /** field_crop_zones.id on a split field; null for the whole field. */
  zoneId: string | null
  cropId: string
  cropName: string
  variety: string | null
  /** The day it was seeded (the area's season, else the field's, Deere's first pass, or entered by hand); null when unknown. */
  seeded: string | null
  /** Already off: the actual date and where it came from. */
  harvestedOn: string | null
  harvestedFrom: HarvestSource | 'scale' | null
  estimate: Estimate | null
  /** "seeded 2 May, 110 days; +4 days cooler than normal" */
  reasons: string | null
  /** The longer basis, for a tooltip. */
  basis: string | null
  /** What is missing when there is no estimate. */
  missing: 'days' | 'seeded' | null
  daysFrom: 'variety' | 'crop' | null
}

const today = () => farmDay(new Date().toISOString())

type CropLite = { id: string; name: string; days_to_maturity: number | null; counts_for_harvest: boolean | null }

/** The variety's days to maturity, else the crop's. */
export function daysToMaturity(
  crop: Pick<CropLite, 'id' | 'days_to_maturity'>,
  variety: string | null | undefined,
  rows: readonly VarietySettingRow[] | null | undefined,
): { days: number | null; from: 'variety' | 'crop' | null } {
  const v = num(varietySettingFor(rows, crop.id, variety)?.days_to_maturity)
  if (v != null && v > 0) return { days: Math.round(v), from: 'variety' }
  const c = num(crop.days_to_maturity)
  if (c != null && c > 0) return { days: Math.round(c), from: 'crop' }
  return { days: null, from: null }
}

export function harvestEstimatesQuery(cropYear: number) {
  return {
    // Versioned: persisted offline, so a change of shape must not restore an old copy.
    // v4: harvestedFrom can be 'finished' (Field finished, 20261017050000).
    queryKey: ['harvest-estimates', cropYear, 'v4'],
    queryFn: async (): Promise<HarvestEstimateRow[]> => {
      const y0 = `${cropYear}-01-01`
      const y1 = `${cropYear}-12-31`
      const [fields, crops, varieties, plans, history, zones, seasons, seedOps, harvestOps, loads, hail, stations, handRows] = await Promise.all([
        fetchAll<{ id: string; name: string; assigned_station_id: string | null }>((a, b) =>
          supabase.from('fields').select('id, name, assigned_station_id').order('id').range(a, b)),
        fetchAll<CropLite>((a, b) => supabase.from('crops').select('id, name, days_to_maturity, counts_for_harvest').order('id').range(a, b)),
        fetchAll<VarietySettingRow>((a, b) => supabase.from('crop_variety_settings').select('*').order('id').range(a, b)),
        fetchAll<{ field_id: string; crop_id: string; variety: string | null; planned_acres: unknown }>((a, b) =>
          supabase.from('crop_plans').select('field_id, crop_id, variety, planned_acres').eq('crop_year', cropYear).order('id').range(a, b)),
        fetchAll<{ field_id: string; crop_id: string; variety: string | null; acres: unknown; scale_at: string | null; yield_per_acre: unknown }>((a, b) =>
          supabase.from('crop_history').select('field_id, crop_id, variety, acres, scale_at, yield_per_acre').eq('crop_year', cropYear).order('id').range(a, b)),
        fetchAll<{ id: string; field_id: string; crop_id: string; acres: unknown }>((a, b) =>
          supabase.from('field_crop_zones').select('id, field_id, crop_id, acres').eq('crop_year', cropYear).order('id').range(a, b)),
        fetchAll<{ field_id: string; zone_id: string | null; planting_date: string | null; harvest_date: string | null }>((a, b) =>
          supabase.from('field_crop_seasons').select('field_id, zone_id, planting_date, harvest_date').eq('crop_year', cropYear).order('id').range(a, b)),
        fetchAll<{ field_id: string | null; crop_season: number | null; started_at: string | null }>((a, b) =>
          supabase.from('jd_field_operations').select('field_id, crop_season, started_at')
            // Season filtered below: a pass without one counts in the year it was made.
            .or('operation_type.ilike.seeding,operation_type.ilike.planting')
            .gte('started_at', `${cropYear - 1}-07-01`).lte('started_at', `${cropYear}-12-31T23:59:59Z`)
            .is('duplicate_of', null).not('field_id', 'is', null).order('id').range(a, b)),
        fetchAll<HarvestOpRow>((a, b) =>
          supabase.from('jd_field_operations').select('field_id, crop_season, started_at, ended_at')
            .ilike('operation_type', 'harvest%')
            .or(`crop_season.eq.${cropYear},crop_season.is.null`)
            .is('duplicate_of', null).is('not_ours', null).not('field_id', 'is', null).order('id').range(a, b)),
        fetchAll<LastLoadRow>((a, b) =>
          supabase.from('bin_loads').select('field_id, loaded_on').eq('crop_year', cropYear).eq('last_from_field', true)
            .not('field_id', 'is', null).order('id').range(a, b)),
        fetchAll<{ field_id: string; event_date: string; loss_pct: unknown; acres: unknown }>((a, b) =>
          supabase.from('field_hail_events').select('field_id, event_date, loss_pct, acres').eq('crop_year', cropYear).order('id').range(a, b)),
        fetchAll<{ id: string; name: string; ltn_file: string | null }>((a, b) =>
          supabase.from('weather_stations').select('id, name, ltn_file').order('id').range(a, b)),
        // Seeding and harvest entered by hand. An older database without the table reads as none.
        supabase
          .from('field_work_records')
          .select('field_id, zone_id, crop_year, counts_as, started_at, finished_at, field_finished')
          .eq('crop_year', cropYear)
          .in('counts_as', ['seeding', 'harvest'])
          .then(({ data, error }) => (error ? [] : ((data ?? []) as (HandWorkRow & FinishRow)[]))),
      ])

      const cropById = new Map(crops.map((c) => [c.id, c]))
      const stationById = new Map(stations.map((s) => [s.id, s]))
      // A field with no station of its own reads the one most fields use.
      const counts = new Map<string, number>()
      for (const f of fields) if (f.assigned_station_id) counts.set(f.assigned_station_id, (counts.get(f.assigned_station_id) ?? 0) + 1)
      const farmStation = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
      const stationOf = (fieldId: string) => fields.find((f) => f.id === fieldId)?.assigned_station_id ?? farmStation

      // Seeding dates (seeding-dates.ts, shared with the missing-information checklist).
      const seededOn = seedingDates(cropYear, seasons, seedOps, handRows)
      const seasonHarvest = new Map<string, string>()
      for (const s of seasons) if (s.harvest_date) seasonHarvest.set(`${s.field_id}:${s.zone_id ?? ''}`, s.harvest_date)
      const handHarvest = handDayByField(handWorkDays(handRows, 'harvest', cropYear), 'last')
      // "Field finished": the area's own, else the whole field's. First of every source.
      const finished = finishedDays(handRows, cropYear)
      const evidence = harvestEvidenceByField(cropYear, loads, harvestOps)

      // What is growing: each crop area on a split field, else the plan, else history.
      type Unit = { fieldId: string; zoneId: string | null; cropId: string; variety: string | null; acres: number | null; scaleAt: string | null }
      const units: Unit[] = []
      const zonesByField = new Map<string, typeof zones>()
      for (const z of zones) zonesByField.set(z.field_id, [...(zonesByField.get(z.field_id) ?? []), z])
      const planByField = new Map(plans.map((p) => [p.field_id, p]))
      const histByField = new Map<string, (typeof history)[number][]>()
      for (const h of history) histByField.set(h.field_id, [...(histByField.get(h.field_id) ?? []), h])
      const fieldIds = new Set([...plans.map((p) => p.field_id), ...history.map((h) => h.field_id), ...zones.map((z) => z.field_id)])
      for (const fieldId of fieldIds) {
        const plan = planByField.get(fieldId)
        const hist = histByField.get(fieldId) ?? []
        const fieldZones = zonesByField.get(fieldId)
        if (fieldZones?.length) {
          for (const z of fieldZones) {
            const h = hist.find((x) => x.crop_id === z.crop_id)
            const variety = plan?.crop_id === z.crop_id ? plan.variety : (h?.variety ?? null)
            units.push({ fieldId, zoneId: z.id, cropId: z.crop_id, variety, acres: num(z.acres), scaleAt: h?.scale_at ?? null })
          }
        } else if (plan) {
          const h = hist.find((x) => x.crop_id === plan.crop_id)
          units.push({ fieldId, zoneId: null, cropId: plan.crop_id, variety: plan.variety, acres: num(plan.planned_acres), scaleAt: h?.scale_at ?? null })
        } else {
          for (const h of hist) units.push({ fieldId, zoneId: null, cropId: h.crop_id, variety: h.variety, acres: num(h.acres), scaleAt: h.scale_at })
        }
      }

      // Weather for the stations in use, from the earliest seeding.
      const plantOf = (u: Unit) => seededOn(u.fieldId, u.zoneId)
      const used = units.filter((u) => {
        const c = cropById.get(u.cropId)
        return c && c.counts_for_harvest !== false && plantOf(u)
      })
      const stationIds = [...new Set(used.map((u) => stationOf(u.fieldId)).filter((s): s is string => !!s))]
      const from = used.map(plantOf).filter((d): d is string => !!d).sort()[0] ?? y0
      const ltnFiles = [...new Set(stationIds.map((s) => stationById.get(s)?.ltn_file).filter((f): f is string => !!f))]
      const [wxRows, normalRows] = await Promise.all([
        stationIds.length
          ? fetchAll<{ station_id: string; date: string; tmax_c: unknown; tmin_c: unknown; solar_mj: unknown }>((a, b) =>
              supabase.from('weather_daily').select('station_id, date, tmax_c, tmin_c, solar_mj')
                .in('station_id', stationIds).gte('date', from).lte('date', y1).order('station_id').order('date').range(a, b))
          : Promise.resolve([]),
        ltnFiles.length
          ? fetchAll<{ ltn_file: string; month: number; day: number; tmax_c: unknown; tmin_c: unknown; solar_kj: unknown }>((a, b) =>
              supabase.from('weather_normals').select('ltn_file, month, day, tmax_c, tmin_c, solar_kj')
                .in('ltn_file', ltnFiles).order('ltn_file').order('month').order('day').range(a, b))
          : Promise.resolve([]),
      ])
      const wxByStation = new Map<string, Map<string, WxDay>>()
      for (const w of wxRows) {
        let m = wxByStation.get(w.station_id)
        if (!m) wxByStation.set(w.station_id, (m = new Map()))
        m.set(w.date, { tmax: num(w.tmax_c), tmin: num(w.tmin_c), solarMj: num(w.solar_mj) })
      }
      const normalsByFile = new Map<string, Map<string, NormalDay>>()
      for (const n of normalRows) {
        const tmax = num(n.tmax_c)
        const tmin = num(n.tmin_c)
        if (tmax == null || tmin == null) continue
        let m = normalsByFile.get(n.ltn_file)
        if (!m) normalsByFile.set(n.ltn_file, (m = new Map()))
        const sol = num(n.solar_kj)
        m.set(`${String(n.month).padStart(2, '0')}-${String(n.day).padStart(2, '0')}`, { tmax, tmin, solarMj: sol != null ? sol / 1000 : null })
      }

      const now = today()
      const fieldName = (id: string) => fields.find((f) => f.id === id)?.name ?? '—'
      const out: HarvestEstimateRow[] = []
      for (const u of units) {
        const crop = cropById.get(u.cropId)
        if (!crop || crop.counts_for_harvest === false) continue
        const plant = plantOf(u)
        const ev = evidence.get(u.fieldId)
        const typed = seasonHarvest.get(`${u.fieldId}:${u.zoneId ?? ''}`) ?? seasonHarvest.get(`${u.fieldId}:`) ?? null
        let actual: { date: string | null; source: HarvestSource | 'scale' | null } = effectiveHarvestDate(
          { finishedOn: finishedFor(finished, u.fieldId, u.zoneId)?.finished ?? null, typed, lastLoadOn: ev?.lastLoadOn ?? null, jdLastPassOn: ev?.jdLastPassOn ?? null, handLastPassOn: handHarvest.get(u.fieldId) ?? null },
          { plantingDate: plant, today: now },
        )
        if (!actual.date && u.scaleAt) {
          const d = farmDay(u.scaleAt)
          if ((!plant || d > plant) && d <= now) actual = { date: d, source: 'scale' }
        }
        const { days, from: daysFrom } = daysToMaturity(crop, u.variety, varieties)
        let estimate: Estimate | null = null
        let basis: string | null = null
        if (plant && days) {
          const st = stationOf(u.fieldId)
          const station = st ? stationById.get(st) : undefined
          const hits: HailHit[] = hail
            .filter((h) => h.field_id === u.fieldId)
            .map((h) => {
              const ha = num(h.acres)
              return { date: h.event_date, lossPct: num(h.loss_pct), share: ha != null && u.acres ? ha / u.acres : null }
            })
          estimate = estimateMaturity({
            seeded: plant,
            days,
            kind: heatKindFor(crop.name),
            weather: (st && wxByStation.get(st)) || new Map(),
            normals: (station?.ltn_file && normalsByFile.get(station.ltn_file)) || new Map(),
            today: now,
            hail: hits,
          })
          basis = `${daysFrom === 'variety' ? `Days to maturity from the ${u.variety} variety.` : `Days to maturity from ${crop.name}.`} ${estimateBasis(estimate, station?.name ?? null)}`
        }
        out.push({
          key: `${u.fieldId}:${u.zoneId ?? ''}:${u.cropId}`,
          fieldId: u.fieldId,
          fieldName: fieldName(u.fieldId),
          zoneId: u.zoneId,
          cropId: u.cropId,
          cropName: crop.name,
          variety: u.variety,
          seeded: plant,
          harvestedOn: actual.date,
          harvestedFrom: actual.source,
          estimate,
          reasons: estimate ? estimateReasons(estimate) : null,
          basis,
          missing: actual.date || estimate ? null : !days ? 'days' : 'seeded',
          daysFrom,
        })
      }
      return out
    },
    staleTime: 30 * 60 * 1000,
  }
}

export function useHarvestEstimates(cropYear: number, enabled = true) {
  return useQuery({ ...harvestEstimatesQuery(cropYear), enabled })
}
