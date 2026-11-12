import type { MultiPolygon, Position } from 'geojson'
import { pastureLabel } from '@/lib/pastureLabel'

export type PlanMapPasture = { id: string; name: string; geojson: MultiPolygon }

/** Short name for a pasture: its letter ("E West") or its name. */
export const shortName = (name: string) => {
  const l = pastureLabel(name)
  return l ? (l.part ? `${l.letter} ${l.part}` : l.letter) : name
}

/** Rough metres between two [lng, lat] points; fine at farm scale. */
function metres(a: Position, b: Position): number {
  const k = Math.cos(((a[1] + b[1]) / 2) * (Math.PI / 180))
  const dx = (a[0] - b[0]) * 111_320 * k
  const dy = (a[1] - b[1]) * 110_540
  return Math.hypot(dx, dy)
}

/** Distance from a point to a segment, in metres (planar at farm scale). */
function toSegment(p: Position, a: Position, b: Position): number {
  const k = Math.cos(p[1] * (Math.PI / 180))
  const A = [a[0] * k, a[1]]
  const B = [b[0] * k, b[1]]
  const P = [p[0] * k, p[1]]
  const dx = B[0] - A[0]
  const dy = B[1] - A[1]
  const t = dx || dy ? Math.max(0, Math.min(1, ((P[0] - A[0]) * dx + (P[1] - A[1]) * dy) / (dx * dx + dy * dy))) : 0
  return metres([(A[0] + t * dx) / k, A[1] + t * dy], p)
}

/** The two pastures whose fences pass nearest a tapped point, if both are within `within` metres. */
export function nearestFencePair(pastures: PlanMapPasture[], at: Position, within = 60): [string, string] | null {
  const d = pastures
    .map((p) => {
      let best = Infinity
      for (const poly of p.geojson.coordinates)
        for (const ring of poly) for (let i = 1; i < ring.length; i++) best = Math.min(best, toSegment(at, ring[i - 1], ring[i]))
      return { id: p.id, d: best }
    })
    .sort((a, b) => a.d - b.d)
  return d.length >= 2 && d[1].d <= within ? [d[0].id, d[1].id] : null
}

/** The biggest ring's vertex average: good enough to hang a move line on. */
export function centroid(g: MultiPolygon): Position {
  let ring = g.coordinates[0]?.[0] ?? []
  for (const poly of g.coordinates) if ((poly[0]?.length ?? 0) > ring.length) ring = poly[0]
  const n = Math.max(1, ring.length - 1)
  let x = 0
  let y = 0
  for (let i = 0; i < n; i++) {
    x += ring[i][0]
    y += ring[i][1]
  }
  return [x / n, y / n]
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * The month a stay falls in, or the two it spans: 'May', 'May–Jun'.
 *
 * Short enough to sit inside a paddock at map scale, which is the point: the
 * route round the farm should read off the map, not off the season chart.
 */
export function stayMonths(start: string, end: string): string {
  const a = MONTHS[Number(start.slice(5, 7)) - 1]
  const b = MONTHS[Number(end.slice(5, 7)) - 1]
  if (!a) return ''
  return !b || a === b ? a : `${a}–${b}`
}
