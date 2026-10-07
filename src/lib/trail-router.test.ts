import { describe, expect, it } from 'vitest'
import { metresBetween, ptKey, roundPt, type LatLng, type Snap } from './road-routes'
import {
  buildTrailGraph,
  candidatePoints,
  densify,
  nearestOnBoundary,
  pathTo,
  planFrom,
  planRoute,
  shortestFrom,
  snapCoord,
  trailFromGeoJson,
  viaLegs,
  withLegs,
  type Boundary,
  type Coord,
  type TrailGraph,
} from './trail-router'

// A flat little world in metres round a point on the farm: x east, y north.
const O = { lat: 52.4, lng: -108.8 }
const KX = 111_320 * Math.cos((O.lat * Math.PI) / 180)
const KY = 110_574
const at = (x: number, y: number): LatLng => ({ lat: O.lat + y / KY, lng: O.lng + x / KX })
const c = (x: number, y: number): Coord => [at(x, y).lng, at(x, y).lat]
const xy = (p: LatLng) => ({ x: (p.lng - O.lng) * KX, y: (p.lat - O.lat) * KY })

// A 400 m square field round the origin.
const square: Boundary = [[[c(-200, -200), c(200, -200), c(200, 200), c(-200, 200), c(-200, -200)]]]
const start = at(0, -5000)
const none: TrailGraph = { nodes: [], adj: [] }

/** A road along y = roadY, 4.75 km from the start where it passes x = 0. */
function straightRoad(roadY: number) {
  return (p: LatLng): Snap => {
    const { x, y } = xy(p)
    const s = at(x, roadY)
    return { ...p, snapLat: s.lat, snapLng: s.lng, snapM: Math.abs(y - roadY), roadKm: (5000 + roadY) / 1000 + Math.abs(x) / 1000, roadMin: 10 }
  }
}

/**
 * The river flats: north of the field's middle the nearest road is on the far
 * bank (80 km round by road); south of it, a road at y = -1000, 4 km out.
 */
function river(p: LatLng): Snap {
  const { x, y } = xy(p)
  if (y > 0) {
    const s = at(x, 300)
    return { ...p, snapLat: s.lat, snapLng: s.lng, snapM: Math.abs(y - 300), roadKm: 80, roadMin: 90 }
  }
  const s = at(x, -1000)
  return { ...p, snapLat: s.lat, snapLng: s.lng, snapM: Math.abs(y + 1000), roadKm: 4 + Math.abs(x) / 1000, roadMin: 8 }
}

describe('trail network', () => {
  it('cuts a long trail into short pieces', () => {
    const d = densify([c(0, 0), c(0, 250)])
    expect(d).toHaveLength(4)
    expect(densify([c(0, 0), c(0, 0), c(0, 50)])).toHaveLength(2)
  })

  it('makes one place of two trails drawn to meet', () => {
    const g = buildTrailGraph([
      { id: 'a', name: 'A', coords: [c(0, 0), c(0, 90)] },
      { id: 'b', name: 'B', coords: [c(3, 92), c(80, 92)] },
    ])
    expect(g.nodes).toHaveLength(3)
    const r = shortestFrom(g, [{ node: 0, cost: 0 }])
    expect(r.dist[2]).toBeGreaterThan(160)
    expect(r.dist[2]).toBeLessThan(175)
  })

  it('joins a trail that stops just short of another one, partway along it', () => {
    // B runs east and stops 20 m short of the middle of A.
    const g = buildTrailGraph([
      { id: 'a', name: 'A', coords: [c(0, -80), c(0, 80)] },
      { id: 'b', name: 'B', coords: [c(90, 0), c(20, 0)] },
    ])
    const far = g.nodes.findIndex((p) => Math.abs(xy(p).x - 90) < 1)
    const top = g.nodes.findIndex((p) => Math.abs(xy(p).y - 80) < 1)
    const r = shortestFrom(g, [{ node: far, cost: 0 }])
    // 70 along B, 20 to the junction, 80 up A.
    expect(r.dist[top]).toBeCloseTo(170, 0)
    expect(pathTo(r, top).length).toBeGreaterThanOrEqual(3)
  })

  it('starts from several trailheads at once and keeps the cheapest', () => {
    const g = buildTrailGraph([{ id: 'a', name: 'A', coords: [c(0, 0), c(0, 100), c(0, 200)] }])
    const end = g.nodes.findIndex((p) => Math.abs(xy(p).y - 200) < 1)
    const r = shortestFrom(g, [
      { node: 0, cost: 1000 },
      { node: end, cost: 5000 },
    ])
    expect(Math.abs(r.dist[end] - 1200)).toBeLessThan(10)
    expect(pathTo(r, end)[0]).toBe(0)
  })

  it('reads a GeoJSON line, and refuses anything else', () => {
    expect(trailFromGeoJson('t', 'Flats', { type: 'LineString', coordinates: [c(0, 0), c(0, 50)] })?.coords).toHaveLength(2)
    expect(trailFromGeoJson('t', 'Flats', { type: 'Point', coordinates: c(0, 0) })).toBeNull()
  })
})

describe('field entry', () => {
  it('finds the nearest point on the boundary', () => {
    const p = nearestOnBoundary(at(50, -600), square)!
    expect(xy(p).x).toBeCloseTo(50, 0)
    expect(xy(p).y).toBeCloseTo(-200, 0)
  })

  it('looks for a nearer road in rings round the field', () => {
    const pts = candidatePoints(at(0, 0))
    expect(pts).toHaveLength(48)
    expect(Math.abs(Math.max(...pts.map((p) => metresBetween(p, at(0, 0)))) - 3000)).toBeLessThan(30)
  })
})

describe('planning a route', () => {
  it('is the road all the way when the road runs past the field', () => {
    const { plan } = planRoute({ start, end: { pin: null, centroid: at(0, 0), boundary: square }, snap: straightRoad(-250), trails: none, trailKmh: 25 })
    expect(plan!.method).toBe('road')
    expect(plan!.entryBasis).toBe('suggested')
    // The suggested entry is the boundary point nearest where the road arrives.
    expect(xy(plan!.entry).y).toBeCloseTo(-200, 0)
    expect(plan!.km).toBeCloseTo(4.75 + 0.05, 2)
  })

  it('goes to a pin when one is dropped', () => {
    const pin = at(150, -200)
    const { plan } = planRoute({ start, end: { pin, centroid: at(0, 0), boundary: square }, snap: straightRoad(-250), trails: none, trailKmh: 25 })
    expect(plan!.entryBasis).toBe('pin')
    expect(plan!.entry).toEqual(pin)
  })

  it('does not drive round the river: road as close as it gets, then the straight line, flagged', () => {
    const { plan } = planRoute({ start, end: { pin: null, centroid: at(0, 0), boundary: square }, snap: river, trails: none, trailKmh: 25 })
    expect(plan!.method).toBe('road+straight')
    expect(plan!.roadKm).toBeCloseTo(4, 3)
    // 800 m from the near road to the field, × 1.3.
    expect(Math.abs(plan!.connectorKm - 1.04)).toBeLessThan(0.01)
    expect(Math.abs(plan!.km - 5.04)).toBeLessThan(0.01)
    expect(plan!.note).toMatch(/no trail drawn/)
  })

  it('follows the road as close as it goes rather than cutting across country early', () => {
    // West of the field a road 300 m from the start, but 1.5 km of open
    // ground from the field; south, the road runs on to 800 m from it.
    const snap = (p: LatLng): Snap => {
      const west = xy(p).x < -500
      const s = west ? at(-1700, 0) : at(0, -1000)
      return { ...p, snapLat: s.lat, snapLng: s.lng, snapM: 500, roadKm: west ? 0.3 : 1.9, roadMin: 5 }
    }
    const { plan } = planRoute({ start, end: { pin: null, centroid: at(0, 0), boundary: square }, snap, trails: none, trailKmh: 25 })
    expect(plan!.method).toBe('road+straight')
    expect(plan!.roadKm).toBeCloseTo(1.9, 3)
  })

  it('finishes along a trail when one is drawn, from the cheapest trailhead', () => {
    const trails = buildTrailGraph([{ id: 't', name: 'Down to the flats', coords: [c(0, -1000), c(0, -600), c(0, -220)] }])
    const { plan } = planRoute({ start, end: { pin: null, centroid: at(0, 0), boundary: square }, snap: river, trails, trailKmh: 25 })
    expect(plan!.method).toBe('road+trail')
    expect(plan!.roadKm).toBeCloseTo(4, 3)
    expect(plan!.trailKm + plan!.connectorKm).toBeCloseTo(0.8, 2)
    expect(plan!.km).toBeCloseTo(4.8, 2)
    // Trail time at 25 km/h on top of the road's 8 minutes.
    expect(plan!.minutes).toBeCloseTo(8 + (0.8 / 25) * 60, 0)
    // The drawn path runs from the road to the entry.
    expect(xy({ lng: plan!.path[0][0], lat: plan!.path[0][1] }).y).toBeLessThan(-890)
    expect(xy({ lng: plan!.path.at(-1)![0], lat: plan!.path.at(-1)![1] }).y).toBeCloseTo(-200, 0)
  })

  it('ignores a trail that stops well short of the field', () => {
    const trails = buildTrailGraph([{ id: 't', name: 'Half way', coords: [c(0, -1000), c(0, -700)] }])
    const { plan } = planRoute({ start, end: { pin: null, centroid: at(0, 0), boundary: square }, snap: river, trails, trailKmh: 25 })
    expect(plan!.method).toBe('road+straight')
  })

  it('measures to the middle, and says so, when the field has no boundary', () => {
    const { plan } = planRoute({ start, end: { pin: null, centroid: at(0, -220), boundary: null }, snap: straightRoad(-250), trails: none, trailKmh: 25 })
    expect(plan!.entryBasis).toBe('centroid')
    expect(plan!.note).toMatch(/no boundary/)
  })

  it('asks the router only for what it needs, a step at a time', () => {
    const cache = new Map<string, Snap>()
    const snap = (p: LatLng) => cache.get(ptKey(p))
    const end = { pin: null, centroid: at(0, 0), boundary: square }
    const first = planRoute({ start, end, snap, trails: none, trailKmh: 25 })
    expect(first.plan).toBeNull()
    expect(first.need).toHaveLength(1)
    for (const p of first.need) cache.set(ptKey(p), river(p))
    // The field's own road is the far bank: now it wants the rings round it.
    const second = planRoute({ start, end, snap, trails: none, trailKmh: 25 })
    expect(second.need).toHaveLength(48)
    for (const p of second.need) cache.set(ptKey(p), river(p))
    expect(planRoute({ start, end, snap, trails: none, trailKmh: 25 }).plan!.method).toBe('road+straight')
  })

  it('takes an elevator trip in the same way the field is reached', () => {
    const { plan } = planRoute({ start, end: { pin: null, centroid: at(0, 0), boundary: square }, snap: river, trails: none, trailKmh: 25 })
    const leg = planFrom(plan!, { ...plan!.approach, snapLat: null, snapLng: null, snapM: 0, roadKm: 40, roadMin: 30 }, 25)!
    expect(leg.km).toBeCloseTo(40 + plan!.connectorKm, 3)
    expect(leg.method).toBe('road+straight')
    expect(planFrom(plan!, undefined, 25)).toBeNull()
  })
})

describe('a field set to take the trails', () => {
  // The road reaches the field (y = -250), but a trail runs straight from the
  // start up to the field's south edge.
  const fromStart = buildTrailGraph([{ id: 't', name: 'Back road', coords: [c(0, -5000), c(0, -210)] }])
  const end = { pin: null, centroid: at(0, 0), boundary: square }

  it('still takes the road when left to choose and the road comes to the field', () => {
    expect(planRoute({ start, end, snap: straightRoad(-215), trails: fromStart, trailKmh: 25 }).plan!.method).toBe('road')
  })

  it('takes the trail from the start when told to', () => {
    const { plan } = planRoute({ start, end, snap: straightRoad(-250), trails: fromStart, trailKmh: 25, preferTrails: true })
    expect(plan!.method).toBe('road+trail')
    expect(plan!.roadKm).toBe(0)
    // Along the trail to within a short walk of the field: about 4.8 km in all, none of it road.
    expect(plan!.trailKm).toBeGreaterThan(4.4)
    expect(plan!.km).toBeCloseTo(4.8, 1)
    expect(plan!.approach).toEqual(start)
  })

  it('falls back to the road when no trail reaches the field', () => {
    const elsewhere = buildTrailGraph([{ id: 't', name: 'Somewhere else', coords: [c(3000, -5000), c(3000, -3000)] }])
    expect(planRoute({ start, end, snap: straightRoad(-250), trails: elsewhere, trailKmh: 25, preferTrails: true }).plan!.method).toBe('road')
  })
})

describe('snapping an edited trail point', () => {
  const other: Coord[] = [c(0, 0), c(0, 1000)]
  it('lands on another trail within 25 m', () => {
    const s = snapCoord(c(15, 500), [other], [])
    expect(xy({ lat: s[1], lng: s[0] }).x).toBeCloseTo(0, 3)
    expect(xy({ lat: s[1], lng: s[0] }).y).toBeCloseTo(500, 0)
  })
  it('prefers a place or a trail point that is nearer', () => {
    expect(snapCoord(c(5, 1003), [other], [c(5, 1010)])).toEqual(c(0, 1000))
  })
  it('stays put when nothing is near', () => {
    expect(snapCoord(c(60, 500), [other], [])).toEqual(c(60, 500))
  })
})

describe('a trail drawn to the gate', () => {
  // The road passes 100 m south of the field's south edge; the entry pin is on
  // that edge and a trail runs from the road straight up to it.
  const pin = at(0, -200)
  const toGate = buildTrailGraph([{ id: 't', name: '#8', coords: [c(150, -300), c(0, -200)] }])
  const end = { pin, centroid: at(0, 0), boundary: square }

  it('is taken over a road that stops short of the entry', () => {
    const { plan } = planRoute({ start, end, snap: straightRoad(-300), trails: toGate, trailKmh: 25 })
    expect(plan!.method).toBe('road+trail')
    expect(plan!.trailKm).toBeGreaterThan(0.1)
  })

  it('is not needed when the road comes right to the entry', () => {
    const { plan } = planRoute({ start, end: { ...end, pin: at(0, -290) }, snap: straightRoad(-300), trails: toGate, trailKmh: 25 })
    expect(plan!.method).toBe('road')
  })
})

describe('via points', () => {
  const vias = [at(-3000, -5000), at(-3000, 0)]
  const snapOf = (km: number) => (p: LatLng): Snap => ({ ...p, snapLat: p.lat, snapLng: p.lng, snapM: 0, roadKm: km, roadMin: km * 1.2 })
  it('adds up the road legs through the points', () => {
    const legs = viaLegs(vias, (i) => snapOf(i === 0 ? 3 : 5))!
    expect(legs.need).toEqual([])
    expect(legs.km).toBe(8)
    const plan = withLegs(planRoute({ start: vias[1], end: { pin: null, centroid: at(0, 0), boundary: square }, snap: straightRoad(-250), trails: none, trailKmh: 25 }).plan!, legs)
    expect(plan.km).toBeGreaterThan(8)
    expect(plan.roadKm - plan.km + plan.connectorKm + plan.trailKm).toBeCloseTo(0, 3)
  })
  it('says which legs still need asking', () => {
    const legs = viaLegs(vias, (i) => (i === 0 ? snapOf(3) : () => undefined))!
    expect(legs.need).toEqual([{ from: 1, at: roundPt(vias[1]) }])
  })
  it('gives up when the road cannot do a leg', () => {
    expect(viaLegs(vias, () => (p: LatLng): Snap => ({ ...p, snapLat: null, snapLng: null, snapM: null, roadKm: null, roadMin: null }))).toBeNull()
  })
})
