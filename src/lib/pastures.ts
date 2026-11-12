import { useCallback, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { MultiPolygon } from 'geojson'
import { supabase } from './supabase'
import { useRanches } from './ranches'
import { nearestPerSubject } from './map-as-of'

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

/** Which ranch each mapped pasture is linked to, from the Grazing tab's pasture list. */
export function usePastureRanchLinks() {
  return useQuery({
    queryKey: ['pasture-ranch-links'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('grazing_pastures')
        .select('pasture_id, ranch_id')
        .not('pasture_id', 'is', null)
      if (error) throw error
      // grazing_pastures.pasture_id is in the database but not in the hand-kept types.
      const rows = (data ?? []) as unknown as { pasture_id: string | null; ranch_id: string | null }[]
      return new Map(rows.filter((r) => r.pasture_id && r.ranch_id).map((r) => [r.pasture_id!, r.ranch_id!]))
    },
    staleTime: 10 * 60_000,
  })
}

/**
 * The ranch a mapped pasture belongs to.
 *
 * Its Grazing-tab link when it has one; otherwise the ranch its legal
 * description names — the farm's rough outer boundary is a East Ranch shape
 * with no grazing link, and must not count as a Home Ranch paddock. Null when
 * neither says, which shows it under All only.
 */
export function pastureRanchId(
  p: Pick<Pasture, 'id' | 'ranch'>,
  links: Map<string, string>,
  ranches: { id: string; name: string }[],
): string | null {
  const linked = links.get(p.id)
  if (linked) return linked
  const named = (p.ranch ?? '').trim().toLowerCase()
  if (!named) return null
  return ranches.find((r) => r.name.trim().toLowerCase() === named)?.id ?? null
}

/** The pastures on one ranch; every pasture when ranchId is '' (All). */
export function pasturesForRanch<T extends Pick<Pasture, 'id' | 'ranch'>>(
  pastures: T[],
  ranchId: string,
  links: Map<string, string>,
  ranches: { id: string; name: string }[],
): T[] {
  if (!ranchId) return pastures
  return pastures.filter((p) => pastureRanchId(p, links, ranches) === ranchId)
}

/**
 * The mapped pastures that are real paddocks — the ones a ranch's grazing list
 * links to.
 *
 * `pastures` also holds farm outlines. "Farm Outer Boundary (Rough)" is a
 * 2,922-acre shape covering the whole of East Ranch, and anything that treats
 * it as a paddock says something silly: the water-reach view counts the herd as
 * shut out of the entire farm, and the rotation order offers "move the cattle
 * to the outer boundary" as the next step (Sam, 10 Nov 2026 — on East Ranch,
 * which has no paddocks drawn, it was the only thing the list offered).
 *
 * Same rule as the `is_paddock` column on pasture_water_gap, so the two agree.
 */
export function paddocksOnly<T extends Pick<Pasture, 'id'>>(pastures: T[], links: Map<string, string>): T[] {
  return pastures.filter((p) => links.has(p.id))
}

/**
 * A test for "is this paddock on the ranch the Cattle filter is set to", for
 * the cards that are keyed by pasture rather than by ranch.
 *
 * Always true when the filter is All, so a card can use it unconditionally.
 * Sam, 10 Nov 2026: the East Ranch tab was showing Home Ranch's troughs and
 * Home Ranch's unused acres, because those cards read every pasture.
 */
export function useOnRanch(ranchId: string): (pastureId: string | null | undefined) => boolean {
  const { data: pastures } = useRanchScopedPastures(ranchId)
  const { data: links } = usePastureRanchLinks()
  const ids = useMemo(
    () => new Set(paddocksOnly(pastures ?? [], links ?? new Map()).map((p) => p.id)),
    [pastures, links],
  )
  return useCallback((pastureId) => !ranchId || (!!pastureId && ids.has(pastureId)), [ranchId, ids])
}

/** usePastures narrowed to the Ranch filter ('' = All). */
export function useRanchScopedPastures(ranchId: string) {
  const q = usePastures()
  const { data: links } = usePastureRanchLinks()
  const { data: ranches } = useRanches()
  const data = useMemo(
    () => (q.data ? pasturesForRanch(q.data, ranchId, links ?? new Map(), ranches ?? []) : undefined),
    [q.data, ranchId, links, ranches],
  )
  return { data, isLoading: q.isLoading }
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
  /** A past day (YYYY-MM-DD): each subject's image taken nearest it, instead of the latest. */
  asOf: string | null = null,
) {
  return useQuery({
    queryKey: ['sat-latest-image', kind, subjectType, asOf],
    queryFn: async (): Promise<FieldImage[]> => {
      let rows: Omit<FieldImage, 'url'>[]
      if (asOf) {
        // Within four months either side; nearer than that is always on file in season.
        const at = Date.parse(`${asOf}T00:00:00Z`)
        const span = (d: number) => new Date(at + d * 86_400_000).toISOString().slice(0, 10)
        const { data, error } = await supabase
          .from('sat_images')
          .select('subject_id, sensed_on, storage_path, west, south, east, north, stretch_min, stretch_max')
          .eq('subject_type', subjectType)
          .eq('kind', kind)
          .gte('sensed_on', span(-120))
          .lte('sensed_on', span(120))
        if (error) throw new Error(`reading sat_images: ${error.message}`)
        rows = nearestPerSubject(data ?? [], asOf).map((r) => ({
          ...r,
          days_old: Math.round((Date.now() - Date.parse(`${r.sensed_on}T00:00:00Z`)) / 86_400_000),
        })) as unknown as Omit<FieldImage, 'url'>[]
      } else {
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
        rows = (data ?? []) as unknown as Omit<FieldImage, 'url'>[]
      }
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

/** One satellite pass: the day it was taken and how many subjects it covered. */
export type ImageryDay = { day: string; subjects: number }

/**
 * Every day there is imagery of this kind on file, newest last.
 *
 * The date picker needs these rather than a bare calendar. Sentinel-2 comes
 * over every few days and cloud decides whether anything usable lands, so most
 * dates hold no new picture — and a paddock is only in the pass that saw it,
 * which is why the count matters: a day covering 3 of 17 paddocks makes a poor
 * screenshot, and nothing on screen would otherwise say so.
 */
export function useImageryDays(
  kind: 'truecolour' | 'ndvi' | 'ndvi_field' | 'ndre' = 'truecolour',
  subjectType: 'field' | 'pasture' = 'pasture',
) {
  return useQuery({
    queryKey: ['sat-imagery-days', kind, subjectType],
    queryFn: async (): Promise<ImageryDay[]> => {
      const { data, error } = await supabase
        .from('sat_images')
        .select('sensed_on, subject_id')
        .eq('subject_type', subjectType)
        .eq('kind', kind)
      if (error) throw new Error(`reading imagery days: ${error.message}`)
      const perDay = new Map<string, Set<string>>()
      for (const r of (data ?? []) as unknown as { sensed_on: string; subject_id: string }[]) {
        const set = perDay.get(r.sensed_on) ?? new Set<string>()
        set.add(r.subject_id)
        perDay.set(r.sensed_on, set)
      }
      return [...perDay.entries()]
        .map(([day, subjects]) => ({ day, subjects: subjects.size }))
        .sort((a, b) => a.day.localeCompare(b.day))
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
