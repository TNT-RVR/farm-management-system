import { useQuery } from '@tanstack/react-query'
import type { Geometry, MultiPolygon } from 'geojson'
import { supabase } from './supabase'

/**
 * Alberta's soil survey and water features, as this farm sees them.
 *
 * Both are imported by scripts/import-alberta-layers.mjs and sit in our own
 * database. Nothing here calls the province at run time: the map has to work
 * from a truck at seeding, and neither dataset changes in a season.
 */

export type SoilHorizon = {
  horizon: string | null
  top: number | null
  bottom: number | null
  texture: string | null
  clay: number | null
  organicCarbon: number | null
  ph: number | null
  ec: number | null
  cec: number | null
  caco3: number | null
  fc: number | null
  wp: number | null
}

export type SoilPolygon = {
  id: string
  poly_id: number
  munit: string | null
  soil_name: string | null
  subgroup: string | null
  drainage: string | null
  salinity: string | null
  texture_top: string | null
  fc_pct: number | null
  wp_pct: number | null
  acres: number | null
  detail: { horizons?: SoilHorizon[]; components?: unknown[] }
  geometry: MultiPolygon
}

/** AGRASID's one-letter codes, spelled out. */
export const DRAINAGE: Record<string, string> = {
  R: 'rapidly drained',
  W: 'well drained',
  M: 'moderately well drained',
  I: 'imperfectly drained',
  P: 'poorly drained',
  V: 'very poorly drained',
}

export const SALINITY: Record<string, string> = {
  N: 'non-saline',
  W: 'weakly saline',
  M: 'moderately saline',
  S: 'strongly saline',
  V: 'very strongly saline',
}

/** The soil texture abbreviations that turn up on this farm. */
export const TEXTURE: Record<string, string> = {
  S: 'sand',
  LS: 'loamy sand',
  SL: 'sandy loam',
  L: 'loam',
  SIL: 'silt loam',
  SICL: 'silty clay loam',
  CL: 'clay loam',
  SCL: 'sandy clay loam',
  SC: 'sandy clay',
  SIC: 'silty clay',
  C: 'clay',
  VC: 'very coarse',
}

const num = (v: unknown): number | null => {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export function useSoilPolygons() {
  return useQuery({
    queryKey: ['soil_landscape'],
    staleTime: 60 * 60 * 1000,
    queryFn: async (): Promise<SoilPolygon[]> => {
      const { data, error } = await supabase.from('soil_landscape_geojson').select('*')
      if (error) throw error
      return (data ?? []).map((r) => {
        const row = r as unknown as Record<string, unknown>
        return {
          id: String(row.id),
          poly_id: Number(row.poly_id),
          munit: (row.munit as string) ?? null,
          soil_name: (row.soil_name as string) ?? null,
          subgroup: (row.subgroup as string) ?? null,
          drainage: (row.drainage as string) ?? null,
          salinity: (row.salinity as string) ?? null,
          texture_top: (row.texture_top as string) ?? null,
          fc_pct: num(row.fc_pct),
          wp_pct: num(row.wp_pct),
          acres: num(row.acres),
          detail: (row.detail ?? {}) as SoilPolygon['detail'],
          geometry: row.geometry as MultiPolygon,
        }
      })
    },
  })
}

export type WaterFeature = {
  id: string
  kind: string
  layer: string
  name: string | null
  geometry: Geometry
}

/** The water itself, for measuring distance to. */
export function useWaterFeatures() {
  return useQuery({
    queryKey: ['water_features'],
    staleTime: 60 * 60 * 1000,
    queryFn: async (): Promise<WaterFeature[]> => {
      const { data, error } = await supabase.from('water_features_geojson').select('*')
      if (error) throw error
      return (data ?? []).map((r) => {
        const row = r as unknown as Record<string, unknown>
        return {
          id: String(row.id),
          kind: String(row.kind),
          layer: String(row.layer),
          name: (row.name as string) ?? null,
          geometry: row.geometry as Geometry,
        }
      })
    },
  })
}

/** The 30 m rings, for drawing. */
export function useWaterSetbacks() {
  return useQuery({
    queryKey: ['water_setbacks'],
    staleTime: 60 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.from('water_setbacks_geojson').select('*')
      if (error) throw error
      return (data ?? []).map((r) => {
        const row = r as unknown as Record<string, unknown>
        return {
          id: String(row.id),
          kind: String(row.kind),
          name: (row.name as string) ?? null,
          geometry: row.geometry as MultiPolygon,
        }
      })
    },
  })
}

/** "Loamy sand, rapidly drained, non-saline" — the survey in a sentence. */
export function describeSoil(s: SoilPolygon): string {
  return [
    s.texture_top ? (TEXTURE[s.texture_top] ?? s.texture_top) : null,
    s.drainage ? DRAINAGE[s.drainage] : null,
    s.salinity ? SALINITY[s.salinity] : null,
  ]
    .filter(Boolean)
    .join(', ')
}

/**
 * Plant-available water in the top metre, inches.
 *
 * Field capacity minus wilting point is the water a crop can actually reach,
 * and it is the number that separates these fields: the loamy sand on Coulee
 * holds around a third of what the loam on Aspen Flat does, so the same
 * irrigation set means something different on each.
 */
export function availableWaterInches(s: SoilPolygon): number | null {
  if (s.fc_pct == null || s.wp_pct == null) return null
  const pct = s.fc_pct - s.wp_pct
  if (pct <= 0) return null
  // Volumetric percent over a 100 cm profile, converted to inches.
  return Math.round(((pct / 100) * 100) / 2.54 * 10) / 10
}

/**
 * The colour bands the soil layer is drawn on, shared by every view that draws
 * it and by the legend that explains it.
 *
 * Banded on plant-available water — field capacity minus wilting point over the
 * top metre — rather than on texture, because that is the number a person acts
 * on. Two soils can both be "loam" and hold an inch apart, and the map exists
 * to show which corner of the field runs out first.
 */
export const SOIL_WATER_BANDS: { max: number; colour: string; label: string }[] = [
  { max: 1.5, colour: '#fde68a', label: 'under 1.5"' },
  { max: 2.5, colour: '#a3e635', label: '1.5–2.5"' },
  { max: 3.5, colour: '#22c55e', label: '2.5–3.5"' },
  { max: Infinity, colour: '#15803d', label: 'over 3.5"' },
]

/** Grey where the survey has no figure — open water, disturbed land. */
export const SOIL_NO_DATA_COLOUR = '#9ca3af'

export function soilBandColour(inches: number | null): string {
  if (inches == null) return SOIL_NO_DATA_COLOUR
  return (SOIL_WATER_BANDS.find((b) => inches < b.max) ?? SOIL_WATER_BANDS[0]).colour
}

/**
 * Where these numbers come from.
 *
 * Both links checked rather than guessed — the open.alberta.ca address that was
 * here first returned "Dataset not found", which is a worse citation than none:
 * it invites somebody to check the source and then tells them it does not
 * exist.
 */
export const AGRASID_SOURCE = {
  name: 'AGRASID 4.1 — Agricultural Regions of Alberta Soil Inventory Database',
  url: 'https://www.alberta.ca/agricultural-regions-of-alberta-soil-inventory-database',
}

/** Alberta's own map for looking any spot up, which is the more useful of the two. */
export const SOIL_VIEWER = {
  name: 'Alberta Soil Information Viewer',
  url: 'https://www.alberta.ca/alberta-soil-information-viewer',
}

export type FieldSoilUnit = {
  poly_id: number
  munit: string | null
  soil_name: string | null
  subgroup: string | null
  drainage: string | null
  salinity: string | null
  texture_top: string | null
  fc_pct: number | null
  wp_pct: number | null
  overlap_acres: number | null
  pct_of_field: number | null
  detail: { horizons?: SoilHorizon[] }
}

/** Which soils one field spans, biggest share first. */
export function useFieldSoilUnits(fieldId: string | null | undefined) {
  return useQuery({
    queryKey: ['field_soil_units', fieldId],
    enabled: Boolean(fieldId),
    staleTime: 60 * 60 * 1000,
    queryFn: async (): Promise<FieldSoilUnit[]> => {
      const { data, error } = await supabase
        .from('field_soil_units')
        .select('*')
        .eq('field_id', fieldId!)
      if (error) throw error
      return (data ?? []).map((r) => {
        const row = r as unknown as Record<string, unknown>
        return {
          poly_id: Number(row.poly_id),
          munit: (row.munit as string) ?? null,
          soil_name: (row.soil_name as string) ?? null,
          subgroup: (row.subgroup as string) ?? null,
          drainage: (row.drainage as string) ?? null,
          salinity: (row.salinity as string) ?? null,
          texture_top: (row.texture_top as string) ?? null,
          fc_pct: num(row.fc_pct),
          wp_pct: num(row.wp_pct),
          overlap_acres: num(row.overlap_acres),
          pct_of_field: num(row.pct_of_field),
          detail: (row.detail ?? {}) as FieldSoilUnit['detail'],
        }
      })
    },
  })
}

/** Available water for a unit, same arithmetic as the polygon version. */
export function unitAvailableWater(u: FieldSoilUnit): number | null {
  if (u.fc_pct == null || u.wp_pct == null) return null
  const pct = u.fc_pct - u.wp_pct
  if (pct <= 0) return null
  return Math.round(((pct / 100) * 100) / 2.54 * 10) / 10
}
