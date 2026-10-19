import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import { THRESHOLDS, conditionsCropOf, peakLook, referenceOf, type NdviLook, type Reference } from './combine-conditions'
import { cropForVariety } from './crop-variety-settings'
import { cropVarietySettingsQuery } from './crop-variety-settings-data'
import type { MoistureBands } from './moisture'

/**
 * What the Combines page's conditions card reads, beyond the dry-down model
 * (dry-down-data.ts) and the forecast (ranchWeather.ts): which fields are
 * being combined, and for one field its crop and moisture bands, whether it
 * was swathed, where it is, and its satellite looks this season against the
 * same crop's fields.
 */

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

/** The whole-field row in sat_observations; zones carry their own id. */
const WHOLE_FIELD = '00000000-0000-0000-0000-000000000000'

export type ConditionsFields = {
  /** Harvest started and not finished: a Deere harvest pass or a load without the last-load mark. Newest first. */
  harvesting: string[]
  /** Tested this season and not finished, newest test first. */
  tested: string[]
}

/**
 * The fields the picker offers first. Plain arrays, versioned: this is
 * persisted for offline use, and Sets come back from storage as {}.
 */
export function useConditionsFields(cropYear: number) {
  return useQuery({
    queryKey: ['combine-conditions-fields', cropYear, 'v1'],
    queryFn: async (): Promise<ConditionsFields> => {
      const [ops, loads, tests] = await Promise.all([
        supabase.from('jd_field_operations').select('field_id, started_at').eq('crop_season', cropYear).eq('operation_type', 'harvest'),
        supabase.from('bin_loads').select('field_id, last_from_field, loaded_on').eq('crop_year', cropYear),
        supabase.from('moisture_tests').select('field_id, tested_at').eq('crop_year', cropYear),
      ])
      for (const r of [ops, loads, tests]) if (r.error) throw r.error
      const done = new Set<string>()
      const latest = new Map<string, string>()
      const bump = (id: string | null, at: string | null) => {
        if (!id || !at) return
        if (!latest.has(id) || at > latest.get(id)!) latest.set(id, at)
      }
      for (const l of loads.data ?? []) {
        if (l.last_from_field && l.field_id) done.add(l.field_id)
        bump(l.field_id, l.loaded_on)
      }
      for (const o of ops.data ?? []) bump(o.field_id, o.started_at)
      const started = new Set([...(loads.data ?? []).map((l) => l.field_id), ...(ops.data ?? []).map((o) => o.field_id)].filter((x): x is string => Boolean(x)))
      const byLatest = (a: string, b: string) => (latest.get(b) ?? '').localeCompare(latest.get(a) ?? '')
      const harvesting = [...started].filter((id) => !done.has(id)).sort(byLatest)
      const testedAt = new Map<string, string>()
      for (const t of tests.data ?? []) if (t.field_id && (!testedAt.has(t.field_id) || t.tested_at > testedAt.get(t.field_id)!)) testedAt.set(t.field_id, t.tested_at)
      const tested = [...testedAt.keys()]
        .filter((id) => !done.has(id) && !started.has(id))
        .sort((a, b) => testedAt.get(b)!.localeCompare(testedAt.get(a)!))
      return { harvesting, tested }
    },
    staleTime: 5 * 60_000,
  })
}

export type FieldConditions = {
  cropName: string | null
  bands: MoistureBands | null
  swathed: boolean
  /** The day it was swathed, when a work record says so. */
  swathedOn: string | null
  centre: { lat: number; lon: number } | null
  /** This field's whole-field looks this season, oldest first. */
  looks: NdviLook[]
  /** The same crop's fields this season, this one included: the median of their peaks. */
  reference: Reference | null
}

type Obs = { subject_id: string; sensed_on: string; ndvi_mean: unknown; ndvi_p10: unknown; ndvi_p90: unknown; ndvi_stddev: unknown; ndre_mean: unknown; valid_fraction: unknown; quality: string }

const toLook = (o: Obs): NdviLook | null => {
  const mean = num(o.ndvi_mean)
  if (mean == null) return null
  return {
    date: o.sensed_on,
    mean,
    p10: num(o.ndvi_p10),
    p90: num(o.ndvi_p90),
    sd: num(o.ndvi_stddev),
    validFraction: num(o.valid_fraction),
    quality: o.quality === 'full' ? 'full' : 'partial',
    ndre: num(o.ndre_mean),
  }
}

/** The middle of a boundary's coordinates: near enough to ask for its weather. */
function centreOf(geometry: unknown): { lat: number; lon: number } | null {
  let lon = 0
  let lat = 0
  let n = 0
  const walk = (c: unknown): void => {
    if (Array.isArray(c) && typeof c[0] === 'number') {
      lon += c[0] as number
      lat += c[1] as number
      n++
    } else if (Array.isArray(c)) c.forEach(walk)
  }
  walk((geometry as { coordinates?: unknown } | null)?.coordinates)
  return n ? { lat: lat / n, lon: lon / n } : null
}

export function useFieldConditions(fieldId: string, cropYear: number) {
  const qc = useQueryClient()
  return useQuery({
    enabled: Boolean(fieldId),
    // Versioned: persisted offline, and a restored copy of another shape must not be read as this one.
    queryKey: ['combine-conditions', fieldId, cropYear, 'v1'],
    queryFn: async (): Promise<FieldConditions> => {
      const [plans, bounds, swaths, obs, varieties] = await Promise.all([
        supabase
          .from('crop_plans')
          .select('field_id, crop_id, variety, planned_acres, harvest_method, crops(id, name, moisture_dry_min, moisture_dry_max, moisture_tough_max, moisture_damp_max, moisture_moist_max, moisture_tough_advice)')
          .eq('crop_year', cropYear),
        supabase.from('field_boundaries_geojson').select('geometry, valid_from, valid_to').eq('field_id', fieldId),
        supabase.from('field_work_records').select('started_at, finished_at').eq('field_id', fieldId).eq('crop_year', cropYear).eq('work_type', 'swathing'),
        supabase
          .from('sat_observations')
          .select('subject_id, sensed_on, ndvi_mean, ndvi_p10, ndvi_p90, ndvi_stddev, ndre_mean, valid_fraction, quality')
          .eq('subject_type', 'field')
          .eq('subject_id', fieldId)
          .eq('zone_id', WHOLE_FIELD)
          .in('quality', ['full', 'partial'])
          .gte('sensed_on', `${cropYear}-04-01`)
          .lte('sensed_on', `${cropYear}-11-30`)
          .order('sensed_on'),
        qc.fetchQuery(cropVarietySettingsQuery()),
      ])
      for (const r of [plans, bounds, swaths, obs]) if (r.error) throw r.error

      type Crop = { id: string; name: string; moisture_dry_min: unknown; moisture_dry_max: unknown; moisture_tough_max: unknown; moisture_damp_max: unknown; moisture_moist_max: unknown; moisture_tough_advice: string | null }
      type Plan = { field_id: string; crop_id: string | null; variety: string | null; planned_acres: unknown; harvest_method: string | null; crops: Crop | null }
      const all = (plans.data ?? []) as unknown as Plan[]
      // A split field: the biggest crop area is the one being judged.
      const plan = all.filter((p) => p.field_id === fieldId).sort((a, b) => (num(b.planned_acres) ?? 0) - (num(a.planned_acres) ?? 0))[0]
      const crop = plan?.crops ? cropForVariety(plan.crops, plan.variety, varieties) : null
      const bands: MoistureBands | null = crop
        ? {
            dry_min: num(crop.moisture_dry_min),
            dry_max: num(crop.moisture_dry_max),
            tough_max: num(crop.moisture_tough_max),
            damp_max: num(crop.moisture_damp_max),
            moist_max: num(crop.moisture_moist_max),
            tough_advice: crop.moisture_tough_advice,
          }
        : null
      const swathRows = swaths.data ?? []
      const swathedOn = swathRows.map((s) => (s.finished_at ?? s.started_at) as string | null).filter((x): x is string => Boolean(x)).sort().at(-1) ?? null
      const current = (bounds.data ?? []).filter((b) => !b.valid_to).sort((a, b) => String(b.valid_from).localeCompare(String(a.valid_from)))[0] ?? (bounds.data ?? [])[0]
      const looks = ((obs.data ?? []) as unknown as Obs[]).map(toLook).filter((l): l is NdviLook => l != null)

      // The same crop on the farm's fields this season, this one included, by
      // crop group (every brand of canola together): each field's peak NDVI.
      const group = conditionsCropOf(plan?.crops?.name)
      const same = group ? [...new Set(all.filter((p) => conditionsCropOf(p.crops?.name) === group).map((p) => p.field_id))] : []
      let reference: Reference | null = null
      if (same.length >= THRESHOLDS.referenceFields) {
        const { data, error } = await supabase
          .from('sat_observations')
          .select('subject_id, sensed_on, ndvi_mean, ndvi_p10, ndvi_p90, ndvi_stddev, ndre_mean, valid_fraction, quality')
          .eq('subject_type', 'field')
          .eq('zone_id', WHOLE_FIELD)
          .eq('quality', 'full')
          .in('subject_id', same)
          .gte('sensed_on', `${cropYear}-04-01`)
          .lte('sensed_on', `${cropYear}-11-30`)
          .limit(5000)
        if (error) throw error
        const byField = new Map<string, NdviLook[]>()
        for (const o of (data ?? []) as unknown as Obs[]) {
          const l = toLook(o)
          if (l) byField.set(o.subject_id, [...(byField.get(o.subject_id) ?? []), l])
        }
        reference = referenceOf([...byField.values()].map((ls) => peakLook(ls)?.mean ?? NaN))
      }

      return {
        cropName: plan?.crops?.name ?? null,
        bands,
        swathed: plan?.harvest_method === 'swathed' || swathRows.length > 0,
        swathedOn: swathedOn ? new Date(swathedOn).toLocaleDateString('en-CA', { timeZone: 'America/Edmonton' }) : null,
        centre: centreOf(current?.geometry),
        looks,
        reference,
      }
    },
    staleTime: 10 * 60_000,
  })
}

/**
 * A signed link to the field's NDVI picture for a date, stretched to the
 * field's own range. Live-only in offline.ts: a signed link expires within
 * the hour, and a restored one is a broken image.
 */
export function useNdviPicture(fieldId: string, date: string | null) {
  return useQuery({
    enabled: Boolean(fieldId && date),
    queryKey: ['combine-ndvi-picture', fieldId, date],
    queryFn: async (): Promise<{ url: string; lo: number; hi: number; date: string } | null> => {
      const { data, error } = await supabase
        .from('sat_images')
        .select('sensed_on, kind, storage_path, stretch_min, stretch_max')
        .eq('subject_type', 'field')
        .eq('subject_id', fieldId)
        .eq('kind', 'ndvi_field')
        .lte('sensed_on', date!)
        .order('sensed_on', { ascending: false })
        .limit(1)
      if (error) throw error
      const img = data?.[0]
      const lo = num(img?.stretch_min)
      const hi = num(img?.stretch_max)
      if (!img || lo == null || hi == null) return null
      const signed = await supabase.storage.from('satellite-images').createSignedUrl(img.storage_path as string, 3600)
      if (signed.error || !signed.data?.signedUrl) return null
      return { url: signed.data.signedUrl, lo, hi, date: img.sensed_on as string }
    },
    staleTime: 30 * 60_000,
  })
}
