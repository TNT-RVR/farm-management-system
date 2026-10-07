import type { MultiPolygon, Position } from 'geojson'

/**
 * Cut a field boundary with a straight line at a planting angle.
 *
 * This is how splits are actually made here: a line at the drill's bearing,
 * sometimes through the pivot point, sometimes taking half the field, sometimes
 * shaving a couple of acres off one end. The two sides come back as separate
 * polygons, ready to become crop zones.
 *
 * The line is defined by a bearing and a perpendicular offset from the field
 * centroid, rather than by two dragged endpoints. A bearing plus an offset is
 * what a person can actually reproduce next season — "the same angle, forty
 * metres further north" — where two corner points are just two numbers nobody
 * can check. Dragging still works; it sets the same two values.
 *
 * Maths runs in a local east/north metre frame centred on the field, because a
 * degree of longitude is not a degree of latitude and treating them alike
 * skews every angle. Over a field the flat-earth error is millimetres.
 */

const M_PER_DEG_LAT = 110_540
const M_PER_DEG_LON_EQ = 111_320

export type Cut = {
  /** Degrees clockwise from north. 0 and 180 describe the same line. */
  bearingDeg: number
  /** Metres perpendicular to the bearing, from the field centroid. */
  offsetM: number
}

/** Local metre frame anchored at a reference lon/lat. */
function frame(ref: Position) {
  const cosLat = Math.cos((ref[1] * Math.PI) / 180)
  return {
    toXY: (p: Position): [number, number] => [
      (p[0] - ref[0]) * M_PER_DEG_LON_EQ * cosLat,
      (p[1] - ref[1]) * M_PER_DEG_LAT,
    ],
    toLonLat: (x: number, y: number): Position => [
      ref[0] + x / (M_PER_DEG_LON_EQ * cosLat),
      ref[1] + y / M_PER_DEG_LAT,
    ],
  }
}

/**
 * Signed perpendicular distance (metres) from the cut line, positive on the
 * right-hand side of the bearing. Zero means exactly on the line.
 */
function sideOf(x: number, y: number, cut: Cut): number {
  const t = (cut.bearingDeg * Math.PI) / 180
  // Direction of travel along the line, in east/north.
  const ex = Math.sin(t)
  const ny = Math.cos(t)
  // Right-hand normal to that direction.
  return (x - cut.offsetM * ny) * ny - (y + cut.offsetM * ex) * ex
}

/**
 * Sutherland–Hodgman clip of one ring against a half-plane.
 *
 * A half-plane is convex, which is the case this algorithm is exact for. A
 * deeply concave boundary crossing the line more than twice can come back with
 * a zero-width seam joining two lobes — visually and areally correct, but not a
 * clean pair of parts. Quarter sections and pivot circles do not do this; an
 * L-shaped field might.
 */
function clipRing(ring: Array<[number, number]>, cut: Cut, keepRight: boolean): Array<[number, number]> {
  const inside = (p: [number, number]) => {
    const s = sideOf(p[0], p[1], cut)
    return keepRight ? s >= 0 : s <= 0
  }
  const out: Array<[number, number]> = []
  for (let i = 0; i < ring.length; i++) {
    const cur = ring[i]
    const prev = ring[(i + ring.length - 1) % ring.length]
    const curIn = inside(cur)
    const prevIn = inside(prev)
    if (curIn !== prevIn) {
      const sPrev = sideOf(prev[0], prev[1], cut)
      const sCur = sideOf(cur[0], cur[1], cut)
      const t = sPrev / (sPrev - sCur)
      out.push([prev[0] + t * (cur[0] - prev[0]), prev[1] + t * (cur[1] - prev[1])])
    }
    if (curIn) out.push(cur)
  }
  return out
}

/** Close a ring if the caller left it open. */
function closed(ring: Position[]): Position[] {
  if (ring.length < 3) return ring
  const [a, b] = [ring[0], ring[ring.length - 1]]
  return a[0] === b[0] && a[1] === b[1] ? ring : [...ring, a]
}

/**
 * Area centroid of a MultiPolygon's outer rings, in lon/lat.
 *
 * The true area centroid, not the mean of the vertices. Two reasons, and both
 * bite: a closed ring repeats its first point, so averaging vertices drags the
 * result toward that corner and "offset 0" stops meaning "through the middle";
 * and vertex density is uneven on a traced boundary, so even without the
 * duplicate a mean leans toward whichever side was clicked more carefully.
 */
export function centroidLonLat(mp: MultiPolygon): Position {
  let cx = 0
  let cy = 0
  let a2 = 0
  let sx = 0
  let sy = 0
  let n = 0
  for (const poly of mp.coordinates) {
    const ring = poly[0]
    if (!ring || ring.length < 3) continue
    const last = ring[ring.length - 1]
    const open =
      ring[0][0] === last[0] && ring[0][1] === last[1] ? ring.slice(0, -1) : ring
    for (let i = 0; i < open.length; i++) {
      const [x1, y1] = open[i]
      const [x2, y2] = open[(i + 1) % open.length]
      const cross = x1 * y2 - x2 * y1
      a2 += cross
      cx += (x1 + x2) * cross
      cy += (y1 + y2) * cross
      sx += x1
      sy += y1
      n++
    }
  }
  // A zero-area ring (a line, or points repeated) has no centroid; fall back to
  // the vertex mean so the frame still has somewhere sensible to anchor.
  if (Math.abs(a2) < 1e-14) return n ? [sx / n, sy / n] : [0, 0]
  return [cx / (3 * a2), cy / (3 * a2)]
}

export type SplitResult = { right: MultiPolygon | null; left: MultiPolygon | null }

/**
 * Split a boundary along the cut. `right` is the side clockwise of the bearing.
 * A side that the line misses entirely comes back null rather than as an empty
 * geometry — null says "this cut does not divide the field", which the caller
 * must not save as a zone.
 */
export function splitByLine(mp: MultiPolygon, cut: Cut, ref?: Position): SplitResult {
  const anchor = ref ?? centroidLonLat(mp)
  const f = frame(anchor)

  const build = (keepRight: boolean): MultiPolygon | null => {
    const polys: Position[][][] = []
    for (const poly of mp.coordinates) {
      const outer = poly[0]
      if (!outer || outer.length < 3) continue
      const clipped = clipRing(outer.map(f.toXY), cut, keepRight)
      // Two points cannot enclose area; that side of this ring is empty.
      if (clipped.length < 3) continue
      polys.push([closed(clipped.map(([x, y]) => f.toLonLat(x, y)))])
    }
    return polys.length ? { type: 'MultiPolygon', coordinates: polys } : null
  }

  return { right: build(true), left: build(false) }
}

/**
 * The cut implied by dragging a line between two map points: the bearing from
 * a to b, and the offset of that line from the field centroid. Lets the dragged
 * and typed controls be two handles on one value rather than two features.
 */
export function cutFromPoints(a: Position, b: Position, mp: MultiPolygon): Cut {
  const anchor = centroidLonLat(mp)
  const f = frame(anchor)
  const [ax, ay] = f.toXY(a)
  const [bx, by] = f.toXY(b)
  const bearing = ((Math.atan2(bx - ax, by - ay) * 180) / Math.PI + 360) % 360
  // Perpendicular distance from the centroid (the frame origin) to the line.
  const t = (bearing * Math.PI) / 180
  const ex = Math.sin(t)
  const ny = Math.cos(t)
  const offset = ax * ny - ay * ex
  return { bearingDeg: Math.round(bearing * 10) / 10, offsetM: Math.round(offset) }
}

/**
 * Two lon/lat points on the cut, far enough apart to cross any field, for
 * drawing it on the map.
 */
export function cutEndpoints(cut: Cut, mp: MultiPolygon, spanM = 4000): [Position, Position] {
  const anchor = centroidLonLat(mp)
  const f = frame(anchor)
  const t = (cut.bearingDeg * Math.PI) / 180
  const ex = Math.sin(t)
  const ny = Math.cos(t)
  // A point on the line: the centroid pushed out along the right-hand normal.
  const px = cut.offsetM * ny
  const py = -cut.offsetM * ex
  return [
    f.toLonLat(px - ex * spanM, py - ny * spanM),
    f.toLonLat(px + ex * spanM, py + ny * spanM),
  ]
}
