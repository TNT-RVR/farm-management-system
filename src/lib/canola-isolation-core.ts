import type { Geometry, MultiPolygon, Polygon, Position } from 'geojson'
import { quartersInView, type GridParcel } from './geo/atsGrid'
import type { TownshipTable } from './geo/ats'

/**
 * Canola isolation (Sam, 8 Oct 2026): a seed canola field, a mile around it
 * from the outer edge of its boundary, and every quarter section inside that
 * mile labelled with what is planted there now and the four years before.
 * Pure: the geometry and the year-by-year crops; the hooks are in
 * canola-isolation.ts.
 */

export const MILE_M = 1609.344
export const HISTORY_YEARS = 4

type Ring = Position[]

/** The outer rings of a Polygon or MultiPolygon (holes don't matter for "does it touch the mile"). */
export function outerRings(g: Geometry | null | undefined): Ring[] {
  if (!g) return []
  if (g.type === 'Polygon') return (g as Polygon).coordinates.slice(0, 1)
  if (g.type === 'MultiPolygon') return (g as MultiPolygon).coordinates.map((p) => p[0])
  return []
}

/** Every ring with its holes, for "is this point on the field" (a hole is not the field). */
function polygons(g: Geometry | null | undefined): Ring[][] {
  if (!g) return []
  if (g.type === 'Polygon') return [(g as Polygon).coordinates]
  if (g.type === 'MultiPolygon') return (g as MultiPolygon).coordinates
  return []
}

export function pointInRing(p: Position, ring: Ring): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

export function pointInGeometry(p: Position, g: Geometry | null | undefined): boolean {
  return polygons(g).some(([outer, ...holes]) => pointInRing(p, outer) && !holes.some((h) => pointInRing(p, h)))
}

const cross = (a: Position, b: Position, c: Position) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
function segmentsCross(a: Position, b: Position, c: Position, d: Position): boolean {
  const d1 = cross(c, d, a)
  const d2 = cross(c, d, b)
  const d3 = cross(a, b, c)
  const d4 = cross(a, b, d)
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
}

/** Does a quarter's outline overlap an area at all: a corner inside it, it inside the quarter, or edges crossing. */
export function ringTouches(ring: Ring, area: Geometry): boolean {
  if (ring.some((p) => pointInGeometry(p, area))) return true
  const rings = outerRings(area)
  if (rings.some((r) => r.some((p) => pointInRing(p, ring)))) return true
  for (const r of rings) {
    for (let i = 0; i + 1 < ring.length; i++) {
      for (let j = 0; j + 1 < r.length; j++) if (segmentsCross(ring[i], ring[i + 1], r[j], r[j + 1])) return true
    }
  }
  return false
}

export function bboxOf(g: Geometry): { south: number; west: number; north: number; east: number } | null {
  const pts = outerRings(g).flat()
  if (!pts.length) return null
  return {
    west: Math.min(...pts.map((p) => p[0])),
    east: Math.max(...pts.map((p) => p[0])),
    south: Math.min(...pts.map((p) => p[1])),
    north: Math.max(...pts.map((p) => p[1])),
  }
}

const quarterRing = (q: GridParcel): Ring => q.box.ring.map((c) => [c.lng, c.lat])

/** Every quarter section the area reaches into, from the survey grid. */
export function quartersInArea(area: Geometry, table: TownshipTable | null | undefined): GridParcel[] {
  const b = bboxOf(area)
  if (!b) return []
  return quartersInView(b, table, 400)
    .filter((q) => ringTouches(quarterRing(q), area))
    .sort((a, b2) => a.text.localeCompare(b2.text, 'en-CA', { numeric: true }))
}

/**
 * How much of a quarter one of our fields covers, from a 12 × 12 grid of
 * points across it. A quarter is "ours" when a field covers a fifth of it or
 * more: one only brushing its edge leaves it the neighbour's.
 */
export function coverage(q: GridParcel, field: Geometry): number {
  const ring = quarterRing(q)
  const xs = ring.map((p) => p[0])
  const ys = ring.map((p) => p[1])
  const [w, e, s, n] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  let hit = 0
  let all = 0
  for (let i = 0; i < 12; i++) {
    for (let j = 0; j < 12; j++) {
      const p: Position = [w + ((i + 0.5) / 12) * (e - w), s + ((j + 0.5) / 12) * (n - s)]
      if (!pointInRing(p, ring)) continue
      all++
      if (pointInGeometry(p, field)) hit++
    }
  }
  return all ? hit / all : 0
}

export const OURS_SHARE = 0.2

/** Which of our fields a quarter belongs to, if any: the one covering most of it. */
export function ourFieldFor(q: GridParcel, ours: { field_id: string; geometry: Geometry }[]): { fieldId: string; share: number } | null {
  let best: { fieldId: string; share: number } | null = null
  for (const o of ours) {
    const share = coverage(q, o.geometry)
    if (share >= OURS_SHARE && (!best || share > best.share)) best = { fieldId: o.field_id, share }
  }
  return best
}

export type CropCell = { crop: string | null; source: 'label' | 'ours' | 'pasture' | null; notes?: string | null }

/** What a pasture quarter reads as in a year nobody wrote a crop for. */
export const PASTURE = 'Pasture'

/**
 * What was on a quarter in a year: what someone wrote on it, else (on our
 * own quarters) the field's crop that year, else "Pasture" on a quarter
 * marked as pasture (no canola, for isolation).
 */
export function cropFor(o: {
  parcel: string
  year: number
  labels: Map<string, { crop: string | null; notes: string | null }>
  fieldId: string | null
  ourCrops: Map<string, string>
  pasture?: boolean
}): CropCell {
  const l = o.labels.get(`${o.parcel}|${o.year}`)
  if (l?.crop) return { crop: l.crop, source: 'label', notes: l.notes }
  const ours = o.fieldId ? o.ourCrops.get(`${o.fieldId}|${o.year}`) : undefined
  if (ours) return { crop: ours, source: 'ours', notes: l?.notes ?? null }
  if (o.pasture) return { crop: PASTURE, source: 'pasture', notes: l?.notes ?? null }
  return { crop: null, source: null, notes: l?.notes ?? null }
}

/**
 * Who has a quarter that isn't ours (quarter_owners): pasture, or a
 * neighbour's land with the owner and how to reach them. Kept by quarter,
 * not by year.
 */
export type QuarterOwner = {
  id: string
  parcel: string
  kind: 'pasture' | 'neighbour'
  owner_name: string | null
  phone: string | null
  email: string | null
  notes: string | null
}

/** The owner's phone and email on one line: "403-555-0100 · someone@example.com". */
export const ownerContact = (o: Pick<QuarterOwner, 'phone' | 'email'> | null | undefined) =>
  [o?.phone?.trim(), o?.email?.trim()].filter(Boolean).join(' · ')

/** Whose a quarter is, in words: "This field", "Ours: Field 7", "Neighbour: Pat Doe", "Pasture (Pat Doe)". */
export function whoseLabel(r: { isTheField: boolean; ours: string | null; owner?: QuarterOwner | null }): string {
  if (r.isTheField) return 'This field'
  if (r.ours) return `Ours: ${r.ours}`
  const name = r.owner?.owner_name?.trim()
  if (r.owner?.kind === 'pasture') return name ? `Pasture (${name})` : 'Pasture'
  return name ? `Neighbour: ${name}` : 'Neighbour'
}

/** The years a report covers, newest first: this year and the four before. */
export const reportYears = (year: number) => Array.from({ length: HISTORY_YEARS + 1 }, (_, k) => year - k)

/** A crop's name for the report, with its herbicide trait for canola: "Canola (Liberty)". */
export function cropLabel(name: string | null | undefined, variety?: string | null): string | null {
  if (!name) return null
  return variety && variety.trim() ? `${name} — ${variety.trim()}` : name
}

/** Canola, any kind: the crops an isolation report is about. */
export const isCanolaCrop = (s: string | null | undefined) => /canola|rapeseed|mustard|camelina/i.test(s ?? '')
