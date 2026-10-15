import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from './supabase'

// The satellite view of the pastures, for the cattle side (spec §9).
//
// Everything here is RELATIVE. §14.3 forbids reporting biomass in kg/ha until
// locally calibrated, so there is no kg anywhere in these types — a forage
// index, a percent of the best paddock, and a regrowth slope. All three are
// true today; a kg/ha figure today would not be.

export type RotationRow = {
  pasture_id: string
  name: string
  area_acres: number | null
  last_look: string | null
  days_since_look: number | null
  forage_index: number | null
  percent_of_best: number | null
  regrowth_per_day: number | null
  regrowth_points: number | null
  days_rested: number | null
  min_rest_days: number
  cattle_on_now: boolean | null
  readiness: 'not_ready' | 'ready' | 'optimal' | 'overmature' | 'overgrazed'
  readiness_reason: string
  rotation_score: number | null
  caveat: string | null
}

const num = (v: number | string | null | undefined): number | null => {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

/** Pastures in the order the rotation suggests, best first. */
export function useRotationOrder() {
  return useQuery({
    queryKey: ['pasture-rotation'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pasture_rotation_order')
        .select('*')
        .order('rotation_score', { ascending: false })
      if (error) throw error
      return (data ?? []).map((r) => ({
        ...(r as unknown as RotationRow),
        forage_index: num((r as Record<string, unknown>).forage_index as number),
        percent_of_best: num((r as Record<string, unknown>).percent_of_best as number),
        regrowth_per_day: num((r as Record<string, unknown>).regrowth_per_day as number),
        rotation_score: num((r as Record<string, unknown>).rotation_score as number),
        area_acres: num((r as Record<string, unknown>).area_acres as number),
      })) as RotationRow[]
    },
    staleTime: 10 * 60_000,
  })
}

export type CalibrationReadiness = {
  samples: number
  low_samples: number
  mid_samples: number
  high_samples: number
  pastures_sampled: number
  seasons: number
  may_report_absolute: boolean
}

/** Whether enough clip-and-weigh samples exist to report kg/ha at all. */
export function useCalibrationReadiness() {
  return useQuery({
    queryKey: ['pasture-calibration-readiness'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pasture_calibration_readiness')
        .select('*')
        .maybeSingle()
      if (error) throw error
      return (data ?? null) as unknown as CalibrationReadiness | null
    },
    staleTime: 10 * 60_000,
  })
}

/** Samples still needed, by biomass band (spec §9.2). */
export const CALIBRATION_TARGET = { total: 12, perBand: 3 }

export function calibrationGap(r: CalibrationReadiness | null | undefined): string {
  if (!r) return 'No calibration samples yet.'
  if (r.may_report_absolute) return 'Calibrated — absolute figures are available.'
  const missing: string[] = []
  if (r.low_samples < CALIBRATION_TARGET.perBand)
    missing.push(`${CALIBRATION_TARGET.perBand - r.low_samples} more on light forage`)
  if (r.mid_samples < CALIBRATION_TARGET.perBand)
    missing.push(`${CALIBRATION_TARGET.perBand - r.mid_samples} more on medium`)
  if (r.high_samples < CALIBRATION_TARGET.perBand)
    missing.push(`${CALIBRATION_TARGET.perBand - r.high_samples} more on heavy`)
  const shortOfTotal = Math.max(0, CALIBRATION_TARGET.total - r.samples)
  if (shortOfTotal && !missing.length) missing.push(`${shortOfTotal} more samples`)
  return missing.length
    ? `${r.samples} sample${r.samples === 1 ? '' : 's'} so far. Needs ${missing.join(', ')} before kg/ha can be shown.`
    : `${r.samples} samples — spread still too narrow to fit a curve.`
}

export type CalibrationInput = {
  pasture_id: string
  sampled_on: string
  method: 'clip_and_weigh' | 'plate_meter' | 'visual_estimate'
  measured_kg_dm_ha: number
  lat: number | null
  lon: number | null
  notes: string | null
}

export type NearbyLook = {
  sensed_on: string
  ndvi_mean: number | string | null
  evi2_mean: number | string | null
  ndre_mean: number | string | null
}

/** The satellite look nearest a sample's date, and how many days away it is. */
export function nearestLook<T extends { sensed_on: string }>(looks: T[], sampledOn: string): { look: T; gapDays: number } | null {
  const target = Date.parse(`${sampledOn}T00:00:00Z`)
  let nearest: T | null = null
  let bestGap = Number.POSITIVE_INFINITY
  for (const o of looks) {
    if (!o) continue
    const gap = Math.abs(Date.parse(`${o.sensed_on}T00:00:00Z`) - target) / 86_400_000
    if (gap < bestGap) {
      bestGap = gap
      nearest = o
    }
  }
  return nearest ? { look: nearest, gapDays: Math.round(bestGap) } : null
}

/** The satellite columns of a sample, matched to the look nearest its pasture and date. */
async function matchLook(pastureId: string, sampledOn: string) {
  const { data: obs } = await supabase
    .from('sat_observations')
    .select('sensed_on, ndvi_mean, evi2_mean, ndre_mean')
    .eq('subject_type', 'pasture')
    .eq('subject_id', pastureId)
    .neq('quality', 'rejected')
    .order('sensed_on', { ascending: false })
    .limit(30)
  const m = nearestLook((obs ?? []) as NearbyLook[], sampledOn)
  return {
    ndvi_at_sample: m ? num(m.look.ndvi_mean) : null,
    evi2_at_sample: m ? num(m.look.evi2_mean) : null,
    ndre_at_sample: m ? num(m.look.ndre_mean) : null,
    observation_gap_days: m ? m.gapDays : null,
  }
}

function useInvalidateCalibration() {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: ['pasture-calibration-readiness'] })
    void qc.invalidateQueries({ queryKey: ['pasture-rotation'] })
    void qc.invalidateQueries({ queryKey: ['pasture-calibration-samples'] })
  }
}

/**
 * Record a calibration sample, and attach the nearest satellite look to it.
 *
 * §9.2 asks for the app to pull the nearest-date NDVI automatically — the
 * person holding the quadrat should not also be looking up which day the
 * satellite passed. The gap in days is stored beside it, because a sample
 * matched to a look eight days away is far weaker evidence than one matched to
 * yesterday, and the regression should be able to tell them apart later.
 */
export function useAddCalibration() {
  const invalidate = useInvalidateCalibration()
  return useMutation({
    mutationFn: async (v: CalibrationInput) => {
      const look = await matchLook(v.pasture_id, v.sampled_on)
      const { error } = await supabase.from('pasture_biomass_calibration').insert({
        pasture_id: v.pasture_id,
        sampled_on: v.sampled_on,
        method: v.method,
        measured_kg_dm_ha: v.measured_kg_dm_ha,
        ...look,
        sample_point:
          v.lat != null && v.lon != null ? `SRID=4326;POINT(${v.lon} ${v.lat})` : null,
        notes: v.notes,
      })
      if (error) throw error
      return { matchedGapDays: look.observation_gap_days }
    },
    onSuccess: invalidate,
  })
}

export type CalibrationSample = {
  id: string
  pasture_id: string | null
  sampled_on: string
  method: CalibrationInput['method']
  measured_kg_dm_ha: number
  ndvi_at_sample: number | null
  observation_gap_days: number | null
  notes: string | null
  created_by: string | null
  created_at: string
}

/**
 * The forage samples on file, newest first. Recorded from the rotation list
 * but never shown until 7 Oct 2026 (Sam: every row opens, edits, deletes).
 */
export function useCalibrationSamples() {
  return useQuery({
    queryKey: ['pasture-calibration-samples'],
    queryFn: async (): Promise<CalibrationSample[]> => {
      const { data, error } = await supabase
        .from('pasture_biomass_calibration')
        .select('id, pasture_id, sampled_on, method, measured_kg_dm_ha, ndvi_at_sample, observation_gap_days, notes, created_by, created_at')
        .order('sampled_on', { ascending: false })
        .limit(500)
      if (error) throw error
      return (data ?? []).map((r) => ({
        ...(r as unknown as CalibrationSample),
        measured_kg_dm_ha: Number(r.measured_kg_dm_ha),
        ndvi_at_sample: num(r.ndvi_at_sample),
      }))
    },
  })
}

/** Correct a sample; a new pasture or date is matched to its nearest satellite look again. */
export function useUpdateCalibration() {
  const invalidate = useInvalidateCalibration()
  return useMutation({
    mutationFn: async ({
      before,
      patch,
    }: {
      before: CalibrationSample
      patch: Pick<CalibrationSample, 'pasture_id' | 'sampled_on' | 'method' | 'measured_kg_dm_ha' | 'notes'>
    }) => {
      const moved = patch.pasture_id !== before.pasture_id || patch.sampled_on !== before.sampled_on
      const look = moved && patch.pasture_id ? await matchLook(patch.pasture_id, patch.sampled_on) : {}
      // The generated Update type lists only weight and notes; the table takes all of these.
      const { error } = await (supabase as unknown as SupabaseClient)
        .from('pasture_biomass_calibration')
        .update({ ...patch, ...look })
        .eq('id', before.id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
}

export function useDeleteCalibration() {
  const invalidate = useInvalidateCalibration()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('pasture_biomass_calibration').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
}

/** Plain words for each readiness state (spec §9.3). */
export const READINESS_LABEL: Record<RotationRow['readiness'], string> = {
  not_ready: 'Not ready',
  ready: 'Ready',
  optimal: 'Optimal',
  overmature: 'Overmature',
  overgrazed: 'Overgrazed',
}

export const READINESS_TONE: Record<RotationRow['readiness'], string> = {
  optimal: 'bg-green-100 text-green-800',
  ready: 'bg-emerald-50 text-emerald-700',
  overmature: 'bg-amber-100 text-amber-800',
  not_ready: 'bg-gray-100 text-gray-600',
  overgrazed: 'bg-red-100 text-red-800',
}

/**
 * Record where a pasture's water is (spec §9.4).
 *
 * Nothing in the underutilisation map exists without this: the whole finding is
 * "ground more than 800 m from water is carrying forage the herd is not
 * touching", and there is no such thing as 800 m from an unknown point.
 * Guessing at the centroid was considered and rejected — it would produce a
 * confident map of nothing.
 *
 * MULTIPOINT because a paddock often has more than one source: a dugout and a
 * spring, a trough and a creek. The band is built from distance to the NEAREST
 * of them, which is what the cattle actually respond to.
 */
export function useSetWaterSource() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { pastureId: string; points: { lat: number; lon: number }[] }) => {
      const wkt = v.points.length
        ? `SRID=4326;MULTIPOINT(${v.points.map((p) => `(${p.lon} ${p.lat})`).join(',')})`
        : null
      const { error } = await supabase
        .from('pastures')
        .update({ water_source_geom: wkt })
        .eq('id', v.pastureId)
      if (error) throw error
      // Bands are derived from these points, so they are stale the moment a
      // point moves. Rebuilt here rather than waiting for the overnight run.
      const { error: rebuildErr } = await supabase.rpc('rebuild_pasture_zones')
      if (rebuildErr) throw rebuildErr
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['pastures'] })
      void qc.invalidateQueries({ queryKey: ['pasture-underutilisation'] })
    },
  })
}

export type Underutilisation = {
  pasture_id: string
  name: string
  near_water_ndvi: number | null
  far_water_ndvi: number | null
  ndvi_gap: number | null
  far_water_acres: number | null
  same_day: boolean
  finding: string
  actionable: boolean
}

/** Where the herd is not going, and how many acres of it (spec §9.4). */
export function useUnderutilisation() {
  return useQuery({
    queryKey: ['pasture-underutilisation'],
    queryFn: async () => {
      const { data, error } = await supabase.from('pasture_underutilisation').select('*')
      if (error) throw error
      return (data ?? []).map((r) => ({
        ...(r as unknown as Underutilisation),
        ndvi_gap: num((r as Record<string, unknown>).ndvi_gap as number),
        far_water_acres: num((r as Record<string, unknown>).far_water_acres as number),
        near_water_ndvi: num((r as Record<string, unknown>).near_water_ndvi as number),
        far_water_ndvi: num((r as Record<string, unknown>).far_water_ndvi as number),
      })) as Underutilisation[]
    },
    staleTime: 10 * 60_000,
  })
}

/**
 * Take every drinkable water pin from the Google My Map (spec §9.4).
 *
 * The map is the source of truth: the function REPLACES what is stored rather
 * than merging, so a pin deleted in My Maps disappears here too. Merging would
 * make a removal impossible without hunting it down by hand.
 */
export function useImportWaterSources() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (points: { lat: number; lon: number; name: string }[]) => {
      const { data, error } = await supabase.rpc('import_pasture_water', {
        p_points: points as unknown as never,
      })
      if (error) throw error
      const row = (Array.isArray(data) ? data[0] : data) as
        | { pastures_updated: number; points_matched: number; points_outside: number }
        | null
      return row ?? { pastures_updated: 0, points_matched: 0, points_outside: 0 }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['pastures'] })
      void qc.invalidateQueries({ queryKey: ['pasture-water-points'] })
      void qc.invalidateQueries({ queryKey: ['pasture-underutilisation'] })
    },
  })
}

/** Every stored water point, so the map can pin them. */
export function useWaterPoints() {
  return useQuery({
    queryKey: ['pasture-water-points'],
    queryFn: async () => {
      const { data, error } = await supabase.from('pasture_water_points').select('*')
      if (error) throw error
      return (data ?? []) as unknown as {
        pasture_id: string
        name: string
        lat: number
        lon: number
      }[]
    },
    staleTime: 10 * 60_000,
  })
}
