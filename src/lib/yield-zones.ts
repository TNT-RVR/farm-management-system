/**
 * Productivity zones: which parts of a field grow more than the rest of it.
 *
 * Drawn by the agronomist off years of yield maps, one zone map per field. They
 * are the standing fact the variable-rate prescriptions get built FROM — which
 * is why they live apart from fertility_rx_map, where a polygon says what to
 * apply this season rather than what the ground is.
 *
 * THE NUMBERS ARE AN INDEX, NOT BUSHELS. This was not obvious from the
 * shapefiles, whose columns are called minYield and maxYield, and it only
 * showed up on the acre-weighted averages: all twenty-two fields came out
 * between 97 and 105, and twenty of them between 98 and 101. Real bushels
 * across canola, wheat and corn could not do that. They are normalised so that
 * 100 is THAT FIELD'S OWN AVERAGE, and the few points of scatter are the error
 * from averaging zone midpoints rather than the underlying map.
 *
 * Three consequences, all of which the screens have to respect:
 *
 *   A field's average is 100 by construction, so reporting one says nothing.
 *   What is worth reporting is the SPREAD — a field running 84 to 116 is worth
 *   varying rates across and one running 97 to 103 is not.
 *
 *   Fields cannot be ranked against each other at all. Not "roughly": at all.
 *   Every field is 100 on average whether it grows forty bushels or a hundred
 *   and forty.
 *
 *   But a zone CAN be compared across fields, because the index means the same
 *   thing everywhere — 110 is ten per cent better than its own field's average,
 *   wherever it is. So one colour ramp across the whole farm is right, and it
 *   is reading relative productivity rather than yield.
 */
import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'

export type YieldZone = {
  id: string
  field_id: string
  field_name: string
  zone: number
  min_yield: number | null
  max_yield: number | null
  yield_unit: string | null
  acres: number | null
  legal_desc: string | null
  source_name: string | null
  geometry: GeoJSON.MultiPolygon
}

/** The middle of a zone's index range — what it gets coloured by. */
export function midYield(z: Pick<YieldZone, 'min_yield' | 'max_yield'>): number | null {
  const { min_yield: lo, max_yield: hi } = z
  if (lo != null && hi != null) return (lo + hi) / 2
  return lo ?? hi ?? null
}

/** Below its field's average brown, above it green — how a yield map is read. */
export const YIELD_COLOURS = ['#8c5a26', '#c9a227', '#e8d98a', '#9fd18a', '#2f8f3e']

export function yieldZonesQuery() {
  return {
    queryKey: ['field_yield_zones'],
    queryFn: async (): Promise<YieldZone[]> => {
      const { data, error } = await supabase
        .from('field_yield_zones_geojson')
        .select('*')
        .order('field_name')
        .order('zone')
      if (error) throw error
      return (data ?? []).map((r) => {
        const row = r as unknown as Record<string, unknown>
        const num = (v: unknown) => (v == null ? null : Number(v))
        return {
          id: String(row.id),
          field_id: String(row.field_id),
          field_name: String(row.field_name),
          zone: Number(row.zone),
          min_yield: num(row.min_yield),
          max_yield: num(row.max_yield),
          yield_unit: (row.yield_unit as string) ?? null,
          acres: num(row.acres),
          legal_desc: (row.legal_desc as string) ?? null,
          source_name: (row.source_name as string) ?? null,
          geometry: row.geometry as GeoJSON.MultiPolygon,
        }
      })
    },
  }
}

export function useYieldZones() {
  return useQuery(yieldZonesQuery())
}

/**
 * Five bands across the farm's zones, as a legend and a colour lookup.
 *
 * Farm-wide rather than per field, and that is right BECAUSE the numbers are an
 * index: 110 means the same thing on every field, so one ramp reads the same
 * everywhere. A per-field ramp would repaint each field's own worst ground the
 * darkest brown and make a uniform field look as troubled as a variable one.
 *
 * Cut at the 5th and 95th percentiles rather than the extremes. One zone reaches
 * 161 where almost everything tops out near 125, and stretching the ramp to
 * reach it puts four fifths of the farm in one colour — which is exactly the
 * failure that makes somebody stop trusting a map.
 */
export type YieldBand = { from: number; to: number; colour: string }

export function yieldBands(zones: Pick<YieldZone, 'min_yield' | 'max_yield'>[]): YieldBand[] {
  const mids = zones
    .map(midYield)
    .filter((v): v is number => v != null && Number.isFinite(v))
    .sort((a, b) => a - b)
  if (!mids.length) return []

  const at = (p: number) => mids[Math.min(mids.length - 1, Math.max(0, Math.floor(mids.length * p)))]
  let lo = at(0.05)
  let hi = at(0.95)
  // Everything the same, or near enough: one band rather than five identical
  // ones, which would read as precision that is not there.
  if (!(hi > lo)) {
    lo = mids[0]
    hi = mids[mids.length - 1]
  }
  if (!(hi > lo)) return [{ from: lo, to: hi, colour: YIELD_COLOURS[YIELD_COLOURS.length - 1] }]

  const step = (hi - lo) / YIELD_COLOURS.length
  return YIELD_COLOURS.map((colour, i) => ({
    from: Math.round(lo + step * i),
    to: Math.round(lo + step * (i + 1)),
    colour,
  }))
}

/** Which band a zone falls in. Below the first and above the last clamp to the ends. */
export function yieldColour(bands: YieldBand[], value: number | null): string {
  if (!bands.length) return '#9ca3af'
  if (value == null || !Number.isFinite(value)) return '#9ca3af'
  for (const b of bands) if (value < b.to) return b.colour
  return bands[bands.length - 1].colour
}

/** "74–100" — index points, so no unit unless the source genuinely carried one. */
export function rangeLabel(z: Pick<YieldZone, 'min_yield' | 'max_yield' | 'yield_unit'>): string {
  const lo = z.min_yield
  const hi = z.max_yield
  const n = (v: number) => v.toLocaleString('en-CA', { maximumFractionDigits: 0 })
  const span = lo != null && hi != null ? `${n(lo)}–${n(hi)}` : lo != null ? `${n(lo)}+` : hi != null ? `up to ${n(hi)}` : '—'
  return z.yield_unit ? `${span} ${z.yield_unit}` : span
}

/** Zones grouped by field, best ground first — how a field is read on a list. */
export function byField(zones: YieldZone[]): { fieldId: string; name: string; zones: YieldZone[] }[] {
  const map = new Map<string, { fieldId: string; name: string; zones: YieldZone[] }>()
  for (const z of zones) {
    const entry = map.get(z.field_id) ?? { fieldId: z.field_id, name: z.field_name, zones: [] }
    entry.zones.push(z)
    map.set(z.field_id, entry)
  }
  for (const e of map.values()) {
    e.zones.sort((a, b) => (midYield(b) ?? 0) - (midYield(a) ?? 0))
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * How variable a field is, in index points.
 *
 * This replaces what was an acre-weighted average, which was worse than
 * useless: the index is normalised so every field averages 100, so the column
 * showed 99, 100, 99, 100 down the whole farm and invited the reading that
 * every field is equally good.
 *
 * The spread is the number a variable-rate decision actually turns on. Coulee
 * runs 84 to 116 and is worth varying across; a field running 97 to 103 is one
 * rate.
 */
export type FieldSpread = { lo: number; hi: number; spread: number }

export function fieldSpread(zones: YieldZone[]): FieldSpread | null {
  const los = zones.map((z) => z.min_yield).filter((v): v is number => v != null)
  const his = zones.map((z) => z.max_yield).filter((v): v is number => v != null)
  if (!los.length || !his.length) return null
  const lo = Math.min(...los)
  const hi = Math.max(...his)
  return { lo, hi, spread: hi - lo }
}

/**
 * Below this a field is one rate.
 *
 * Forty index points is the range over which splitting a field starts to pay
 * for the extra passes and the extra thinking. Under it the zones are real but
 * not worth acting on separately, and saying so is more useful than drawing
 * five colours on ground that behaves as one.
 */
export const WORTH_VARYING = 40
