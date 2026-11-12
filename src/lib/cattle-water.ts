import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { MultiPolygon } from 'geojson'
import { supabase } from './supabase'
import { haversineM } from './geo/measure'
import { isWaterSourceName, NOT_WATER_WORDS } from './water-sources'
import type { FedBy } from './district-water'

/**
 * Where the cattle drink, as pins a person owns.
 *
 * Every pin from the Google My Map's "Water" layer was brought over once
 * (September 2026), drinkable or not, and from then on this table is the
 * record: rename, drag, delete, add a trough. The reach — the ground a herd
 * will actually graze — is computed in the database from the drinkable pins
 * plus the river where a pasture fronts it, and clipped to the pasture.
 *
 * 250 m and 800 m are a RECOMMENDATION, not a limit: 250 m is the BCRC's
 * "ideal distance to water" (800 ft) and where SDSU puts the start of the
 * rapid falloff in use; 800 m is where it has thinned out. Cattle will walk
 * two miles on flat ground. docs/grazing-distance-evidence.md says why.
 */
export type WaterKind = 'dugout' | 'pond' | 'trough' | 'trough_portable' | 'spring' | 'well' | 'other'

export const WATER_KINDS: { value: WaterKind; label: string }[] = [
  { value: 'dugout', label: 'Dugout' },
  { value: 'pond', label: 'Pond / slough' },
  // Permanent and moveable are separate kinds again (Sam, 11 Nov 2026), and
  // this time the distinction is read rather than decorative: the placement
  // recommender may propose moving a moveable trough and must never propose
  // moving a plumbed one. The two between Pasture D and E -- West Water
  // Trough and East Trough -- are plumbed in, as is the shop yard corral
  // trough, so those stay `trough`. The reach itself is still built from
  // `drinkable` alone, the same for both.
  { value: 'trough', label: 'Trough (permanent)' },
  { value: 'trough_portable', label: 'Trough (moveable)' },
  { value: 'spring', label: 'Spring' },
  { value: 'well', label: 'Well' },
  { value: 'other', label: 'Other' },
]

export type WaterSource = {
  id: string
  name: string | null
  kind: WaterKind
  drinkable: boolean
  source: 'mymap' | 'manual'
  notes: string | null
  lon: number
  lat: number
  pasture_id: string | null
  pasture_name: string | null
  /** Paddocks this water counts for whatever the distance — a corral trough the cattle walk out to. */
  serves: string[]
  /**
   * Where the water comes from, when it is not its own: the river or the
   * canal. Set, the quality is read from that source's monitoring instead of
   * waiting for a lab sheet. Null is a dugout or a slough — the common case.
   */
  fed_by: FedBy | null
}

/** Either kind of trough. Most of the app cares that it is a trough, not which. */
export function isTrough(kind: WaterKind): boolean {
  return kind === 'trough' || kind === 'trough_portable'
}

/** Only these may be picked up and put somewhere else. */
export function isMoveable(kind: WaterKind): boolean {
  return kind === 'trough_portable'
}

export type RiverAccess = 'none' | 'all' | 'north_of'

/** The map layers the reach is drawn with, so the map can keep them above imagery. */
export const WATER_REACH_LAYERS = [
  'water-reach-beyond',
  'water-reach-margin',
  'water-reach-within',
  'water-reach-line',
]

export type WaterReach = {
  pasture_id: string
  name: string
  river_access: RiverAccess
  river_access_ref: string | null
  reach_geojson: MultiPolygon | null
  /** The 250–800 m band: grazed, but less evenly the further out. */
  margin_geojson: MultiPolygon | null
  beyond_geojson: MultiPolygon | null
  reach_acres: number
  margin_acres: number
  beyond_acres: number
  /** A drinkable source reaches this paddock at all, at the outer radius. */
  has_water: boolean
  /** The grazing plan uses this one — `pastures` also holds farm outlines. */
  is_paddock: boolean
  near_m: number
  far_m: number
}

/**
 * What a My Map pin's name says it is.
 *
 * The plumbing words win outright: "pivot pond" is a pivot. A pin that says
 * nothing is taken as drinkable, because on that layer an unnamed pin is far
 * more often a dugout than a valve — and it is shown so it can be corrected.
 */
export function classifyWaterName(name: string | null | undefined): { kind: WaterKind; drinkable: boolean } {
  const n = (name ?? '').trim().toLowerCase()
  if (!n) return { kind: 'other', drinkable: true }
  // A well is plumbing here: the water is down a pipe, not in a trough,
  // unless someone marks it drinkable.
  const plumbing = [...NOT_WATER_WORDS, 'well', 'faucet', 'gate', 'potential', 'irrigation', '#']
  if (plumbing.some((w) => n.includes(w))) {
    return { kind: n.includes('well') ? 'well' : 'other', drinkable: false }
  }
  if (n.includes('trough') || n.includes('waterer')) return { kind: 'trough', drinkable: true }
  if (n.includes('dugout') || n.includes('water hole') || n.includes('waterhole') || n.includes('watering hole'))
    return { kind: 'dugout', drinkable: true }
  if (n.includes('spring')) return { kind: 'spring', drinkable: true }
  if (n.includes('pond') || n.includes('slough') || n.includes('dam') || n.includes('reservoir'))
    return { kind: 'pond', drinkable: true }
  // Named, and not plumbing: on the Water layer that is a drink until someone
  // says otherwise. isWaterSourceName is the stricter test the old import
  // used; it is kept for the sync's "certain" count.
  return { kind: 'other', drinkable: true }
}

/** The old importer's stricter test, for saying how many pins are certain. */
export const isCertainWater = (name: string | null | undefined) => isWaterSourceName(name)

/** Pins on the My Map that are not already here, by position. */
export function newPinsFrom<T extends { lon: number; lat: number }>(
  points: T[],
  existing: { lon: number; lat: number }[],
  withinM = 10,
): T[] {
  return points.filter(
    (p) => !existing.some((e) => haversineM([e.lon, e.lat], [p.lon, p.lat]) <= withinM),
  )
}

const ewkt = (lon: number, lat: number) => `SRID=4326;POINT(${lon} ${lat})`

export function useCattleWater() {
  return useQuery({
    queryKey: ['cattle-water'],
    queryFn: async (): Promise<WaterSource[]> => {
      const { data, error } = await supabase.from('cattle_water_points').select('*').order('name')
      if (error) throw error
      return (data ?? []).map((r) => ({ ...r, lon: Number(r.lon), lat: Number(r.lat), serves: r.serves ?? [] })) as WaterSource[]
    },
    staleTime: 5 * 60_000,
  })
}

/** The reach polygons, recomputed by the database from the current pins. */
export function useWaterReach(enabled = true) {
  return useQuery({
    queryKey: ['water-reach'],
    queryFn: async (): Promise<WaterReach[]> => {
      const { data, error } = await supabase.from('pasture_water_reach_geojson').select('*')
      if (error) throw error
      return (data ?? []).map((r) => ({
        ...r,
        reach_acres: Number(r.reach_acres ?? 0),
        margin_acres: Number(r.margin_acres ?? 0),
        beyond_acres: Number(r.beyond_acres ?? 0),
        near_m: Number(r.near_m ?? 250),
        far_m: Number(r.far_m ?? 800),
      })) as WaterReach[]
    },
    enabled,
    // Two seconds of PostGIS per read, and it only changes when a pin or a
    // pasture does — pin edits invalidate it (`touched` below), so a long
    // staleTime costs nothing in accuracy and saves a refetch on every focus.
    staleTime: 30 * 60_000,
  })
}

export type WaterReachAcres = {
  pasture_id: string
  name: string
  reach_acres: number
  margin_acres: number
  beyond_acres: number
  has_water: boolean
  is_paddock: boolean
  near_m: number
  far_m: number
}

/**
 * The same reach, counted rather than drawn (spec §9.4).
 *
 * "Ground the herd is not using" wants one number — the acres shaded red on
 * the map — and nothing else. Asking the geojson view for it would drag two
 * multipolygons per pasture across the wire for a total; selecting only the
 * acre columns lets Postgres skip the ST_AsGeoJSON calls entirely, because the
 * view is simple enough to inline. The PostGIS behind `pasture_water_reach`
 * still runs, so this is about a second: its own key, a long staleTime, and it
 * only fires when the card is actually open.
 *
 * A pasture with no water pin comes back `has_water = false` and its whole
 * area as `beyond_acres`. That is not 4,000 acres of unused grass, it is a
 * pasture nobody has marked water on, so the card counts those separately.
 * `is_paddock` drops the farm-outline rows that also live in `pastures`.
 */
export function useWaterReachAcres(enabled = true) {
  return useQuery({
    queryKey: ['water-reach-acres'],
    queryFn: async (): Promise<WaterReachAcres[]> => {
      const { data, error } = await supabase
        .from('pasture_water_reach_geojson')
        .select('pasture_id,name,reach_acres,margin_acres,beyond_acres,has_water,is_paddock,near_m,far_m')
      if (error) throw error
      return (data ?? []).map((r) => ({
        pasture_id: r.pasture_id as string,
        name: r.name as string,
        reach_acres: Number(r.reach_acres ?? 0),
        margin_acres: Number(r.margin_acres ?? 0),
        beyond_acres: Number(r.beyond_acres ?? 0),
        has_water: Boolean(r.has_water),
        is_paddock: Boolean(r.is_paddock),
        near_m: Number(r.near_m ?? 250),
        far_m: Number(r.far_m ?? 800),
      }))
    },
    enabled,
    staleTime: 30 * 60_000,
  })
}

export type WaterGap = {
  pasture_id: string
  name: string
  acres: number
  nearest_source: string | null
  metres_outside: number | null
}

/**
 * Paddocks a cow cannot get a drink in.
 *
 * No drinkable source inside the fence or in it, nobody has named the paddock
 * on a source's `serves` list, and no river frontage. That is a job rather
 * than a fault, so the nearest source the fence rule had to refuse comes back
 * with it: 39 m outside usually means the pin wants moving, 400 m means
 * somebody has to say whether the cattle really walk there.
 */
export function useWaterGaps(enabled = true) {
  return useQuery({
    queryKey: ['water-gaps'],
    queryFn: async (): Promise<WaterGap[]> => {
      const { data, error } = await supabase
        .from('pasture_water_gap')
        .select('pasture_id,name,acres,nearest_source,metres_outside')
        .eq('is_paddock', true)
      if (error) throw error
      return (data ?? []).map((r) => ({
        pasture_id: r.pasture_id as string,
        name: r.name as string,
        acres: Number(r.acres ?? 0),
        nearest_source: (r.nearest_source as string | null) ?? null,
        metres_outside: r.metres_outside == null ? null : Number(r.metres_outside),
      }))
    },
    enabled,
    staleTime: 30 * 60_000,
  })
}

const touched = [
  'cattle-water',
  'water-reach',
  'water-reach-acres',
  'water-gaps',
  'pasture-underutilisation',
  'pastures',
]

/**
 * Rebuild the distance-from-water bands for whatever this edit changed.
 *
 * The bands used to be worked out live on every read, so invalidating the
 * query was enough. They are stored now — the live version took 8.17 s against
 * an 8 s timeout — and the satellite run only rebuilds six paddocks every four
 * hours. Without this, un-ticking "drinkable" on a trough left its shading on
 * the map for most of a day.
 *
 * The rebuild does nothing for a paddock whose water has not changed, so this
 * is cheap: it compares a digest per paddock and goes home.
 *
 * `rounds` is for the gate toggles, which can dirty every paddock on a ranch
 * at once — more than the six a single call will do. An edit to one pin never
 * needs more than the default.
 *
 * Not thrown on: the edit itself succeeded, and a briefly stale band is worth
 * less than telling somebody their trough was not saved. The next pasture run
 * picks it up.
 */
export async function rebuildBands(rounds = 1) {
  // Six paddocks a call, so a change that dirties more than six needs more
  // than one round. Every round runs: the function returns the TOTAL number
  // of band rows on file rather than how many it just built, and since every
  // paddock has the same number of bands that total does not move when it
  // rebuilds six — so there is no number here to stop on. A round with
  // nothing stale is a keys scan and no geometry, which is the cheap case.
  for (let i = 0; i < rounds; i += 1) {
    const { error } = await supabase.rpc('rebuild_pasture_zones')
    if (error) {
      console.warn('water bands not rebuilt:', error.message)
      return
    }
  }
}

export function useWaterMutations() {
  const qc = useQueryClient()
  const refresh = async () => {
    await rebuildBands()
    for (const k of touched) void qc.invalidateQueries({ queryKey: [k] })
  }
  const add = useMutation({
    mutationFn: async (v: { lon: number; lat: number; name?: string | null; kind?: WaterKind; drinkable?: boolean; source?: 'mymap' | 'manual' }) => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      const { data, error } = await supabase
        .from('cattle_water')
        .insert({
          name: v.name ?? null,
          kind: v.kind ?? 'other',
          drinkable: v.drinkable ?? true,
          geom: ewkt(v.lon, v.lat),
          source: v.source ?? 'manual',
          created_by: user?.id ?? null,
        })
        .select('id')
        .single()
      if (error) throw error
      return data.id as string
    },
    onSuccess: refresh,
  })
  const addMany = useMutation({
    mutationFn: async (rows: { lon: number; lat: number; name: string | null; kind: WaterKind; drinkable: boolean }[]) => {
      if (!rows.length) return 0
      const { error } = await supabase.from('cattle_water').insert(
        rows.map((v) => ({
          name: v.name,
          kind: v.kind,
          drinkable: v.drinkable,
          geom: ewkt(v.lon, v.lat),
          source: 'mymap' as const,
        })),
      )
      if (error) throw error
      return rows.length
    },
    onSuccess: refresh,
  })
  const update = useMutation({
    mutationFn: async (v: { id: string; name?: string | null; kind?: WaterKind; drinkable?: boolean; notes?: string | null; lon?: number; lat?: number; serves?: string[]; fed_by?: FedBy | null }) => {
      const patch: {
        name?: string | null
        kind?: WaterKind
        drinkable?: boolean
        geom?: string
        notes?: string | null
        serves?: string[]
        fed_by?: FedBy | null
        updated_at?: string
      } = { updated_at: new Date().toISOString() }
      if (v.serves) patch.serves = v.serves
      if ('name' in v) patch.name = v.name
      if (v.kind) patch.kind = v.kind
      if (typeof v.drinkable === 'boolean') patch.drinkable = v.drinkable
      if ('notes' in v) patch.notes = v.notes
      if ('fed_by' in v) patch.fed_by = v.fed_by
      if (typeof v.lon === 'number' && typeof v.lat === 'number') patch.geom = ewkt(v.lon, v.lat)
      const { error } = await supabase.from('cattle_water').update(patch).eq('id', v.id)
      if (error) throw error
    },
    onSuccess: refresh,
  })
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('cattle_water').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: refresh,
  })
  return { add, addMany, update, remove }
}

/** Which part of a pasture can get to the river. */
export function useSetRiverAccess() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { pasture_id: string; river_access: RiverAccess; river_access_ref: string | null }) => {
      const { error } = await supabase
        .from('pastures')
        .update({
          river_access: v.river_access,
          river_access_ref: v.river_access === 'north_of' ? v.river_access_ref : null,
        })
        .eq('id', v.pasture_id)
      if (error) throw error
    },
    onSuccess: () => {
      for (const k of touched) void qc.invalidateQueries({ queryKey: [k] })
    },
  })
}
