/**
 * The last bit of the way into a field.
 *
 * Sam (2 Oct 2026): "get as close to the field as you can, then the trail
 * segment router will finish the last bit of the path." The road router
 * (OSRM) knows public roads; it does not know the farm trail down to the
 * river flats, so it sent 9/Maple Flat and 10/Aspen Flat 84 km round
 * the river to a road on the far bank. Here, for one start and one field:
 *
 *   1. ROAD. Ask the router for the field's entry. It snaps the entry to the
 *      nearest road; if that road point is within GAP_M of the entry and the
 *      route is not an obvious detour, the trip is the road plus that gap.
 *   2. ROAD + TRAIL. Otherwise, along the trails drawn on the map: road to a
 *      trailhead (a trail point within TRAILHEAD_M of a road), the trail to
 *      the trail point nearest the entry, and a short walk in. Every
 *      trailhead is tried at once (a shortest path from all of them, each
 *      starting at its road distance), so the answer is the combination with
 *      the least road + trail + connector km.
 *   3. ROAD + STRAIGHT. No trail reaches it: the road followed as close to
 *      the field as it goes, then the straight line × 1.3, flagged — draw the
 *      trail or type the distance. Road points are searched in rings round
 *      the field, so a road only reachable the long way round (the far bank)
 *      loses to one on the near side.
 *
 * A field set to take the trails (fields.route_via = 'trails'; Sam, 7 Oct
 * 2026, for 5, 11 and 12) tries the trails first: from the start itself when
 * a trail begins at it, else from a trailhead on the road, with road counted
 * at ROAD_WEIGHT times its length so the way with the most trail wins. The
 * road only when no trail reaches the field.
 *
 * The entry is the field's pin when somebody has dropped one. Until then it
 * is suggested: the point on the boundary nearest where the road (or the
 * trail) arrives. With no boundary, the field's centre, flagged.
 *
 * Pure. The router's answers come in through `snap`; a plan that needs one
 * it does not have says which points to ask about (`need`), and the worker
 * asks and calls again.
 */
import {
  NO_TRAIL_NOTE,
  ROAD_FACTOR,
  isDetour,
  metresBetween,
  roundPt,
  type EntryBasis,
  type LatLng,
  type RouteMethod,
  type Snap,
} from './road-routes'

/** The road ends this close to the entry: it is the road all the way. */
export const GAP_M = 150
/** A trail point this close to a road is somewhere a machine can turn onto the trail. */
export const TRAILHEAD_M = 150
/** The trail has to come this close to the entry to be the way in. */
export const TRAIL_END_M = 300
/** Trail points this close together are the same place (two trails drawn to meet). */
export const JOIN_M = 8
/** A trail that stops this short of another one joins it. */
export const LINK_M = 30
/** Trails are cut into pieces no longer than this, so a trail running beside a road can be joined anywhere along it. */
export const DENSIFY_M = 100
/** Trail speed when the farm has not set one. */
export const TRAIL_KMH_DEFAULT = 25
/**
 * Choosing where to leave the road, a km of guessed straight line counts as
 * this many km of road. At 1.3 (what it is costed at) the cheapest answer was
 * often to leave the road early and cut 1.5 km across country; at 4 the road
 * is followed as close to the field as it goes, which is what Sam asked
 * for. The distance itself still uses × ROAD_FACTOR.
 */
export const STRAIGHT_CHOICE_WEIGHT = 4
/** For a field set to take the trails: a metre of road counts as this many of trail when choosing the way. */
export const ROAD_WEIGHT = 4
/** Where to look for a nearer road, round the field. */
export const CANDIDATE_RADII_M = [300, 600, 1000, 1500, 2200, 3000]
export const CANDIDATE_BEARINGS = 8

/** [lng, lat], as GeoJSON has it. */
export type Coord = [number, number]
export type TrailLine = { id: string; name: string; coords: Coord[] }
export type TrailGraph = { nodes: LatLng[]; adj: { to: number; m: number }[][] }
/** GeoJSON MultiPolygon coordinates. */
export type Boundary = number[][][][]

const toLL = (c: Coord | number[]): LatLng => ({ lat: c[1], lng: c[0] })
const toC = (p: LatLng): Coord => [p.lng, p.lat]

/** Flat metres round a point — plenty for a few km. */
function flat(ref: LatLng) {
  const kx = 111_320 * Math.cos((ref.lat * Math.PI) / 180)
  const ky = 110_574
  return {
    x: (p: LatLng) => (p.lng - ref.lng) * kx,
    y: (p: LatLng) => (p.lat - ref.lat) * ky,
    back: (x: number, y: number): LatLng => ({ lat: ref.lat + y / ky, lng: ref.lng + x / kx }),
  }
}

/** The nearest point to p on the segment a–b, how far along (0–1), and how far away. */
export function nearestOnSegment(p: LatLng, a: LatLng, b: LatLng): { point: LatLng; t: number; m: number } {
  const k = flat(p)
  const ax = k.x(a)
  const ay = k.y(a)
  const dx = k.x(b) - ax
  const dy = k.y(b) - ay
  const len2 = dx * dx + dy * dy
  const t = len2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0
  const x = ax + t * dx
  const y = ay + t * dy
  return { point: k.back(x, y), t, m: Math.hypot(x, y) }
}

/** The nearest point on a field's boundary. */
export function nearestOnBoundary(p: LatLng, boundary: Boundary): LatLng | null {
  let best: { point: LatLng; m: number } | null = null
  for (const poly of boundary)
    for (const ring of poly)
      for (let i = 0; i + 1 < ring.length; i++) {
        const r = nearestOnSegment(p, toLL(ring[i]), toLL(ring[i + 1]))
        if (!best || r.m < best.m) best = r
      }
  return best?.point ?? null
}

/** A line with no piece longer than maxM, and no repeated points. */
export function densify(coords: Coord[], maxM = DENSIFY_M): Coord[] {
  const out: Coord[] = []
  for (const c of coords) {
    const a = out[out.length - 1]
    if (a) {
      const m = metresBetween(toLL(a), toLL(c))
      if (m < 0.05) continue
      const k = Math.ceil(m / maxM)
      for (let j = 1; j < k; j++) out.push([a[0] + ((c[0] - a[0]) * j) / k, a[1] + ((c[1] - a[1]) * j) / k])
    }
    out.push(c)
  }
  return out
}

/**
 * The trails as one network.
 *
 * Trails are drawn by clicking, so two that meet rarely share a point
 * exactly: points within JOIN_M are made one, and a trail whose end stops
 * within LINK_M of another trail is joined to the nearest point along it
 * (a new point is put in the other trail there).
 */
export function buildTrailGraph(trails: TrailLine[]): TrailGraph {
  const lines = trails.map((t) => densify(t.coords)).filter((l) => l.length >= 2)

  const inserts = lines.map(() => [] as { seg: number; t: number; c: Coord }[])
  const links: [Coord, Coord][] = []
  lines.forEach((line, li) => {
    const ends: [Coord, number][] = [
      [line[0], 0],
      [line[line.length - 1], line.length - 2],
    ]
    for (const [end, ownSeg] of ends) {
      const e = toLL(end)
      let best: { li: number; seg: number; t: number; point: LatLng; m: number } | null = null
      for (let oi = 0; oi < lines.length; oi++) {
        const other = lines[oi]
        for (let s = 0; s + 1 < other.length; s++) {
          // The end's own piece of trail always touches it.
          if (oi === li && s === ownSeg) continue
          const r = nearestOnSegment(e, toLL(other[s]), toLL(other[s + 1]))
          if (r.m <= LINK_M && (!best || r.m < best.m)) best = { li: oi, seg: s, ...r }
        }
      }
      if (best && best.m > 0.05) {
        inserts[best.li].push({ seg: best.seg, t: best.t, c: toC(best.point) })
        links.push([end, toC(best.point)])
      }
    }
  })
  const joined = lines.map((line, li) => {
    if (!inserts[li].length) return line
    const extra = [...inserts[li]].sort((a, b) => a.seg - b.seg || a.t - b.t)
    const out: Coord[] = []
    line.forEach((c, i) => {
      out.push(c)
      for (const x of extra) if (x.seg === i) out.push(x.c)
    })
    return out
  })

  const nodes: LatLng[] = []
  const adj: { to: number; m: number }[][] = []
  const grid = new Map<string, number[]>()
  // Cells about 22 m square, so a point and everything within JOIN_M of it
  // are in its cell or the eight round it.
  const cell = (p: LatLng) => [Math.floor(p.lat / 0.0002), Math.floor(p.lng / 0.0003)]
  const nodeAt = (c: Coord): number => {
    const p = toLL(c)
    const [gy, gx] = cell(p)
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++)
        for (const i of grid.get(`${gy + dy},${gx + dx}`) ?? []) if (metresBetween(nodes[i], p) <= JOIN_M) return i
    nodes.push(p)
    adj.push([])
    const key = `${gy},${gx}`
    grid.set(key, [...(grid.get(key) ?? []), nodes.length - 1])
    return nodes.length - 1
  }
  const edge = (a: number, b: number) => {
    if (a === b) return
    const m = metresBetween(nodes[a], nodes[b])
    adj[a].push({ to: b, m })
    adj[b].push({ to: a, m })
  }
  for (const line of joined) {
    let prev = nodeAt(line[0])
    for (let i = 1; i < line.length; i++) {
      const cur = nodeAt(line[i])
      edge(prev, cur)
      prev = cur
    }
  }
  for (const [a, b] of links) edge(nodeAt(a), nodeAt(b))
  return { nodes, adj }
}

export type Reach = {
  /** Cost to each node, metres; Infinity where unreached. */
  dist: Float64Array
  /** The node before it on the cheapest way, -1 at a source. */
  prev: Int32Array
}

/** Cheapest way to every node from several sources, each starting at its own cost (Dijkstra). */
export function shortestFrom(g: TrailGraph, sources: { node: number; cost: number }[]): Reach {
  const dist = new Float64Array(g.nodes.length).fill(Infinity)
  const prev = new Int32Array(g.nodes.length).fill(-1)
  const heap: [number, number][] = []
  const push = (item: [number, number]) => {
    heap.push(item)
    let i = heap.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (heap[p][0] <= heap[i][0]) break
      ;[heap[p], heap[i]] = [heap[i], heap[p]]
      i = p
    }
  }
  const pop = (): [number, number] => {
    const top = heap[0]
    const last = heap.pop()!
    if (heap.length) {
      heap[0] = last
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let m = i
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r
        if (m === i) break
        ;[heap[m], heap[i]] = [heap[i], heap[m]]
        i = m
      }
    }
    return top
  }
  for (const s of sources)
    if (s.cost < dist[s.node]) {
      dist[s.node] = s.cost
      push([s.cost, s.node])
    }
  while (heap.length) {
    const [d, u] = pop()
    if (d > dist[u]) continue
    for (const { to, m } of g.adj[u]) {
      const nd = d + m
      if (nd < dist[to]) {
        dist[to] = nd
        prev[to] = u
        push([nd, to])
      }
    }
  }
  return { dist, prev }
}

/** The nodes from the source to `node`, in order. */
/** Metres along a chain of trail nodes. */
export function chainMetres(g: TrailGraph, chain: number[]): number {
  let m = 0
  for (let k = 1; k < chain.length; k++) m += g.adj[chain[k - 1]].find((e) => e.to === chain[k])?.m ?? metresBetween(g.nodes[chain[k - 1]], g.nodes[chain[k]])
  return m
}

export function pathTo(r: Reach, node: number): number[] {
  const out: number[] = []
  for (let i = node; i !== -1; i = r.prev[i]) out.push(i)
  return out.reverse()
}

/** Points in rings round a place, to find the nearest road the router can actually reach. */
export function candidatePoints(center: LatLng): LatLng[] {
  const k = flat(center)
  const out: LatLng[] = []
  for (const r of CANDIDATE_RADII_M)
    for (let i = 0; i < CANDIDATE_BEARINGS; i++) {
      const a = (2 * Math.PI * i) / CANDIDATE_BEARINGS
      out.push(roundPt(k.back(r * Math.sin(a), r * Math.cos(a))))
    }
  return out
}

export type FieldEnd = { pin: LatLng | null; centroid: LatLng | null; boundary: Boundary | null }

export type RoutePlan = {
  method: Exclude<RouteMethod, 'typed'>
  entry: LatLng
  entryBasis: EntryBasis
  /** Where the road part ends. */
  approach: LatLng
  roadKm: number
  roadMin: number
  trailKm: number
  /** Short straight bits (road to trailhead, trail to entry), or the whole guessed line × 1.3. */
  connectorKm: number
  km: number
  minutes: number
  /** The off-road part, approach → entry. */
  path: Coord[]
  note: string | null
}

export type PlanResult = { plan: RoutePlan | null; need: LatLng[]; why?: string }

const r3 = (x: number) => Math.round(x * 1000) / 1000

function make(
  p: Omit<RoutePlan, 'km' | 'minutes' | 'roadKm' | 'trailKm' | 'connectorKm' | 'roadMin'> & { roadKm: number; roadMin: number; trailKm: number; connectorKm: number },
  trailKmh: number,
): RoutePlan {
  const off = p.trailKm + p.connectorKm
  return {
    ...p,
    roadKm: r3(p.roadKm),
    trailKm: r3(p.trailKm),
    connectorKm: r3(p.connectorKm),
    km: r3(p.roadKm + off),
    minutes: Math.round((p.roadMin + (trailKmh > 0 ? (off / trailKmh) * 60 : 0)) * 10) / 10,
  }
}

/** One start to one field: road, road + trail, or road + straight (see the top of the file). */
export function planRoute(args: {
  start: LatLng
  end: FieldEnd
  snap: (p: LatLng) => Snap | undefined
  trails: TrailGraph
  trailKmh: number
  /** fields.route_via = 'trails': the trails wherever they reach the field, even when the road is shorter. */
  preferTrails?: boolean
}): PlanResult {
  const { start, end, snap, trails, trailKmh } = args
  const base = end.pin ?? end.centroid
  if (!base) return { plan: null, need: [], why: 'no location for the field' }
  const entryBasis: EntryBasis = end.pin ? 'pin' : end.boundary ? 'suggested' : 'centroid'
  const target = (p: LatLng): LatLng => end.pin ?? (end.boundary ? (nearestOnBoundary(p, end.boundary) ?? base) : base)
  const centreNote = entryBasis === 'centroid' ? 'no boundary — measured to the middle of the field' : null

  /**
   * Along the trails: from trailheads on the road (each starting at its road
   * distance) and, for a field set to take the trails, from trail points at
   * the start itself; then the trail point nearest the entry and a short walk
   * in. Null when no trail reaches the field.
   */
  function viaTrails(prefer: boolean): PlanResult | null {
    if (!trails.nodes.length) return null
    const need = trails.nodes.filter((p) => !snap(p)).map(roundPt)
    if (need.length) return { plan: null, need }
    const from = new Map<number, { cost: number; atStart: boolean }>()
    trails.nodes.forEach((p, i) => {
      const s = snap(p)!
      // Off-road straight bits count STRAIGHT_CHOICE_WEIGHT times, so a drawn trail is followed rather than cut across.
      if (s.roadKm != null && s.snapM != null && s.snapM <= TRAILHEAD_M) from.set(i, { cost: s.roadKm * 1000 * (prefer ? ROAD_WEIGHT : 1) + s.snapM * STRAIGHT_CHOICE_WEIGHT, atStart: false })
      const m = metresBetween(start, p)
      if (prefer && m <= TRAILHEAD_M && m * STRAIGHT_CHOICE_WEIGHT < (from.get(i)?.cost ?? Infinity)) from.set(i, { cost: m * STRAIGHT_CHOICE_WEIGHT, atStart: true })
    })
    if (!from.size) return null
    const reach = shortestFrom(trails, [...from].map(([node, f]) => ({ node, cost: f.cost })))
    let best: { node: number; entry: LatLng; m: number; total: number } | null = null
    trails.nodes.forEach((p, i) => {
      if (!Number.isFinite(reach.dist[i])) return
      const entry = target(p)
      const m = metresBetween(p, entry)
      if (m > TRAIL_END_M) return
      const total = reach.dist[i] + m * STRAIGHT_CHOICE_WEIGHT
      if (!best || total < best.total) best = { node: i, entry, m, total }
    })
    if (!best) return null
    const b = best as { node: number; entry: LatLng; m: number; total: number }
    const chain = pathTo(reach, b.node)
    const trailM = chainMetres(trails, chain)
    const head = from.get(chain[0])!
    if (head.atStart) {
      const startM = metresBetween(start, trails.nodes[chain[0]])
      return {
        plan: make(
          {
            method: 'road+trail',
            entry: b.entry,
            entryBasis,
            approach: start,
            roadKm: 0,
            roadMin: 0,
            trailKm: trailM / 1000,
            connectorKm: (startM + b.m) / 1000,
            path: [toC(start), ...chain.map((i) => toC(trails.nodes[i])), toC(b.entry)],
            note: centreNote,
          },
          trailKmh,
        ),
        need: [],
      }
    }
    const hs = snap(trails.nodes[chain[0]])!
    const approach = { lat: hs.snapLat!, lng: hs.snapLng! }
    return {
      plan: make(
        {
          method: 'road+trail',
          entry: b.entry,
          entryBasis,
          approach,
          roadKm: hs.roadKm!,
          roadMin: hs.roadMin!,
          trailKm: trailM / 1000,
          connectorKm: (hs.snapM! + b.m) / 1000,
          path: [toC(approach), ...chain.map((i) => toC(trails.nodes[i])), toC(b.entry)],
          note: centreNote,
        },
        trailKmh,
      ),
      need: [],
    }
  }

  // 0. A field set to take the trails: the trails first, wherever they reach it.
  if (args.preferTrails) {
    const t = viaTrails(true)
    if (t) return t
  }

  // 1. The road all the way.
  const s0 = snap(base)
  if (!s0) return { plan: null, need: [roundPt(base)] }
  if (s0.roadKm != null && s0.roadMin != null && s0.snapLat != null && s0.snapLng != null) {
    const approach = { lat: s0.snapLat, lng: s0.snapLng }
    const entry = target(approach)
    const gap = metresBetween(approach, entry)
    if (gap <= GAP_M && !isDetour(s0.roadKm + gap / 1000, metresBetween(start, entry) / 1000)) {
      const road = make({ method: 'road', entry, entryBasis, approach, roadKm: s0.roadKm, roadMin: s0.roadMin, trailKm: 0, connectorKm: gap / 1000, path: [toC(approach), toC(entry)], note: centreNote }, trailKmh)
      // A trail drawn right to the entry is how the field is got into (Sam,
      // 7 Oct 2026: #8's trail runs from the corner to its gate, but the road
      // passed 96 m away and a straight line was drawn instead). Taken over a
      // road that stops short, unless it is a long way round.
      if (gap > LINK_M && trails.nodes.some((p) => metresBetween(p, entry) <= LINK_M)) {
        const t = viaTrails(false)
        if (t && !t.plan) return t
        if (t?.plan && t.plan.km <= road.km * 1.5 + 0.5) return t
      }
      return { plan: road, need: [] }
    }
  }

  // 2. Road to the best trailhead, then the trail.
  const trail = viaTrails(false)
  if (trail) return trail

  // 3. As close as the road gets, then a straight line, flagged.
  const cands = [roundPt(base), ...candidatePoints(base)]
  const need = cands.filter((p) => !snap(p))
  if (need.length) return { plan: null, need }
  let best: { s: Snap; approach: LatLng; entry: LatLng; m: number; cost: number } | null = null
  for (const c of cands) {
    const s = snap(c)!
    if (s.roadKm == null || s.roadMin == null || s.snapLat == null || s.snapLng == null) continue
    const approach = { lat: s.snapLat, lng: s.snapLng }
    const entry = target(approach)
    const m = metresBetween(approach, entry)
    const cost = s.roadKm + (STRAIGHT_CHOICE_WEIGHT * m) / 1000
    if (!best || cost < best.cost) best = { s, approach, entry, m, cost }
  }
  if (!best) return { plan: null, need: [], why: 'the router found no road near the field' }
  const b = best as { s: Snap; approach: LatLng; entry: LatLng; m: number; cost: number }
  return {
    plan: make(
      {
        method: 'road+straight',
        entry: b.entry,
        entryBasis,
        approach: b.approach,
        roadKm: b.s.roadKm!,
        roadMin: b.s.roadMin!,
        trailKm: 0,
        connectorKm: (ROAD_FACTOR * b.m) / 1000,
        path: [toC(b.approach), toC(b.entry)],
        note: `${NO_TRAIL_NOTE}. The road gets to ${Math.round(b.m)} m from the ${entryBasis === 'pin' ? 'entry pin' : 'field'}; the rest is the straight line × ${ROAD_FACTOR}.`,
      },
      trailKmh,
    ),
    need: [],
  }
}

/**
 * The same field from somewhere else (an elevator), coming in the same way:
 * the road from there to the plan's approach, then the plan's last bit.
 * `s` is the router's answer for the approach point from that place.
 */
export function planFrom(plan: RoutePlan, s: Snap | undefined, trailKmh: number): RoutePlan | null {
  if (!s || s.roadKm == null || s.roadMin == null) return null
  return make(
    {
      method: plan.method,
      entry: plan.entry,
      entryBasis: plan.entryBasis,
      approach: plan.approach,
      path: plan.path,
      note: plan.note,
      roadKm: s.roadKm,
      roadMin: s.roadMin,
      trailKm: plan.trailKm,
      connectorKm: plan.connectorKm + (s.snapM ?? 0) / 1000,
    },
    trailKmh,
  )
}

/** A GeoJSON LineString's points as a trail, or null if it is not one. */
export function trailFromGeoJson(id: string, name: string, geometry: unknown): TrailLine | null {
  const g = geometry as { type?: string; coordinates?: unknown } | null
  if (g?.type !== 'LineString' || !Array.isArray(g.coordinates)) return null
  const coords = (g.coordinates as unknown[])
    .filter((c): c is number[] => Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]))
    .map((c) => [c[0], c[1]] as Coord)
  return coords.length >= 2 ? { id, name, coords } : null
}

/* ------------------------------------------------------------- editing trails */

/** A trail point let go this close to another trail, the shop or the bins lands on it (the Distances map). */
export const SNAP_M = 25

/** Metres east/north of a point, for short distances. */
const flatAt = (o: Coord) => {
  const kx = 111_320 * Math.cos((o[1] * Math.PI) / 180)
  const ky = 110_574
  return { xy: (c: Coord) => ({ x: (c[0] - o[0]) * kx, y: (c[1] - o[1]) * ky }), back: (x: number, y: number): Coord => [o[0] + x / kx, o[1] + y / ky] }
}

/** The nearest point on any of `lines` (or one of `points`) within SNAP_M of `c`, else `c`. */
export function snapCoord(c: Coord, lines: Coord[][], points: Coord[]): Coord {
  const f = flatAt(c)
  let best: { d: number; at: Coord } | null = null
  const consider = (d: number, at: Coord) => {
    if (d <= SNAP_M && (!best || d < best.d)) best = { d, at }
  }
  for (const p of points) {
    const q = f.xy(p)
    consider(Math.hypot(q.x, q.y), p)
  }
  for (const line of lines)
    for (let i = 0; i < line.length; i++) {
      const a = f.xy(line[i])
      consider(Math.hypot(a.x, a.y), line[i])
      if (i === 0) continue
      const b = f.xy(line[i - 1])
      const dx = a.x - b.x
      const dy = a.y - b.y
      const len2 = dx * dx + dy * dy
      if (!len2) continue
      const t = Math.max(0, Math.min(1, -(b.x * dx + b.y * dy) / len2))
      const px = b.x + t * dx
      const py = b.y + t * dy
      consider(Math.hypot(px, py), f.back(px, py))
    }
  return best ? (best as { d: number; at: Coord }).at : c
}

/* ------------------------------------------------------------- via points */

/**
 * The road legs through a field's via points (fields.route_through): the
 * start to the first point, then point to point. `snapFrom(i)` is the router's
 * cache from the start (i = 0) or from via point i − 1. Null with `need` when
 * a leg has not been asked yet; null without when the road cannot do a leg.
 */
export function viaLegs(
  vias: LatLng[],
  snapFrom: (i: number) => (p: LatLng) => Snap | undefined,
): { km: number; minutes: number; need: { from: number; at: LatLng }[] } | null {
  let km = 0
  let minutes = 0
  const need: { from: number; at: LatLng }[] = []
  vias.forEach((v, i) => {
    const s = snapFrom(i)(v)
    if (!s) need.push({ from: i, at: roundPt(v) })
    else if (s.roadKm != null && s.roadMin != null) {
      km += s.roadKm
      minutes += s.roadMin
    } else km = NaN
  })
  if (need.length) return { km: 0, minutes: 0, need }
  return Number.isFinite(km) ? { km, minutes, need } : null
}

/** A plan from the last via point, with the legs before it added on as road. */
export function withLegs(plan: RoutePlan, legs: { km: number; minutes: number }): RoutePlan {
  return {
    ...plan,
    roadKm: r3(plan.roadKm + legs.km),
    roadMin: Math.round((plan.roadMin + legs.minutes) * 10) / 10,
    km: r3(plan.km + legs.km),
    minutes: Math.round((plan.minutes + legs.minutes) * 10) / 10,
  }
}
