/**
 * The reads behind the fusarium risk page.
 *
 * Kept apart from fusarium.ts so the rules there stay pure and testable. One
 * hook does the whole page: the rules need a field's crop, its planting date,
 * its station's weather, its last two years and its sprays all at once, and
 * ten small hooks would each wait on the others anyway.
 */

import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
import {
  cerealClass,
  fhbSpells,
  floweringClashes,
  group11InWindow,
  infectionWindow,
  irrigationInWindow,
  levelFor,
  phaseToday,
  residueRisk,
  sortFields,
  windowState,
  type Day,
  type FhbField,
  type Hour,
} from './fusarium'
import type { StageLengths } from './crop-irrigation'

const num = (v: number | string | null | undefined) => (v == null ? null : Number(v))

/** The farm's own day, so a window does not open an hour early on a laptop in another zone. */
export const farmToday = () =>
  new Date().toLocaleDateString('en-CA', { timeZone: 'America/Edmonton', year: 'numeric', month: '2-digit', day: '2-digit' })

export type FusariumSeason = {
  cropYear: number
  fields: FhbField[]
  clashes: ReturnType<typeof floweringClashes>
  /** Cereal fields the page had to leave out, and why, so the list is not quietly short. */
  skipped: { fieldName: string; why: string }[]
  /** Corn grown this year: next year's inoculum, wherever it sits in the rotation. */
  cornThisYear: string[]
}

export function useFusariumSeason(cropYear: number) {
  return useQuery({
    queryKey: ['fusarium', cropYear],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<FusariumSeason> => {
      const [fields, plans, crops, coefs, seasons, pivots] = await Promise.all([
        supabase.from('fields').select('id, name, active, assigned_station_id'),
        supabase.from('crop_plans').select('field_id, crop_id, variety, planned_acres').eq('crop_year', cropYear),
        supabase.from('crops').select('id, name, crop_coefficient_id'),
        supabase.from('crop_coefficients').select('id, crop, variant, l_ini, l_dev, l_mid, l_late'),
        supabase
          .from('field_crop_seasons')
          .select('field_id, crop_year, planting_date, crop_coefficient_id, active, zone_id')
          .eq('crop_year', cropYear),
        supabase.from('field_pivots').select('field_id, not_used'),
      ])
      for (const r of [fields, plans, crops, coefs, seasons, pivots]) if (r.error) throw r.error

      const cropById = new Map((crops.data ?? []).map((c) => [c.id as string, c]))
      const coefById = new Map((coefs.data ?? []).map((c) => [c.id as string, c]))
      const irrigated = new Set(
        (pivots.data ?? []).filter((p) => !p.not_used && p.field_id).map((p) => p.field_id as string),
      )

      // One season row per field: an active row over an inactive one, then the
      // whole-field row over a zone's. The planting date is the field's either
      // way, which is why an inactive row still counts here where it does not
      // for the irrigation balance — a green feed field on dryland has no
      // active season row at all, and dropping it would report "no planting
      // date" about a field that has one.
      const seasonRank = (s: NonNullable<typeof seasons.data>[number]) => (s.active ? 0 : 2) + (s.zone_id ? 1 : 0)
      const seasonFor = new Map<string, NonNullable<typeof seasons.data>[number]>()
      for (const s of seasons.data ?? []) {
        const held = seasonFor.get(s.field_id as string)
        if (!held || seasonRank(s) < seasonRank(held)) seasonFor.set(s.field_id as string, s)
      }

      // The crop the plan names, largest acres first — the same crop every
      // other per-field table labels the row with.
      const plannedFor = new Map<string, NonNullable<typeof plans.data>[number]>()
      for (const p of plans.data ?? []) {
        const held = plannedFor.get(p.field_id as string)
        if (!held || Number(p.planned_acres ?? 0) > Number(held.planned_acres ?? 0)) {
          plannedFor.set(p.field_id as string, p)
        }
      }

      const active = (fields.data ?? []).filter((f) => f.active)
      const cereals: { field: (typeof active)[number]; cropName: string; variety: string | null }[] = []
      const cornThisYear: string[] = []
      for (const f of active) {
        const plan = plannedFor.get(f.id as string)
        const cropName = plan ? (cropById.get(plan.crop_id as string)?.name ?? null) : null
        if (!cropName) continue
        if (/\bcorn\b|sorghum/i.test(cropName)) cornThisYear.push(f.name as string)
        if (cerealClass(cropName)) cereals.push({ field: f, cropName, variety: (plan?.variety as string) ?? null })
      }

      if (!cereals.length) {
        return { cropYear, fields: [], clashes: [], skipped: [], cornThisYear: cornThisYear.sort() }
      }

      const fieldIds = cereals.map((c) => c.field.id as string)
      const stationIds = [
        ...new Set(cereals.map((c) => c.field.assigned_station_id as string | null).filter((s): s is string => !!s)),
      ]

      // Weather is read for the whole season, not per window: the windows are
      // a fortnight each and scattered through June and July, and one read of
      // the season is cheaper than one per field.
      const from = `${cropYear}-04-01`
      const to = `${cropYear}-10-31`
      const [hourly, daily, irrigation, history, moa] = await Promise.all([
        stationIds.length
          ? supabase
              .from('weather_hourly')
              .select('station_id, ts, temp_c, rh, precip_mm, forecast')
              .in('station_id', stationIds)
              .gte('ts', `${from}T00:00:00Z`)
              .lte('ts', `${to}T23:59:59Z`)
          : Promise.resolve({ data: [], error: null }),
        stationIds.length
          ? supabase
              .from('weather_daily')
              .select('station_id, date, tmax_c, tmin_c, rh_mean, rh_max, rh_min, precip_mm')
              .in('station_id', stationIds)
              .gte('date', from)
              .lte('date', to)
          : Promise.resolve({ data: [], error: null }),
        supabase.from('irrigation_events').select('field_id, date, gross_mm').in('field_id', fieldIds).gte('date', from).lte('date', to),
        supabase
          .from('crop_history')
          .select('field_id, crop_year, crop_id')
          .in('field_id', fieldIds)
          .in('crop_year', [cropYear - 1, cropYear - 2]),
        supabase
          .from('field_moa_history_v')
          .select('field_id, applied_on, product_name, scheme, group_code')
          .in('field_id', fieldIds)
          .eq('scheme', 'fungicide')
          .eq('group_code', '11'),
      ])
      for (const r of [hourly, daily, irrigation, history, moa]) if (r.error) throw r.error

      const hoursBy = new Map<string, Hour[]>()
      for (const h of hourly.data ?? []) {
        const k = h.station_id as string
        hoursBy.set(k, [...(hoursBy.get(k) ?? []), h as Hour])
      }
      const daysBy = new Map<string, Day[]>()
      for (const d of daily.data ?? []) {
        const k = d.station_id as string
        daysBy.set(k, [...(daysBy.get(k) ?? []), d as Day])
      }

      const today = farmToday()
      const rows: FhbField[] = []
      const skipped: { fieldName: string; why: string }[] = []

      for (const { field, cropName, variety } of cereals) {
        const fieldId = field.id as string
        const fieldName = field.name as string
        const season = seasonFor.get(fieldId)
        const crop = [...cropById.values()].find((c) => c.name === cropName)
        const coef = coefById.get((season?.crop_coefficient_id ?? crop?.crop_coefficient_id) as string)
        const lengths: StageLengths | null =
          coef && coef.l_ini != null && coef.l_dev != null
            ? {
                l_ini: Number(coef.l_ini),
                l_dev: Number(coef.l_dev),
                l_mid: Number(coef.l_mid ?? 0),
                l_late: Number(coef.l_late ?? 0),
              }
            : null
        const plantingDate = (season?.planting_date as string) ?? null

        if (!plantingDate || !lengths) {
          skipped.push({
            fieldName,
            why: !plantingDate ? 'no planting date on this season' : `no stage lengths for ${cropName}`,
          })
          continue
        }

        const window = infectionWindow(plantingDate, lengths)
        if (!window) {
          skipped.push({ fieldName, why: `no stage lengths for ${cropName}` })
          continue
        }

        const stationId = field.assigned_station_id as string | null
        const { spells, basis } = fhbSpells({
          from: window.from,
          to: window.to,
          hours: stationId ? (hoursBy.get(stationId) ?? []) : [],
          days: stationId ? (daysBy.get(stationId) ?? []) : [],
        })

        const cereal = cerealClass(cropName)!
        const residue = residueRisk(
          (history.data ?? [])
            .filter((h) => h.field_id === fieldId)
            .map((h) => ({
              crop_year: h.crop_year as number,
              cropName: cropById.get(h.crop_id as string)?.name ?? null,
            })),
          cropYear,
        )
        const irr = irrigationInWindow(
          (irrigation.data ?? [])
            .filter((e) => e.field_id === fieldId)
            .map((e) => ({ date: e.date as string, gross_mm: num(e.gross_mm) })),
          window,
        )
        const group11 = group11InWindow(
          (moa.data ?? [])
            .filter((m) => m.field_id === fieldId)
            .map((m) => ({
              applied_on: m.applied_on as string,
              name: m.product_name as string,
              scheme: m.scheme as string,
              group_code: m.group_code as string,
            })),
          window,
        )
        const isIrrigated = irrigated.has(fieldId)
        const state = windowState(window, today)
        const { level, reasons } = levelFor({ spells, residue, irrigation: irr, cereal, irrigated: isIrrigated, state })

        rows.push({
          fieldId,
          fieldName,
          cropName,
          cereal,
          variety,
          irrigated: isIrrigated,
          plantingDate,
          window,
          phase: phaseToday(plantingDate, lengths, today),
          state,
          spells,
          basis,
          residue,
          irrigation: irr,
          group11,
          level,
          reasons,
        })
      }

      const sorted = sortFields(rows)
      return {
        cropYear,
        fields: sorted,
        clashes: floweringClashes(sorted),
        skipped: skipped.sort((a, b) => a.fieldName.localeCompare(b.fieldName)),
        cornThisYear: cornThisYear.sort(),
      }
    },
  })
}
