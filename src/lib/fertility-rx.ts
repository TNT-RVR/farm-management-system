import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
import { nutrientsApplied } from './fertilizer-analysis'
import type { FieldOperation, OpProduct } from './fieldOps'

/**
 * Fertiliser prescriptions and what actually went on.
 *
 * The prescription side comes off the retailer's RX Rates report, imported by
 * scripts/import-rx.mjs. The applied side comes off the machines, through
 * Deere. Neither was written with the other in mind, and the whole value here
 * is putting them next to each other.
 */

export type RxZoneRow = {
  id: string
  zone: number
  fertility_index: string | null
  acres: number | null
  yield_goal: number | null
  n: number | null
  p2o5: number | null
  k2o: number | null
  s: number | null
  extra: Record<string, number>
  products: Record<string, number>
}

export type RxProductRow = {
  label: string
  analysis: string
  avgRate: number | null
  totalLbs: number | null
}

export type Prescription = {
  id: string
  crop_year: number
  field_id: string | null
  field_label: string
  legal: string | null
  crop_type: string | null
  variety: string | null
  acres: number | null
  yield_goal: number | null
  yield_unit: string | null
  description: string | null
  total_acres: number | null
  products: RxProductRow[]
  source_file: string | null
  source_page: number | null
  zones: RxZoneRow[]
}

/** Postgres numerics arrive as strings through PostgREST. */
const num = (v: unknown): number | null => {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export function usePrescriptions(cropYear: number) {
  return useQuery({
    queryKey: ['fertility_rx', cropYear],
    queryFn: async (): Promise<Prescription[]> => {
      const { data, error } = await supabase
        .from('fertility_rx')
        .select('*, fertility_rx_zones(*)')
        .eq('crop_year', cropYear)
        .order('field_label')
      if (error) throw error
      return (data ?? []).map((r) => {
        const row = r as unknown as Record<string, unknown>
        const zones = ((row.fertility_rx_zones ?? []) as Record<string, unknown>[])
          .map((z) => ({
            id: String(z.id),
            zone: Number(z.zone),
            fertility_index: (z.fertility_index as string) ?? null,
            acres: num(z.acres),
            yield_goal: num(z.yield_goal),
            n: num(z.n),
            p2o5: num(z.p2o5),
            k2o: num(z.k2o),
            s: num(z.s),
            extra: (z.extra ?? {}) as Record<string, number>,
            products: (z.products ?? {}) as Record<string, number>,
          }))
          .sort((a, b) => a.zone - b.zone)
        return {
          id: String(row.id),
          crop_year: Number(row.crop_year),
          field_id: (row.field_id as string) ?? null,
          field_label: String(row.field_label),
          legal: (row.legal as string) ?? null,
          crop_type: (row.crop_type as string) ?? null,
          variety: (row.variety as string) ?? null,
          acres: num(row.acres),
          yield_goal: num(row.yield_goal),
          yield_unit: (row.yield_unit as string) ?? null,
          description: (row.description as string) ?? null,
          total_acres: num(row.total_acres),
          products: (row.products ?? []) as RxProductRow[],
          source_file: (row.source_file as string) ?? null,
          source_page: num(row.source_page),
          zones,
        }
      })
    },
  })
}

/**
 * Every year with something to show, newest first.
 *
 * Both sources, because they arrive separately: 2024 has an applicator file and
 * no report, and a year list built from the reports alone would hide it
 * completely — the data would be imported, correct, and unreachable.
 */
export function useRxYears() {
  return useQuery({
    queryKey: ['fertility_rx', 'years'],
    queryFn: async () => {
      const [reports, maps] = await Promise.all([
        supabase.from('fertility_rx').select('crop_year'),
        supabase.from('fertility_rx_map_geojson').select('crop_year'),
      ])
      if (reports.error) throw reports.error
      if (maps.error) throw maps.error
      const years = [...reports.data ?? [], ...maps.data ?? []].map((r) =>
        Number((r as { crop_year: number }).crop_year),
      )
      return [...new Set(years)].sort((a, b) => b - a)
    },
  })
}

/** Applicator prescriptions for a year, grouped by field. */
export function useRxMapsForYear(cropYear: number) {
  return useQuery({
    queryKey: ['fertility_rx_map', 'year', cropYear],
    queryFn: async (): Promise<Map<string, RxMapPolygon[]>> => {
      const { data, error } = await supabase
        .from('fertility_rx_map_geojson')
        .select('*')
        .eq('crop_year', cropYear)
        .order('target_rate')
      if (error) throw error
      const byField = new Map<string, RxMapPolygon[]>()
      for (const r of data ?? []) {
        const row = r as unknown as Record<string, unknown>
        const fieldId = String(row.field_id)
        const list = byField.get(fieldId) ?? []
        list.push({
          id: String(row.id),
          crop_year: Number(row.crop_year),
          product: (row.product as string) ?? null,
          target_rate: num(row.target_rate),
          acres: num(row.acres),
          source_file: (row.source_file as string) ?? null,
          geometry: row.geometry as GeoJSON.MultiPolygon,
        })
        byField.set(fieldId, list)
      }
      return byField
    },
  })
}

/** One polygon of an applicator prescription, with the rate it was given. */
export type RxMapPolygon = {
  id: string
  crop_year: number
  product: string | null
  target_rate: number | null
  acres: number | null
  source_file: string | null
  geometry: GeoJSON.MultiPolygon
}

/**
 * The prescription as ground.
 *
 * Present only for fields whose applicator file has been imported — the PDF
 * carries the zones' acres but never their shape, so most fields have the
 * table and no map, and the screen has to be honest about which.
 */
export function useRxMap(fieldId: string | null, cropYear: number) {
  return useQuery({
    queryKey: ['fertility_rx_map', fieldId, cropYear],
    enabled: Boolean(fieldId),
    queryFn: async (): Promise<RxMapPolygon[]> => {
      const { data, error } = await supabase
        .from('fertility_rx_map_geojson')
        .select('*')
        .eq('field_id', fieldId!)
        .eq('crop_year', cropYear)
        .order('target_rate')
      if (error) throw error
      return (data ?? []).map((r) => {
        const row = r as unknown as Record<string, unknown>
        return {
          id: String(row.id),
          crop_year: Number(row.crop_year),
          product: (row.product as string) ?? null,
          target_rate: num(row.target_rate),
          acres: num(row.acres),
          source_file: (row.source_file as string) ?? null,
          geometry: row.geometry as GeoJSON.MultiPolygon,
        }
      })
    },
  })
}

export type Nutrient = 'n' | 'p2o5' | 'k2o' | 's'
export const NUTRIENTS: { key: Nutrient; label: string }[] = [
  { key: 'n', label: 'N' },
  { key: 'p2o5', label: 'P₂O₅' },
  { key: 'k2o', label: 'K₂O' },
  { key: 's', label: 'S' },
]

/**
 * The prescription's rate over the whole field, weighted by zone acres.
 *
 * Weighted, not averaged: on a field where zone 1 is 7 acres and zone 4 is 45,
 * a plain average of the five zone rates describes no part of the field and
 * cannot be compared with what the machine put out.
 */
export function weightedRate(zones: RxZoneRow[], key: Nutrient): number | null {
  let acres = 0
  let total = 0
  for (const z of zones) {
    if (z[key] == null || z.acres == null) continue
    acres += z.acres
    total += z.acres * z[key]!
  }
  return acres > 0 ? total / acres : null
}

/** Whether the prescribed rates differ between zones. */
export function rxKind(zones: RxZoneRow[]): 'variable' | 'blanket' | 'unknown' {
  if (zones.length === 0) return 'unknown'
  if (zones.length === 1) return 'blanket'
  for (const { key } of NUTRIENTS) {
    const vals = zones.map((z) => z[key]).filter((v): v is number => v != null)
    if (vals.length > 1 && new Set(vals).size > 1) return 'variable'
  }
  const names = new Set(zones.flatMap((z) => Object.keys(z.products)))
  for (const name of names) {
    const rates = zones.map((z) => z.products[name]).filter((v) => v != null)
    if (rates.length > 1 && new Set(rates).size > 1) return 'variable'
  }
  return 'blanket'
}

/** Nothing was prescribed: every rate on every zone is zero. */
export function rxIsEmpty(zones: RxZoneRow[]): boolean {
  if (zones.length === 0) return false
  return zones.every(
    (z) =>
      !z.n && !z.p2o5 && !z.k2o && !z.s && Object.values(z.products).every((v) => !v),
  )
}

/** One fertiliser pass a machine actually made. */
export type AppliedPass = {
  key: string
  date: string | null
  product: string
  rate: number | null
  unitId: string | null
  /** Null where the rate is a volume and the analysis cannot be applied to it. */
  nutrients: { n: number; p2o5: number; k2o: number; s: number } | null
}

/**
 * The fertiliser this field actually received, out of the machine records.
 *
 * Reads components as well as top-level products, because a fertiliser applied
 * through the sprayer arrives as a component of a tank mix and only the
 * component carries `productType: FERTILIZER`.
 */
export function appliedFertiliser(ops: FieldOperation[]): AppliedPass[] {
  const passes: AppliedPass[] = []
  for (const op of ops) {
    const products = (op.products ?? []) as unknown as OpProduct[]
    if (!Array.isArray(products)) continue
    products.forEach((p, pi) => {
      const parts = [
        // A product with no components is itself the thing applied.
        ...(p.components?.length
          ? p.components.filter((c) => c.productType === 'FERTILIZER')
          : [{ name: p.name, rate: p.rate, productType: 'FERTILIZER' }]),
      ]
      parts.forEach((c, ci) => {
        const name = c.name ?? ''
        const nutrients = nutrientsApplied(name, c.rate?.value, c.rate?.unitId)
        // Products with nothing to read as an analysis are not fertiliser as
        // far as this screen is concerned — the components list is full of
        // herbicide, and a product without components could be anything.
        if (!nutrients && !/\d+\s*-\s*\d+\s*-\s*\d+/.test(name)) return
        passes.push({
          key: `${op.id}:${pi}:${ci}`,
          date: op.started_at ? op.started_at.slice(0, 10) : null,
          product: name,
          rate: c.rate?.value ?? null,
          unitId: c.rate?.unitId ?? null,
          nutrients: nutrients
            ? { n: nutrients.n, p2o5: nutrients.p2o5, k2o: nutrients.k2o, s: nutrients.s }
            : null,
        })
      })
    })
  }
  return passes.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))
}

/**
 * Whether the machine varied its rate across the field.
 *
 * Deere records one rate per pass, so this can only ever say "the passes
 * disagree", never "the rate changed within a pass". Reported as unknown
 * rather than blanket for that reason: a machine following a prescription file
 * writes a single target rate here and would otherwise be called blanket, which
 * is exactly the mistake this screen exists to catch.
 */
export function appliedKind(passes: AppliedPass[]): 'variable' | 'unknown' {
  const byProduct = new Map<string, Set<number>>()
  for (const p of passes) {
    if (p.rate == null) continue
    const set = byProduct.get(p.product) ?? new Set<number>()
    set.add(p.rate)
    byProduct.set(p.product, set)
  }
  for (const set of byProduct.values()) if (set.size > 1) return 'variable'
  return 'unknown'
}
