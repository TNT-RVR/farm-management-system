import { useQuery } from '@tanstack/react-query'
import type { MultiPolygon } from 'geojson'
import { supabase } from './supabase'

// Pastures, and whatever the satellite module currently knows about them.
//
// The NDVI fields are null until ingestion runs, and null is the honest answer.
// A paddock with no imagery is drawn in a neutral colour and labelled "no
// imagery yet" — never shaded a green it has not earned.

export type Pasture = {
  id: string
  name: string
  ranch: string | null
  pasture_type: string | null
  area_acres: number | null
  satellite_enabled: boolean
  geojson: MultiPolygon
  ndvi: number | null
  biomass_kg_dm_ha: number | null
  days_since_observation: number | null
  confidence: 'high' | 'medium' | 'low' | null
  ndvi_day: string | null
}

const num = (v: number | string | null | undefined): number | null => {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

export function usePastures() {
  return useQuery({
    queryKey: ['pastures'],
    queryFn: async () => {
      const { data, error } = await supabase.from('pasture_map').select('*').order('name')
      if (error) throw error
      return (data ?? []).map((p) => ({
        ...p,
        area_acres: num(p.area_acres as number | string | null),
        ndvi: num(p.ndvi as number | string | null),
        biomass_kg_dm_ha: num(p.biomass_kg_dm_ha as number | string | null),
      })) as unknown as Pasture[]
    },
    staleTime: 10 * 60_000,
  })
}

/** The satellite view of each crop field, for shading the main map. */
export type FieldSatellite = {
  field_id: string
  name: string
  satellite_enabled: boolean
  ndvi: number | null
  fcover: number | null
  days_since_observation: number | null
  confidence: 'high' | 'medium' | 'low' | null
  ndvi_day: string | null
  last_observed_on: string | null
}

export function useFieldSatellite() {
  return useQuery({
    queryKey: ['field-satellite'],
    queryFn: async () => {
      const { data, error } = await supabase.from('field_satellite').select('*')
      if (error) throw error
      return (data ?? []).map((f) => ({
        ...f,
        ndvi: num(f.ndvi as number | string | null),
        fcover: num(f.fcover as number | string | null),
      })) as unknown as FieldSatellite[]
    },
    staleTime: 10 * 60_000,
  })
}

/** The newest real picture of a field, placed by its own corners. */
export type FieldImage = {
  subject_id: string
  sensed_on: string
  storage_path: string
  west: number
  south: number
  east: number
  north: number
  days_old: number
  /** The NDVI range this image's colours span. Null for a photograph. */
  stretch_min: number | null
  stretch_max: number | null
  /** A short-lived signed URL; the bucket is private. */
  url: string
}

/**
 * Latest imagery, with signed URLs resolved.
 *
 * The bucket is private, so each path is signed before the map can draw it. An
 * hour is comfortably longer than anyone leaves a map open and short enough
 * that a leaked URL stops working the same morning.
 */
export function useFieldImagery(
  kind: 'truecolour' | 'ndvi' | 'ndvi_field' | 'ndre' = 'truecolour',
  subjectType: 'field' | 'pasture' = 'field',
) {
  return useQuery({
    queryKey: ['sat-latest-image', kind, subjectType],
    queryFn: async (): Promise<FieldImage[]> => {
      const { data, error } = await supabase
        .from('sat_latest_image')
        .select('subject_id, sensed_on, storage_path, west, south, east, north, days_old, stretch_min, stretch_max')
        .eq('subject_type', subjectType)
        .eq('kind', kind)
      // Every failure below is reported, never swallowed. The first version
      // returned an empty array whatever went wrong, and the map said "no photo
      // captured yet" — which is indistinguishable from success with no data,
      // and was wrong: three images were sitting in storage the whole time.
      if (error) throw new Error(`reading sat_latest_image: ${error.message}`)
      const rows = (data ?? []) as unknown as Omit<FieldImage, 'url'>[]
      if (!rows.length) return []

      const { data: signed, error: signErr } = await supabase.storage
        .from('satellite-images')
        .createSignedUrls(rows.map((r) => r.storage_path), 3600)
      if (signErr) throw new Error(`signing ${rows.length} image URLs: ${signErr.message}`)

      const urlByPath = new Map<string, string>()
      const perPath: string[] = []
      for (const s of signed ?? []) {
        if (s.signedUrl && s.path) urlByPath.set(s.path, s.signedUrl)
        else if (s.path) perPath.push(`${s.path}: ${s.error ?? 'no url returned'}`)
      }
      const out = rows.flatMap((r) => {
        const url = urlByPath.get(r.storage_path)
        return url
          ? [{
              ...r,
              url,
              stretch_min: r.stretch_min == null ? null : Number(r.stretch_min),
              stretch_max: r.stretch_max == null ? null : Number(r.stretch_max),
              west: Number(r.west),
              south: Number(r.south),
              east: Number(r.east),
              north: Number(r.north),
            }]
          : []
      })
      // Rows exist but none could be signed: a permissions problem, not an
      // absence of imagery, and saying "no photo yet" would send the reader
      // looking in entirely the wrong place.
      if (!out.length) {
        throw new Error(
          `${rows.length} image(s) on file but none could be signed` +
            (perPath.length ? ` — ${perPath.join('; ')}` : ''),
        )
      }
      return out
    },
    staleTime: 30 * 60_000,
  })
}

/** Whether a field has the history zones need (spec §7.1). */
export type ZoneReadiness = {
  field_id: string
  name: string
  qualifying_seasons: number
  best_season_looks: number
  total_full_looks: number
  zones_may_be_generated: boolean
}

export function useZoneReadiness() {
  return useQuery({
    queryKey: ['sat-zone-readiness'],
    queryFn: async () => {
      const { data, error } = await supabase.from('sat_zone_readiness').select('*')
      if (error) throw error
      return (data ?? []) as unknown as ZoneReadiness[]
    },
    staleTime: 30 * 60_000,
  })
}

/** Seasons of 8+ clear looks before zones may be drawn at all (spec §7.1). */
export const ZONE_SEASONS_REQUIRED = 2
export const ZONE_LOOKS_PER_SEASON = 8

/**
 * Why there are no zones yet, in one sentence.
 *
 * §7.1 does not merely forbid generating zones on thin history — it requires
 * the reader be told plainly that this is what is happening. An absent feature
 * with no explanation reads as a broken one, and worse, invites someone to
 * assume the field mean IS the zone map.
 */
export function zoneWaitingMessage(rows: ZoneReadiness[] | undefined): string | null {
  if (!rows?.length) return null
  if (rows.some((r) => r.zones_may_be_generated)) return null
  const best = Math.max(0, ...rows.map((r) => r.best_season_looks))
  return (
    `Within-field zones need ${ZONE_SEASONS_REQUIRED} seasons of ${ZONE_LOOKS_PER_SEASON}+ clear looks; ` +
    `the best field so far has ${best}. Until then this layer shows the field mean only — ` +
    `zones built on one thin season are noise dressed up as insight.`
  )
}

/**
 * NDVI to a colour.
 *
 * Bare ground through to a heavy canopy. Deliberately NOT a rainbow: a
 * continuous ramp in one hue reads as "more or less of the same thing", which
 * is what NDVI is, where a rainbow invites people to read category boundaries
 * that do not exist.
 */
export const NDVI_RAMP: [number, string][] = [
  [0.1, '#a16207'],
  [0.2, '#ca8a04'],
  [0.3, '#a3a635'],
  [0.4, '#84cc16'],
  [0.5, '#4d9f0e'],
  [0.6, '#15803d'],
  [0.75, '#14532d'],
]

/** Grey when there is no reading. An unmeasured paddock is not a bare one. */
export const NO_DATA_COLOUR = '#94a3b8'

export function ndviColour(ndvi: number | null): string {
  if (ndvi == null) return NO_DATA_COLOUR
  for (const [limit, colour] of NDVI_RAMP) if (ndvi <= limit) return colour
  return NDVI_RAMP[NDVI_RAMP.length - 1][1]
}

/**
 * How old the real look behind a served value is, in three bands (spec §4.6).
 *
 * The module serves a value for every day, and most of those days nobody
 * looked. The spec makes the remedy a UI requirement rather than a caption:
 * solid at 0 to 3 days, hatched at 4 to 8, greyed with an explicit warning past
 * 9. A number that has quietly become a week old must not look like this
 * morning's reading.
 */
export type Staleness = 'fresh' | 'ageing' | 'stale'

export function staleness(days: number | null): Staleness {
  if (days == null || days > 8) return 'stale'
  if (days > 3) return 'ageing'
  return 'fresh'
}

/**
 * The age of the last real look, in words, for the field summary.
 *
 * Sam asked for the age to come off the colour and onto the panel: greying a
 * field out hid the reading he wanted to see. §4.6 wants the display to degrade
 * visibly and §14.2 wants the age always visible, so it is stated in the
 * legend and again on the tile rather than encoded in the fill — the value is
 * shown, and what it rests on is written next to it in plain words.
 */
export function ageSentence(days: number | null, lastLook: string | null): string {
  if (days == null || !lastLook) return 'No clear satellite look yet.'
  const when = new Date(`${lastLook}T00:00:00Z`).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })
  if (days === 0) return `Last clear look today (${when}).`
  const plural = days === 1 ? 'day' : 'days'
  const caveat =
    days > 8
      ? ' Every day since is an estimate, not a measurement.'
      : days > 3
        ? ' The days since are interpolated.'
        : ''
  return `Last clear look ${days} ${plural} ago (${when}).${caveat}`
}

/**
 * How stale a reading is, in words.
 *
 * The module must never imply daily imagery, so the age of the last real look
 * is always attached to the number rather than left to be assumed.
 */
export function freshness(days: number | null): { label: string; tone: 'good' | 'fair' | 'poor' } {
  if (days == null) return { label: 'no imagery yet', tone: 'poor' }
  if (days <= 3) return { label: `${days} day${days === 1 ? '' : 's'} old`, tone: 'good' }
  if (days <= 10) return { label: `${days} days old`, tone: 'fair' }
  return { label: `${days} days old`, tone: 'poor' }
}
