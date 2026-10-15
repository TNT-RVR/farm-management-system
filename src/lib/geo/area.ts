import type { MultiPolygon, Position } from 'geojson'

export const M2_PER_ACRE = 4046.8564224
const EARTH_RADIUS_M = 6378137

/** Signed planar shoelace area on an equirectangular projection centred on the ring. */
export function ringAreaM2(ring: Position[]): number {
  if (ring.length < 3) return 0
  const lat0 = ring.reduce((s, p) => s + p[1], 0) / ring.length
  const k = Math.cos((lat0 * Math.PI) / 180)
  let sum = 0
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i]
    const [x2, y2] = ring[i + 1]
    sum += ((x1 * k * y2 - x2 * k * y1) * Math.PI * Math.PI) / (180 * 180)
  }
  return (sum / 2) * EARTH_RADIUS_M * EARTH_RADIUS_M
}

/** Approximate acres of a MultiPolygon (outer rings minus holes). Preview only — PostGIS is authoritative. */
export function multiPolygonAcres(mp: MultiPolygon): number {
  let m2 = 0
  for (const poly of mp.coordinates) {
    poly.forEach((ring, i) => {
      const a = Math.abs(ringAreaM2(ring))
      m2 += i === 0 ? a : -a
    })
  }
  return m2 / M2_PER_ACRE
}


export function boundsOf(mp: MultiPolygon): [[number, number], [number, number]] | null {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity
  for (const poly of mp.coordinates)
    for (const ring of poly)
      for (const [x, y] of ring) {
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
  if (!Number.isFinite(minX)) return null
  return [
    [minX, minY],
    [maxX, maxY],
  ]
}

/**
 * A point to hang a label on: the spot furthest from any edge of the field.
 *
 * NOT the average of the corners, which is what this used to be. A vertex
 * average is pulled toward wherever the corners happen to be dense, so a field
 * with a surveyed curve along one side and two straight sides has its label
 * dragged into the curve — which put Aspen Flat's name on Maple Flat.
 *
 * Nor the area centroid, which is unbiased but can land outside the field
 * altogether: an L around a slough, or a quarter split by a coulee, has its
 * centre of area in the part that is not the field.
 *
 * This is the pole of inaccessibility — the centre of the largest circle that
 * fits inside the polygon. Always inside, and visually central in the part of
 * the field with the most room to write in, which is exactly what a label
 * wants. Found by subdividing squares and keeping the most promising, the
 * standard approach.
 */
/**
 * How big a hole has to be before a label will avoid it.
 *
 * Eight fields here carry a pinprick interior ring for the pivot pad — between
 * 0.02 and 0.14% of the field. Treating those as obstacles is what pushed every
 * pivot's label off to one side: the largest circle that avoids a hole at the
 * dead centre of a circular field cannot itself be centred, so it slid out into
 * the annulus.
 *
 * A slough worth keeping a label out of is percent-scale. A pivot pad is three
 * orders of magnitude smaller and invisible at any zoom the label is read at,
 * so below this share of the field it is simply not there.
 */
const MIN_HOLE_SHARE = 0.01

export function labelPointOf(mp: MultiPolygon): [number, number] {
  let rings: Position[][] = []
  let bestArea = -1
  for (const poly of mp.coordinates) {
    if (!poly[0]) continue
    const a = Math.abs(ringAreaM2(poly[0]))
    if (a > bestArea) {
      bestArea = a
      rings = poly
    }
  }
  const outer = rings[0]
  if (!outer?.length) return [0, 0]
  // Only holes big enough to matter. bestArea is the outer ring's area.
  rings = [
    outer,
    ...rings.slice(1).filter((h) => Math.abs(ringAreaM2(h)) / bestArea >= MIN_HOLE_SHARE),
  ]

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [x, y] of outer) {
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  const width = maxX - minX
  const height = maxY - minY
  if (width === 0 || height === 0) return [minX, minY]

  // Degrees of longitude are shorter than degrees of latitude this far north,
  // so distances are scaled before comparing. Without it the largest circle is
  // found squashed east-west and the label sits off to one side.
  const kx = Math.cos((((minY + maxY) / 2) * Math.PI) / 180)

  const pointToSeg = (px: number, py: number, a: Position, b: Position) => {
    let x = a[0]
    let y = a[1]
    let dx = b[0] - x
    let dy = b[1] - y
    if (dx !== 0 || dy !== 0) {
      const t = ((px - x) * dx + (py - y) * dy) / (dx * dx + dy * dy)
      if (t > 1) {
        x = b[0]
        y = b[1]
      } else if (t > 0) {
        x += dx * t
        y += dy * t
      }
    }
    dx = (px - x) * kx
    dy = py - y
    return dx * dx + dy * dy
  }

  /** Distance to the nearest edge; negative outside the field. */
  const distance = (px: number, py: number) => {
    let inside = false
    let min = Infinity
    for (const ring of rings) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const a = ring[i]
        const b = ring[j]
        if (a[1] > py !== b[1] > py && px < ((b[0] - a[0]) * (py - a[1])) / (b[1] - a[1]) + a[0]) {
          inside = !inside
        }
        min = Math.min(min, pointToSeg(px, py, a, b))
      }
    }
    return (inside ? 1 : -1) * Math.sqrt(min)
  }

  type Cell = { x: number; y: number; h: number; d: number; max: number }
  const cell = (x: number, y: number, h: number): Cell => {
    const d = distance(x, y)
    // The best any point in this square could manage: its centre's distance
    // plus the half-diagonal. Squares that cannot beat the incumbent are
    // dropped without ever being subdivided.
    return { x, y, h, d, max: d + h * Math.SQRT2 }
  }

  const size = Math.min(width, height)
  const queue: Cell[] = []
  for (let x = minX; x < maxX; x += size / 2) {
    for (let y = minY; y < maxY; y += size / 2) {
      queue.push(cell(x + size / 4, y + size / 4, size / 4))
    }
  }
  let best = cell((minX + maxX) / 2, (minY + maxY) / 2, 0)
  // A metre or so at this latitude. Finer than a label can be positioned.
  const precision = size / 200

  while (queue.length) {
    queue.sort((a, b) => a.max - b.max)
    const c = queue.pop()!
    if (c.d > best.d) best = c
    if (c.max - best.d <= precision) continue
    const h = c.h / 2
    queue.push(cell(c.x - h, c.y - h, h))
    queue.push(cell(c.x + h, c.y - h, h))
    queue.push(cell(c.x - h, c.y + h, h))
    queue.push(cell(c.x + h, c.y + h, h))
  }
  return [best.x, best.y]
}
