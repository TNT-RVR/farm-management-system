import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
import { fieldNeed, profileAwhc, type AimmSeason, type FieldNeed } from './crop-water-need'

/**
 * What each field's season need is worked from: its soil profile's
 * water-holding, its pivot's efficiency, and its AIMM seasons with the crop
 * grown in each. The arithmetic is in crop-water-need.ts.
 */
export function useFieldNeedInputs() {
  return useQuery({
    queryKey: ['field-need-inputs', 'v1'],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const [soils, pivots, seasons, crops] = await Promise.all([
        supabase.from('field_soil_profiles').select('field_id, layers'),
        supabase.from('field_pivots').select('field_id, application_efficiency').eq('not_used', false),
        supabase.from('field_season_water').select('field_id, year, days, potential_etc_mm, effective_irrigation_mm, over_irrigation_mm, stress_days'),
        supabase.from('crops').select('id, name, irrigation_need_in, irrigation_need_basis'),
      ])
      for (const r of [soils, pivots, seasons, crops]) if (r.error) throw r.error
      const years = [...new Set((seasons.data ?? []).map((s) => s.year))]
      const plans = years.length ? await supabase.from('crop_plans').select('field_id, crop_year, crop_id, planned_acres').in('crop_year', years) : { data: [], error: null }
      if (plans.error) throw plans.error
      return { soils: soils.data ?? [], pivots: pivots.data ?? [], seasons: seasons.data ?? [], crops: crops.data ?? [], plans: plans.data ?? [] }
    },
  })
}

export type FieldNeedInputs = NonNullable<ReturnType<typeof useFieldNeedInputs>['data']>

/** A function giving one field's season need for a crop, gross inches, with its working. */
export function fieldNeedResolver(d: FieldNeedInputs | undefined) {
  if (!d) return null
  const awhc = new Map(d.soils.map((s) => [s.field_id, profileAwhc(s.layers)]))
  const eff = new Map(d.pivots.map((p) => [p.field_id, p.application_efficiency == null ? null : Number(p.application_efficiency)]))
  const cropById = new Map(d.crops.map((c) => [c.id, c]))
  // The crop each AIMM season was on: the biggest planned piece that year.
  const top = new Map<string, { crop_id: string; acres: number }>()
  for (const p of d.plans) {
    const k = `${p.field_id}:${p.crop_year}`
    const ac = Number(p.planned_acres ?? 0)
    if (!top.has(k) || ac > top.get(k)!.acres) top.set(k, { crop_id: p.crop_id, acres: ac })
  }
  const aimm = new Map<string, AimmSeason[]>()
  for (const s of d.seasons) {
    const crop = top.get(`${s.field_id}:${s.year}`)
    const list = aimm.get(s.field_id) ?? []
    list.push({
      year: s.year,
      cropName: crop ? (cropById.get(crop.crop_id)?.name ?? null) : null,
      days: Number(s.days ?? 0),
      potentialEtcMm: Number(s.potential_etc_mm ?? 0),
      effectiveIrrigationMm: Number(s.effective_irrigation_mm ?? 0),
      overIrrigationMm: Number(s.over_irrigation_mm ?? 0),
      stressDays: Number(s.stress_days ?? 0),
    })
    aimm.set(s.field_id, list)
  }
  const cache = new Map<string, FieldNeed>()
  return (fieldId: string, cropId: string): FieldNeed => {
    const k = `${fieldId}:${cropId}`
    const hit = cache.get(k)
    if (hit) return hit
    const c = cropById.get(cropId)
    const out = fieldNeed({
      cropName: c?.name ?? null,
      farmIn: c?.irrigation_need_in == null ? null : Number(c.irrigation_need_in),
      awhcMmM: awhc.get(fieldId) ?? null,
      efficiency: eff.get(fieldId) ?? null,
      aimm: aimm.get(fieldId),
    })
    cache.set(k, out)
    return out
  }
}
