import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { MultiPolygon } from 'geojson'
import { supabase } from './supabase'
import { haversineM } from './geo/measure'
import { isWaterSourceName, NOT_WATER_WORDS } from './water-sources'

/**
 * Where the cattle drink, as pins a person owns.
 *
 * Every pin from the Google My Map's "Water" layer was brought over once
 * (September 2026), drinkable or not, and from then on this table is the
 * record: rename, drag, delete, add a trough. The 800 m reach — the ground a
 * herd will actually use — is computed in the database from the drinkable
 * pins plus the river where a pasture fronts it, and clipped to the pasture.
 */
export type WaterKind = 'dugout' | 'pond' | 'trough' | 'spring' | 'well' | 'other'

export const WATER_KINDS: { value: WaterKind; label: string }[] = [
  { value: 'dugout', label: 'Dugout' },
  { value: 'pond', label: 'Pond / slough' },
  { value: 'trough', label: 'Trough (portable)' },
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
}

export type RiverAccess = 'none' | 'all' | 'north_of'

/** The map layers the reach is drawn with, so the map can keep them above imagery. */
export const WATER_REACH_LAYERS = ['water-reach-beyond', 'water-reach-within', 'water-reach-line']

export type WaterReach = {
  pasture_id: string
  name: string
  river_access: RiverAccess
  river_access_ref: string | null
  reach_geojson: MultiPolygon | null
  beyond_geojson: MultiPolygon | null
  reach_acres: number
  beyond_acres: number
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
        beyond_acres: Number(r.beyond_acres ?? 0),
      })) as WaterReach[]
    },
    enabled,
    // Two seconds of PostGIS per read, and it only changes when a pin or a
    // pasture does — pin edits invalidate it (`touched` below), so a long
    // staleTime costs nothing in accuracy and saves a refetch on every focus.
    staleTime: 30 * 60_000,
  })
}

const touched = ['cattle-water', 'water-reach', 'pasture-underutilisation', 'pastures']

export function useWaterMutations() {
  const qc = useQueryClient()
  const refresh = () => {
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
    mutationFn: async (v: { id: string; name?: string | null; kind?: WaterKind; drinkable?: boolean; notes?: string | null; lon?: number; lat?: number; serves?: string[] }) => {
      const patch: {
        name?: string | null
        kind?: WaterKind
        drinkable?: boolean
        geom?: string
        notes?: string | null
        serves?: string[]
        updated_at?: string
      } = { updated_at: new Date().toISOString() }
      if (v.serves) patch.serves = v.serves
      if ('name' in v) patch.name = v.name
      if (v.kind) patch.kind = v.kind
      if (typeof v.drinkable === 'boolean') patch.drinkable = v.drinkable
      if ('notes' in v) patch.notes = v.notes
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
