/**
 * Reads and writes for distances, fuel, trucking and manure hauling.
 *
 * The arithmetic lives in road-routes.ts, fuel.ts, trucking.ts,
 * manure-haul.ts, spreading.ts and silage-haul.ts; this file only fetches what they need and
 * puts a person's settings over the stated defaults.
 */
import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import type { Json } from './database.types'
import { FUEL_DEFAULTS, type FuelSettings, type OpKind } from './fuel'
import { TRUCK_DEFAULTS, type HaulMode, type TruckSettings } from './trucking'
import { OWN_MANURE_DEFAULTS, tractorFuel, type OwnManureSettings, type TractorFuel, type TractorPass } from './manure-haul'
import { SPREADER_DEFAULTS, type SpreaderInputs } from './spreading'
import { SILAGE_HAUL_DEFAULTS, type SilageCompare, type SilageHaulInputs } from './silage-haul'
import { costingDiesel, type CostingSource } from './fuel-market'
import { typedDefaultOf, useFuelCostingInputs, type FuelCostingInputs } from './fuel-data'
import { OSRM_BASE, binsKey, fieldKey, pitKey, routeBetween, shopKey, siteKey, tripFor, type LatLng, type PitChoice, type RouteRow, type StartKey, type Trip } from './road-routes'
import { TRAIL_KMH_DEFAULT, type Coord } from './trail-router'

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

/* ------------------------------------------------------------- settings */

export type OperatingSettings = Map<string, unknown>

/** The farm's saved operating settings, by key; also read outside React (the Reports page). */
export function operatingSettingsQuery() {
  return {
    queryKey: ['operating_settings'],
    queryFn: async (): Promise<OperatingSettings> => {
      const { data, error } = await supabase.from('operating_settings').select('key, value, updated_at')
      if (error) throw error
      return new Map((data ?? []).map((r) => [r.key, r.value as unknown]))
    },
  }
}

export function useOperatingSettings() {
  const q = useQuery({ ...operatingSettingsQuery(), staleTime: 5 * 60_000 })
  return { ...q, get: (key: string) => q.data?.get(key) }
}

export function useSaveOperatingSetting() {
  const qc = useQueryClient()
  return useMutation({
    networkMode: 'always',
    mutationFn: async (v: { key: string; value: unknown }) => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      const { error } = await supabase
        .from('operating_settings')
        .upsert({ key: v.key, value: v.value as Json, updated_by: user?.id ?? null, updated_at: new Date().toISOString() }, { onConflict: 'key' })
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['operating_settings'] }),
  })
}

/** Remove a setting, so the stated default applies again. */
export function useResetOperatingSetting() {
  const qc = useQueryClient()
  return useMutation({
    networkMode: 'always',
    mutationFn: async (key: string) => {
      const { error } = await supabase.from('operating_settings').delete().eq('key', key)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['operating_settings'] }),
  })
}

export type AbDefaults = { diesel: { perL: number; on: string } | null; wage: { perHour: number; on: string } | null }

/** Alberta's monthly farm input survey: the wage, and diesel's last-resort price. */
export function abDefaultsQuery() {
  return {
    queryKey: ['ab_input_latest', 'fuel-labour'],
    queryFn: async (): Promise<AbDefaults> => {
      const { data, error } = await supabase
        .from('ab_input_latest')
        .select('item_key, item, unit, price, observed_on')
        .in('item_key', ['diesel-fuel-marked-farm-fuel-provincial-allowance-deducted-100-litres', 'general-farm-labour-full-time-without-board-per-month'])
      if (error) throw error
      const diesel = data?.find((r) => r.item_key.startsWith('diesel'))
      const labour = data?.find((r) => r.item_key.startsWith('general-farm-labour'))
      return {
        diesel: diesel ? { perL: Number(diesel.price) / 100, on: diesel.observed_on } : null,
        // A month of full-time work, about 173 hours (40 h × 52 ÷ 12).
        wage: labour ? { perHour: Number(labour.price) / 173.33, on: labour.observed_on } : null,
      }
    },
  }
}

function useAbDefaults() {
  return useQuery({ ...abDefaultsQuery(), staleTime: 60 * 60_000 })
}

/**
 * The labour rate until the farm types its own on Travel & trucking. Sam,
 * 5 Oct 2026: "Lets make the default rate $32" — Alberta's survey (general
 * farm labour, about $24.40/h) is shown beside it for comparison only.
 */
export const DEFAULT_WAGE = 32

export type Basics = {
  dieselPerL: number
  dieselSource: string
  /** Which link of the chain the diesel price came from (fuel-market.ts costingDiesel). */
  dieselFrom: CostingSource
  wage: number
  wageSource: string
  /** True when the number is the farm's own, not a default. */
  dieselSet: boolean
  wageSet: boolean
}

/**
 * Diesel $/L and labour $/h, saying where each came from.
 *
 * Diesel: the trucking screen's override if set, else the newest Fuel supplier
 * farm-diesel invoice, else the market farm-diesel figure, else the typed
 * default on the Fuel page, else Alberta's survey (costingDiesel). This
 * replaced the survey's $1.41/L as the default on 2 Oct 2026, when the farm
 * was paying $2.00.
 */
export function basicsFrom(settings: OperatingSettings | undefined, ab: AbDefaults | undefined, fuel: FuelCostingInputs | undefined): Basics {
  const d = num(settings?.get('diesel_per_l'))
  const w = num(settings?.get('labour_per_hour'))
  const c = costingDiesel({
    override: d,
    invoice: fuel?.invoice,
    market: fuel?.market,
    typed: typedDefaultOf(settings?.get('fuel_default_per_l')),
    survey: ab?.diesel ?? null,
  })
  return {
    dieselPerL: c.perL,
    dieselSource: c.source === 'override' ? c.label : `default: ${c.label}`,
    dieselFrom: c.source,
    dieselSet: c.source === 'override',
    wage: w ?? DEFAULT_WAGE,
    wageSource:
      w != null
        ? 'set by the farm'
        : `default: the farm's $${DEFAULT_WAGE}/h${ab?.wage ? ` (Alberta's survey, general farm labour, ${ab.wage.on}: $${ab.wage.perHour.toFixed(2)}/h)` : ''}`,
    wageSet: w != null,
  }
}

export function useBasics(): Basics {
  const s = useOperatingSettings()
  const { data: ab } = useAbDefaults()
  const { data: fuel } = useFuelCostingInputs()
  return useMemo(() => basicsFrom(s.data, ab, fuel), [s.data, ab, fuel])
}

function merged<T extends object>(defaults: T, saved: unknown): T {
  if (!saved || typeof saved !== 'object') return defaults
  const out = { ...defaults } as Record<string, unknown>
  for (const [k, v] of Object.entries(saved as Record<string, unknown>)) {
    const d = (defaults as Record<string, unknown>)[k]
    if (d && typeof d === 'object') out[k] = merged(d as object, v)
    else if (num(v) != null) out[k] = num(v)
  }
  return out as T
}

/** The farm's fuel settings over the stated defaults, at the costing diesel price. */
export function fuelSettingsFrom(settings: OperatingSettings | undefined, dieselPerL: number): FuelSettings & { saved: Set<string> } {
  const saved = new Set<string>()
  for (const k of ['fuel_l_per_ac', 'road_l_per_km', 'road_kmh']) if (settings?.has(k)) saved.add(k)
  return {
    dieselPerL,
    lPerAc: merged(FUEL_DEFAULTS.lPerAc, settings?.get('fuel_l_per_ac')) as Record<OpKind, number>,
    roadLPerKm: merged(FUEL_DEFAULTS.roadLPerKm, settings?.get('road_l_per_km')) as Record<OpKind, number>,
    roadKmh: merged(FUEL_DEFAULTS.roadKmh, settings?.get('road_kmh')) as Record<OpKind, number>,
    saved,
  }
}

export function useFuelSettings(): FuelSettings & { saved: Set<string> } {
  const s = useOperatingSettings()
  const b = useBasics()
  return useMemo(() => fuelSettingsFrom(s.data, b.dieselPerL), [s.data, b.dieselPerL])
}

export function truckSettingsFrom(settings: OperatingSettings | undefined): { field: TruckSettings; highway: TruckSettings } {
  return { field: merged(TRUCK_DEFAULTS.field, settings?.get('truck_field')), highway: merged(TRUCK_DEFAULTS.highway, settings?.get('truck_highway')) }
}

export function useTruckSettings(): { field: TruckSettings; highway: TruckSettings } {
  const s = useOperatingSettings()
  return useMemo(() => truckSettingsFrom(s.data), [s.data])
}

/**
 * Every pass Deere logged fuel and working time on, with the machine named
 * on it, for the tractors' own burn (manure-haul.ts tractorFuel). Paged:
 * PostgREST stops at 1000.
 */
export function useLoggedTractorPasses() {
  return useQuery({
    queryKey: ['jd_field_operations', 'tractor-fuel'],
    queryFn: async () => {
      const out: TractorPass[] = []
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase
          .from('jd_field_operations')
          .select('id, operation_type, fuel_l, work_minutes, machines:raw->fieldOperationMachines')
          .gt('fuel_l', 0)
          .gt('work_minutes', 0)
          .order('id')
          .range(from, from + 999)
        if (error) throw error
        out.push(...((data ?? []) as unknown as TractorPass[]))
        if ((data ?? []).length < 1000) break
      }
      return out
    },
    staleTime: 30 * 60_000,
  })
}

/**
 * Doing our own manure: the farm's settings over the defaults, with the
 * tractor's burn defaulting to what Deere logged for the farm's spreading
 * tractors rather than a round guess.
 */
export function useOwnManureSettings(): { settings: OwnManureSettings; defaults: OwnManureSettings; fuel: TractorFuel | null } {
  const s = useOperatingSettings()
  const { data: passes } = useLoggedTractorPasses()
  return useMemo(() => {
    const fuel = passes ? tractorFuel(passes) : null
    const defaults = { ...OWN_MANURE_DEFAULTS, tractorLph: fuel ? Math.round(fuel.lph * 10) / 10 : OWN_MANURE_DEFAULTS.tractorLph }
    return { settings: merged(defaults, s.data?.get('manure_own')), defaults, fuel }
  }, [s.data, passes])
}

export function useSpreaderInputs(): SpreaderInputs {
  const s = useOperatingSettings()
  return useMemo(() => merged(SPREADER_DEFAULTS, s.data?.get('spreader')), [s.data])
}

/** Silage's value (the Silage Corn crop price) and dry matter (the feed plan) as the app holds them. */
function useSilageAppFigures(year: number) {
  return useQuery({
    queryKey: ['silage-haul-figures', year],
    queryFn: async () => {
      const [c, f] = await Promise.all([
        supabase.from('crops').select('id, name, crop_prices(crop_year, price_per_unit)').ilike('name', '%silage%'),
        supabase.from('feed_plans').select('silage_dm_pct, updated_at').order('updated_at', { ascending: false }).limit(1),
      ])
      if (c.error) throw c.error
      if (f.error) throw f.error
      // The latest price set for this year or before, as the profit/loss pages read prices.
      let value: { perT: number; year: number; crop: string } | null = null
      for (const crop of (c.data ?? []) as unknown as { name: string; crop_prices: { crop_year: number; price_per_unit: unknown }[] | null }[]) {
        for (const p of crop.crop_prices ?? []) {
          const v = num(p.price_per_unit)
          if (v == null || p.crop_year > year) continue
          if (!value || p.crop_year > value.year) value = { perT: v, year: p.crop_year, crop: crop.name }
        }
      }
      const dm = num(f.data?.[0]?.silage_dm_pct)
      return { value, dmPct: dm != null && dm > 0 ? dm : null }
    },
    staleTime: 10 * 60_000,
  })
}

export type SilagePit = PitChoice

/**
 * The silage calculator's numbers: the farm's settings over defaults, where
 * the defaults for value and dry matter are the app's own figures when it has
 * them, so "default" on screen still means "not typed in here".
 */
export function useSilageHaulInputs(year: number) {
  const s = useOperatingSettings()
  const { data: app } = useSilageAppFigures(year)
  return useMemo(() => {
    const defaults: SilageHaulInputs = {
      ...SILAGE_HAUL_DEFAULTS,
      valuePerT: app?.value?.perT ?? SILAGE_HAUL_DEFAULTS.valuePerT,
      dmPct: app?.dmPct ?? SILAGE_HAUL_DEFAULTS.dmPct,
    }
    const compareRaw = s.data?.get('silage_haul_compare')
    const pitRaw = s.data?.get('silage_haul_pit')
    return {
      inputs: merged(defaults, s.data?.get('silage_haul')),
      defaults,
      valueSource: app?.value ? `${app.value.crop} price, ${app.value.year}` : null,
      dmSource: app?.dmPct != null ? 'the Cattle → Feed plan' : null,
      compare: (compareRaw === 'local' ? 'local' : 'share') as SilageCompare,
      // The pit's own pin once it has one; the shop or the bins if chosen instead.
      pit: (pitRaw === shopKey ? shopKey : pitRaw === binsKey ? binsKey : pitRaw === pitKey || s.data?.has('silage_pit') ? pitKey : binsKey) as SilagePit,
    }
  }, [s.data, app])
}

/** Fields growing silage that year: planned acres, or the year's history once it is in. */
export function useSilageFields(year: number) {
  return useQuery({
    queryKey: ['hauling-silage-fields', year],
    queryFn: async () => {
      type C = { name: string; default_yield_per_acre: unknown; yield_unit: string | null }
      const [h, p] = await Promise.all([
        supabase.from('crop_history').select('field_id, acres, actual_yield_total, yield_unit, crops!inner(name, default_yield_per_acre, yield_unit)').eq('crop_year', year).ilike('crops.name', '%silage%'),
        supabase
          .from('crop_plans')
          .select('field_id, planned_acres, yield_per_acre_override, crops!inner(name, default_yield_per_acre, yield_unit)')
          .eq('crop_year', year)
          .ilike('crops.name', '%silage%'),
      ])
      if (h.error) throw h.error
      if (p.error) throw p.error
      const out = new Map<string, { fieldId: string; acres: number; tonnes: number | null; source: 'scale' | 'plan' | null }>()
      const tonnesOf = (q: number | null, unit: string | null) => {
        // Silage is weighed in tonnes; any other unit is left unweighed rather than guessed.
        const u = (unit ?? '').toLowerCase()
        return q != null && (u === 'mt' || u === 't' || u === 'tonne' || u === 'tonnes') ? q : null
      }
      for (const r of (p.data ?? []) as unknown as { field_id: string; planned_acres: unknown; yield_per_acre_override: unknown; crops: C }[]) {
        const acres = num(r.planned_acres) ?? 0
        const perAc = num(r.yield_per_acre_override) ?? num(r.crops.default_yield_per_acre)
        const prev = out.get(r.field_id)
        const t = tonnesOf(perAc != null ? perAc * acres : null, r.crops.yield_unit)
        out.set(r.field_id, {
          fieldId: r.field_id,
          acres: (prev?.acres ?? 0) + acres,
          tonnes: prev?.tonnes != null || t != null ? (prev?.tonnes ?? 0) + (t ?? 0) : null,
          source: 'plan',
        })
      }
      // What the scale says beats the plan's estimate.
      for (const r of (h.data ?? []) as unknown as { field_id: string; acres: unknown; actual_yield_total: unknown; yield_unit: string | null; crops: C }[]) {
        const t = tonnesOf(num(r.actual_yield_total), r.yield_unit ?? r.crops.yield_unit)
        const prev = out.get(r.field_id)
        if (t == null && prev) continue
        out.set(r.field_id, { fieldId: r.field_id, acres: num(r.acres) ?? prev?.acres ?? 0, tonnes: t ?? prev?.tonnes ?? null, source: t != null ? 'scale' : (prev?.source ?? null) })
      }
      return out
    },
  })
}

/* ------------------------------------------------------------- places */

export type Site = { id: string; name: string; kind: string; active: boolean; lat: number | null; lng: number | null; location_note: string | null }

export function sitesQuery() {
  return {
    queryKey: ['delivery_sites', 'all'],
    queryFn: async () => {
      const { data, error } = await supabase.from('delivery_sites').select('id, name, kind, active, lat, lng, location_note').order('name')
      if (error) throw error
      return (data ?? []) as Site[]
    },
  }
}

export function useSites() {
  return useQuery(sitesQuery())
}

export function useSaveSite() {
  const qc = useQueryClient()
  return useMutation({
    networkMode: 'always',
    mutationFn: async (v: { id?: string; name: string; kind?: string; lat: number | null; lng: number | null; location_note?: string | null; active?: boolean }) => {
      if (v.id) {
        const { error } = await supabase
          .from('delivery_sites')
          .update({ name: v.name.trim(), lat: v.lat, lng: v.lng, location_note: v.location_note ?? null, ...(v.active != null ? { active: v.active } : {}) })
          .eq('id', v.id)
        if (error) throw error
      } else {
        const {
          data: { user },
        } = await supabase.auth.getUser()
        const { error } = await supabase
          .from('delivery_sites')
          .insert({ name: v.name.trim(), kind: v.kind ?? 'elevator', lat: v.lat, lng: v.lng, location_note: v.location_note ?? null, created_by: user?.id ?? null })
        if (error) throw error
      }
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['delivery_sites'] }),
  })
}

export type FarmPlace = { lat: number; lng: number; label: string; note?: string | null }

function placeOf(v: unknown, fallback: string): FarmPlace | null {
  const y = v as { lat?: unknown; lng?: unknown; label?: string; note?: string | null } | undefined
  const lat = num(y?.lat)
  const lng = num(y?.lng)
  return lat != null && lng != null ? { lat, lng, label: y?.label ?? fallback, note: y?.note ?? null } : null
}

export type FarmPlaces = { shop: FarmPlace | null; bins: FarmPlace | null; pit: FarmPlace | null }

/**
 * The two start points: the shop (field work, spraying, every machine going
 * out to a field) and the bins (grain). 'yard' is the bins' old name, read
 * when 'bins' has not been set. And the silage pit ('silage_pit'), which only
 * the silage haul measures from.
 */
export function placesFrom(settings: OperatingSettings | undefined): FarmPlaces {
  return {
    shop: placeOf(settings?.get(shopKey), 'Shop'),
    bins: placeOf(settings?.get(binsKey) ?? settings?.get('yard'), 'Bins'),
    pit: placeOf(settings?.get('silage_pit'), 'Silage pit'),
  }
}

export function usePlaces(): FarmPlaces {
  const s = useOperatingSettings()
  return useMemo(() => placesFrom(s.data), [s.data])
}

/** Km/h on a farm trail, for the time a trail or the last straight bit takes. */
export function useTrailKmh(): { kmh: number; saved: boolean } {
  const s = useOperatingSettings()
  const v = num((s.data?.get('trail_speed') as { kmh?: unknown } | undefined)?.kmh)
  return { kmh: v ?? TRAIL_KMH_DEFAULT, saved: v != null }
}

/* ------------------------------------------------------------- entry pins and trails */

export type FieldEntry = { id: string; field_id: string; lat: number; lng: number; note: string | null }

export function fieldEntriesQuery() {
  return {
    queryKey: ['field_entries'],
    queryFn: async () => {
      const { data, error } = await supabase.from('field_entries').select('id, field_id, lat, lng, note')
      if (error) throw error
      return new Map(((data ?? []) as FieldEntry[]).map((e) => [e.field_id, e]))
    },
  }
}

export function useFieldEntries() {
  return useQuery({ ...fieldEntriesQuery(), staleTime: 10 * 60_000 })
}

/** Drop (or move) a field's entry pin; null takes it away, back to the router's suggestion. */
export function useSaveFieldEntry() {
  const qc = useQueryClient()
  return useMutation({
    networkMode: 'always',
    mutationFn: async (v: { fieldId: string; at: LatLng | null; note?: string | null }) => {
      if (!v.at) {
        const { error } = await supabase.from('field_entries').delete().eq('field_id', v.fieldId)
        if (error) throw error
        return
      }
      const {
        data: { user },
      } = await supabase.auth.getUser()
      const { error } = await supabase.from('field_entries').upsert(
        {
          field_id: v.fieldId,
          lat: Math.round(v.at.lat * 1e6) / 1e6,
          lng: Math.round(v.at.lng * 1e6) / 1e6,
          note: v.note ?? null,
          set_by: user?.id ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'field_id' },
      )
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['field_entries'] }),
  })
}

export type FarmTrail = { id: string; name: string; note: string | null; coords: Coord[]; length_m: number }

export function useTrails() {
  return useQuery({
    queryKey: ['farm_trails'],
    queryFn: async () => {
      const { data, error } = await supabase.from('farm_trails_geojson').select('id, name, note, geometry, length_m').order('name')
      if (error) throw error
      return (data ?? []).map((t) => ({
        id: t.id,
        name: t.name,
        note: t.note,
        coords: ((t.geometry as { coordinates?: Coord[] } | null)?.coordinates ?? []) as Coord[],
        length_m: Number(t.length_m),
      })) as FarmTrail[]
    },
    staleTime: 10 * 60_000,
  })
}

const lineEwkt = (coords: Coord[]) => `SRID=4326;LINESTRING(${coords.map(([x, y]) => `${x.toFixed(7)} ${y.toFixed(7)}`).join(', ')})`

/** Save a trail drawn on the map, or rename one (coords left out). */
export function useSaveTrail() {
  const qc = useQueryClient()
  return useMutation({
    networkMode: 'always',
    mutationFn: async (v: { id?: string; name: string; coords?: Coord[] }) => {
      if (v.id) {
        const { error } = await supabase
          .from('farm_trails')
          .update({ name: v.name.trim(), ...(v.coords ? { geom: lineEwkt(v.coords) } : {}), updated_at: new Date().toISOString() })
          .eq('id', v.id)
        if (error) throw error
        return
      }
      if (!v.coords || v.coords.length < 2) throw new Error('A trail needs at least two points')
      const {
        data: { user },
      } = await supabase.auth.getUser()
      const { error } = await supabase.from('farm_trails').insert({ name: v.name.trim(), geom: lineEwkt(v.coords), created_by: user?.id ?? null })
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['farm_trails'] }),
  })
}

export function useDeleteTrail() {
  const qc = useQueryClient()
  return useMutation({
    networkMode: 'always',
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('farm_trails').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['farm_trails'] }),
  })
}

/** Field centres — where a field with no entry pin and no boundary is measured to. */
export function fieldPointsQuery() {
  return {
    queryKey: ['field_points'],
    queryFn: async () => {
      const { data, error } = await supabase.from('field_points').select('id, name, lat, lng')
      if (error) throw error
      return new Map((data ?? []).map((p) => [p.id as string, { lat: Number(p.lat), lng: Number(p.lng), name: p.name as string }]))
    },
  }
}

export function useFieldPoints() {
  return useQuery({ ...fieldPointsQuery(), staleTime: 10 * 60_000 })
}

export function roadRoutesQuery() {
  return {
    queryKey: ['road_routes'],
    queryFn: async () => {
      const { data, error } = await supabase.from('road_routes').select('*').limit(5000)
      if (error) throw error
      return (data ?? []) as unknown as RouteRow[]
    },
  }
}

export function useRoadRoutes() {
  return useQuery({ ...roadRoutesQuery(), staleTime: 10 * 60_000 })
}

export type TripFn = (a: string, b: string) => Trip | null

/**
 * The trip between any two places, by key (shopKey, binsKey, fieldKey(id),
 * siteKey(id)), as the costs use it: hand-entered, the router's (road, road +
 * trail, or road + a flagged straight line), or the straight line with a
 * reason (road-routes.ts tripFor).
 */
export function tripsFrom(o: {
  routes: RouteRow[] | undefined
  points: Map<string, LatLng> | undefined
  sites: Site[] | undefined
  entries: Map<string, LatLng> | undefined
  shop: LatLng | null
  bins: LatLng | null
  pit?: LatLng | null
}): TripFn {
  const where = (key: string): LatLng | null => {
    if (key === shopKey) return o.shop
    if (key === binsKey) return o.bins
    if (key === pitKey) return o.pit ?? null
    if (key.startsWith('field:')) return o.entries?.get(key.slice(6)) ?? o.points?.get(key.slice(6)) ?? null
    if (key.startsWith('site:')) {
      const s = o.sites?.find((x) => x.id === key.slice(5))
      return s?.lat != null && s?.lng != null ? { lat: s.lat, lng: s.lng } : null
    }
    return null
  }
  return (a, b) => tripFor(routeBetween(o.routes ?? [], a, b), where(a), where(b))
}

export function useTrips() {
  const { data: routes, isLoading: l1 } = useRoadRoutes()
  const { data: points, isLoading: l2 } = useFieldPoints()
  const { data: sites, isLoading: l3 } = useSites()
  const { data: entries } = useFieldEntries()
  const { shop, bins, pit } = usePlaces()
  const trip = useMemo(() => tripsFrom({ routes, points, sites, entries, shop, bins, pit }), [routes, points, sites, entries, shop, bins, pit])
  return { trip, routes, isLoading: l1 || l2 || l3 }
}

/**
 * The route a field is measured along from a start, as the router left it:
 * the entry it went to (pin or suggestion), where the road stopped, and the
 * off-road part — for drawing on the map.
 */
export function fieldRoute(routes: RouteRow[] | undefined, start: StartKey | PitChoice, fieldId: string): RouteRow | null {
  return (routes ?? []).find((r) => r.from_key === start && r.to_key === fieldKey(fieldId)) ?? null
}

/** Set (or clear, with km null) a distance by hand where the router is wrong. */
export function useSetManualRoute() {
  const qc = useQueryClient()
  return useMutation({
    networkMode: 'always',
    mutationFn: async (v: { from: string; to: string; fromPt: { lat: number; lng: number }; toPt: { lat: number; lng: number }; km: number | null; minutes: number | null }) => {
      if (v.km == null) {
        // Back to the router: drop the hand entry; the next run computes it.
        const { error } = await supabase.from('road_routes').delete().eq('from_key', v.from).eq('to_key', v.to).eq('source', 'manual')
        if (error) throw error
        return
      }
      const { error } = await supabase.from('road_routes').upsert(
        {
          from_key: v.from,
          to_key: v.to,
          from_lat: v.fromPt.lat,
          from_lng: v.fromPt.lng,
          to_lat: v.toPt.lat,
          to_lng: v.toPt.lng,
          distance_km: v.km,
          // A farm trail at about 30 km/h when nobody said.
          duration_min: v.minutes ?? Math.round((v.km / 30) * 600) / 10,
          source: 'manual',
          computed_at: new Date().toISOString(),
          method: 'typed',
          road_km: null,
          trail_km: null,
          connector_km: null,
          trail_path: null,
          note: null,
        },
        { onConflict: 'from_key,to_key' },
      )
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['road_routes'] }),
  })
}

/** Ask the router again now (the daily run does this by itself). */
/** Which way a field's route goes: the router's choice, or the farm's trails wherever they reach it. */
export function useSetRouteVia() {
  const qc = useQueryClient()
  return useMutation({
    networkMode: 'always',
    mutationFn: async (v: { fieldId: string; via: 'auto' | 'trails' }) => {
      const { error } = await supabase.from('fields').update({ route_via: v.via }).eq('id', v.fieldId)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['fields'] }),
  })
}

/** The points a field's route must pass through, in order from the yard out; empty clears them. */
export function useSetRouteThrough() {
  const qc = useQueryClient()
  return useMutation({
    networkMode: 'always',
    mutationFn: async (v: { fieldId: string; points: LatLng[] }) => {
      const pts = v.points.map((p) => ({ lat: Math.round(p.lat * 1e6) / 1e6, lng: Math.round(p.lng * 1e6) / 1e6 }))
      const { error } = await supabase.from('fields').update({ route_through: pts.length ? pts : null }).eq('id', v.fieldId)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['fields'] }),
  })
}

export function useRecomputeRoutes() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (force: boolean) => {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const res = await fetch(`/api/road-routes${force ? '?force=1' : ''}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token ?? ''}` },
      })
      const body = (await res.json().catch(() => ({}))) as { detail?: string; error?: string }
      if (!res.ok) throw new Error(body.error ?? body.detail ?? `Failed: ${res.status}`)
      return body.detail ?? 'done'
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['road_routes'] }),
  })
}

/**
 * The road part of a route as a line, for the map: asked of the router from
 * the browser when a field is picked (the cache keeps only distances). The
 * public router allows it from any page.
 */
export function useRoadLine(from: LatLng | null, to: LatLng | null, via: LatLng[] = []) {
  const c = (p: LatLng) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`
  return useQuery({
    queryKey: ['osrm_route_line', from && c(from), to && c(to), via.map(c).join(';')],
    enabled: !!from && !!to,
    queryFn: async () => {
      // Through the field's via points, as the routes were worked out.
      const res = await fetch(`${OSRM_BASE}/route/v1/driving/${[from!, ...via, to!].map(c).join(';')}?overview=full&geometries=geojson`)
      if (!res.ok) throw new Error(`Road router: ${res.status}`)
      const body = (await res.json()) as { code?: string; routes?: { geometry?: { coordinates?: Coord[] } }[] }
      return body.routes?.[0]?.geometry?.coordinates ?? []
    },
    staleTime: Infinity,
    retry: 1,
  })
}

export { binsKey, fieldKey, shopKey, siteKey }

/* ------------------------------------------------------------- operations */

export type FuelOpRow = {
  id: string
  jd_id: string
  field_id: string | null
  operation_type: string | null
  crop_season: number | null
  started_at: string | null
  ended_at: string | null
  products: unknown
  as_applied: unknown
  applied_area_ha: number | string | null
  sessions: unknown
  cost_acres_override: number | string | null
  not_ours: string | null
  fuel_l: number | string | null
  fuel_read_at: string | null
}

const FUEL_COLS =
  'id, jd_id, field_id, operation_type, crop_season, started_at, ended_at, products, as_applied, applied_area_ha, sessions, cost_acres_override, not_ours, fuel_l, fuel_read_at'

/** Every pass in a season, with only the columns fuel needs. Paged: PostgREST stops at 1000. */
export function seasonFuelOpsQuery(season: number) {
  return {
    queryKey: ['jd_field_operations', 'fuel', season],
    queryFn: async () => {
      const out: FuelOpRow[] = []
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase
          .from('jd_field_operations')
          .select(FUEL_COLS)
          .eq('crop_season', season)
          .order('started_at', { ascending: true })
          .order('id')
          .range(from, from + 999)
        if (error) throw error
        out.push(...((data ?? []) as unknown as FuelOpRow[]))
        if ((data ?? []).length < 1000) break
      }
      return out
    },
  }
}

export function useSeasonFuelOps(season: number) {
  return useQuery(seasonFuelOpsQuery(season))
}

/** Every season's passes, for the farm's own litres an acre (more passes, steadier figure). */
export function allFuelOpsQuery() {
  return {
    queryKey: ['jd_field_operations', 'fuel', 'all'],
    queryFn: async () => {
      const out: FuelOpRow[] = []
      for (let from = 0; ; from += 1000) {
        // Ordered, so a second page does not repeat or skip rows of the first.
        const { data, error } = await supabase
          .from('jd_field_operations')
          .select(FUEL_COLS)
          .not('fuel_l', 'is', null)
          .order('id')
          .range(from, from + 999)
        if (error) throw error
        out.push(...((data ?? []) as unknown as FuelOpRow[]))
        if ((data ?? []).length < 1000) break
      }
      return out
    },
  }
}

export function useAllFuelOps() {
  return useQuery({ ...allFuelOpsQuery(), staleTime: 10 * 60_000 })
}

/* ------------------------------------------------------------- haul plans */

export type HaulPlan = { id: string; field_id: string; crop_year: number; mode: HaulMode; delivery_site_id: string | null; notes: string | null }

export function haulPlansQuery(year: number) {
  return {
    queryKey: ['field_haul_plans', year],
    queryFn: async () => {
      const { data, error } = await supabase.from('field_haul_plans').select('id, field_id, crop_year, mode, delivery_site_id, notes').eq('crop_year', year)
      if (error) throw error
      return new Map(((data ?? []) as HaulPlan[]).map((p) => [p.field_id, p]))
    },
  }
}

export function useHaulPlans(year: number) {
  return useQuery(haulPlansQuery(year))
}

export function useSaveHaulPlan() {
  const qc = useQueryClient()
  return useMutation({
    networkMode: 'always',
    mutationFn: async (v: { field_id: string; crop_year: number; mode: HaulMode | null; delivery_site_id: string | null }) => {
      if (!v.mode) {
        const { error } = await supabase.from('field_haul_plans').delete().eq('field_id', v.field_id).eq('crop_year', v.crop_year)
        if (error) throw error
        return
      }
      const {
        data: { user },
      } = await supabase.auth.getUser()
      const { error } = await supabase.from('field_haul_plans').upsert(
        {
          field_id: v.field_id,
          crop_year: v.crop_year,
          mode: v.mode,
          delivery_site_id: v.delivery_site_id,
          updated_by: user?.id ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'field_id,crop_year' },
      )
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['field_haul_plans'] }),
  })
}

/** The crop on each field that year, with the yield to truck: the scale's, or the plan's estimate. */
export type FieldCrop = {
  fieldId: string
  cropId: string | null
  cropName: string | null
  unit: string | null
  lbPerBu: number | null
  acres: number
  /** The whole field's crop, in `unit`. */
  quantity: number | null
  quantitySource: 'scale' | 'plan' | null
  ownUse: boolean
}

export function fieldCropsQuery(year: number) {
  return {
    queryKey: ['hauling-field-crops', year],
    queryFn: async () => {
      type C = { name: string; yield_unit: string | null; default_yield_per_acre: unknown; test_weight_lb_per_bu: unknown; own_use: boolean | null }
      const [h, p] = await Promise.all([
        supabase
          .from('crop_history')
          .select('field_id, crop_id, acres, actual_yield_total, yield_unit, crops(name, yield_unit, default_yield_per_acre, test_weight_lb_per_bu, own_use)')
          .eq('crop_year', year),
        supabase
          .from('crop_plans')
          .select('field_id, crop_id, planned_acres, yield_per_acre_override, crops(name, yield_unit, default_yield_per_acre, test_weight_lb_per_bu, own_use)')
          .eq('crop_year', year),
      ])
      if (h.error) throw h.error
      if (p.error) throw p.error
      const out = new Map<string, FieldCrop>()
      // The largest crop on a field, as the profit/loss map takes it.
      for (const r of (h.data ?? []) as unknown as { field_id: string; crop_id: string | null; acres: unknown; actual_yield_total: unknown; yield_unit: string | null; crops: C | null }[]) {
        const acres = num(r.acres) ?? 0
        const cur = out.get(r.field_id)
        if (cur && cur.acres >= acres) continue
        const q = num(r.actual_yield_total)
        out.set(r.field_id, {
          fieldId: r.field_id,
          cropId: r.crop_id,
          cropName: r.crops?.name ?? null,
          unit: r.yield_unit ?? r.crops?.yield_unit ?? null,
          lbPerBu: num(r.crops?.test_weight_lb_per_bu),
          acres,
          quantity: q,
          quantitySource: q != null ? 'scale' : null,
          ownUse: Boolean(r.crops?.own_use),
        })
      }
      for (const r of (p.data ?? []) as unknown as { field_id: string; crop_id: string | null; planned_acres: unknown; yield_per_acre_override: unknown; crops: C | null }[]) {
        const acres = num(r.planned_acres) ?? 0
        const cur = out.get(r.field_id)
        if (cur && (cur.quantitySource === 'scale' || cur.acres >= acres)) continue
        const perAc = num(r.yield_per_acre_override) ?? num(r.crops?.default_yield_per_acre)
        out.set(r.field_id, {
          fieldId: r.field_id,
          cropId: r.crop_id,
          cropName: r.crops?.name ?? null,
          unit: r.crops?.yield_unit ?? null,
          lbPerBu: num(r.crops?.test_weight_lb_per_bu),
          acres,
          quantity: perAc != null ? perAc * acres : null,
          quantitySource: perAc != null ? 'plan' : null,
          ownUse: Boolean(r.crops?.own_use),
        })
      }
      return out
    },
  }
}

export function useFieldCrops(year: number) {
  return useQuery(fieldCropsQuery(year))
}

/* ------------------------------------------------------------- manure invoices */

export type ManureInvoice = {
  id: string
  manure_application_id: string | null
  field_id: string | null
  hauler: string
  invoice_no: string | null
  invoice_date: string | null
  work_date: string | null
  description: string | null
  hours: number | null
  rate_per_hour: number | null
  amount: number
  gst: number | null
  loads: number | null
  tonnes: number | null
  notes: string | null
}

export function useManureInvoices() {
  return useQuery({
    queryKey: ['manure_haul_invoices'],
    queryFn: async () => {
      const { data, error } = await supabase.from('manure_haul_invoices').select('*').order('work_date', { ascending: false })
      if (error) throw error
      return (data ?? []).map((r) => ({
        ...r,
        hours: num(r.hours),
        rate_per_hour: num(r.rate_per_hour),
        amount: Number(r.amount),
        gst: num(r.gst),
        tonnes: num(r.tonnes),
      })) as ManureInvoice[]
    },
  })
}

/** The tonnes an acre each invoiced spread went on at, by manure application id. */
export function useManureRates(ids: string[]) {
  return useQuery({
    queryKey: ['manure_applications', 'rates', [...ids].sort().join(',')],
    enabled: ids.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from('manure_applications').select('id, rate_tons_per_acre').in('id', ids)
      if (error) throw error
      return new Map((data ?? []).map((r) => [r.id as string, num(r.rate_tons_per_acre)]))
    },
  })
}

export function useSaveManureInvoice() {
  const qc = useQueryClient()
  return useMutation({
    networkMode: 'always',
    mutationFn: async (v: Omit<ManureInvoice, 'id'> & { id?: string }) => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      const row = { ...v, created_by: user?.id ?? null }
      const { error } = v.id
        ? await supabase.from('manure_haul_invoices').update(row).eq('id', v.id)
        : await supabase.from('manure_haul_invoices').insert(row)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['manure_haul_invoices'] }),
  })
}

export function useDeleteManureInvoice() {
  const qc = useQueryClient()
  return useMutation({
    networkMode: 'always',
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('manure_haul_invoices').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['manure_haul_invoices'] }),
  })
}
