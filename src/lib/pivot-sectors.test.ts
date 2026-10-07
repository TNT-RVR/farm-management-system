import { describe, expect, it } from 'vitest'
import type { Polygon } from 'geojson'
import { NDVI_RAMP } from './pastures'
import {
  binsFromAppliedGeom,
  binsToWedges,
  clearFraction,
  destination,
  hexToRgb,
  localPolar,
  ndviByWedge,
  needScore,
  outsideMask,
  pivotArc,
  pointInGeometry,
  rampIndex,
  rampValue,
  relativeTo,
  sumDailyBins,
  wedgeIndexOf,
  wedgeMean,
  wedgeRing,
  wedgesForArc,
  type LngLat,
  type Raster,
} from './pivot-sectors'

// #10 Jen's pivot centre, near enough.
const C: LngLat = [-108.7965, 52.417]

describe('pivotArc', () => {
  it('reads 0/0 (and equal angles) as a full circle', () => {
    expect(pivotArc(0, 0)).toEqual({ start: 0, span: 360 })
    expect(pivotArc(120, 120)).toEqual({ start: 0, span: 360 })
    expect(pivotArc(null, 40)).toEqual({ start: 0, span: 360 })
  })

  it('sweeps clockwise from start to end', () => {
    expect(pivotArc(86, 255)).toEqual({ start: 86, span: 169 })
    // Across north: 300 → 60 is 120°, not 240°.
    expect(pivotArc(300, 60)).toEqual({ start: 300, span: 120 })
  })
})

describe('wedgesForArc', () => {
  it('cuts a full circle into 36 wedges of 10° from north', () => {
    const w = wedgesForArc({ start: 0, span: 360 })
    expect(w).toHaveLength(36)
    expect(w[0]).toEqual({ index: 0, a0: 0, a1: 10 })
    expect(w[35].a0).toBe(350)
    expect(w[35].a1).toBe(360)
  })

  it('cuts a partial arc into equal wedges near 10°, with no sliver', () => {
    const w = wedgesForArc(pivotArc(86, 255))
    expect(w).toHaveLength(17)
    for (const x of w) expect(x.a1 - x.a0).toBeCloseTo(169 / 17, 9)
    expect(w[0].a0).toBe(86)
    expect(w[16].a1).toBeCloseTo(255, 9)
  })

  it('keeps a wedge that crosses north continuous (a1 past 360)', () => {
    const w = wedgesForArc(pivotArc(355, 15))
    expect(w).toHaveLength(2)
    expect(w[0]).toEqual({ index: 0, a0: 355, a1: 365 })
    expect(w[1]).toEqual({ index: 1, a0: 5, a1: 15 })
  })
})

describe('wedgeIndexOf', () => {
  it('finds the wedge on a full circle', () => {
    const arc = pivotArc(0, 0)
    expect(wedgeIndexOf(0, arc, 36)).toBe(0)
    expect(wedgeIndexOf(9.99, arc, 36)).toBe(0)
    expect(wedgeIndexOf(10, arc, 36)).toBe(1)
    expect(wedgeIndexOf(359.9, arc, 36)).toBe(35)
  })

  it('returns -1 outside a partial arc', () => {
    const arc = pivotArc(86, 255)
    expect(wedgeIndexOf(80, arc, 17)).toBe(-1)
    expect(wedgeIndexOf(256, arc, 17)).toBe(-1)
    expect(wedgeIndexOf(86, arc, 17)).toBe(0)
    expect(wedgeIndexOf(254.9, arc, 17)).toBe(16)
  })
})

describe('destination and localPolar', () => {
  it('agree on bearing and distance within a pivot', () => {
    for (const [b, d] of [
      [0, 400],
      [37, 400],
      [90, 250],
      [200, 480],
      [315, 120],
    ]) {
      const p = destination(C, b, d)
      const back = localPolar(C, p)
      expect(back.bearing).toBeCloseTo(b, 1)
      expect(Math.abs(back.dist - d)).toBeLessThan(1)
    }
  })
})

describe('wedgeRing', () => {
  it('starts and ends at the centre and reaches the radius', () => {
    const ring = wedgeRing(C, 400, 0, 10)
    expect(ring[0]).toEqual(C)
    expect(ring[ring.length - 1]).toEqual(C)
    const edge = localPolar(C, ring[1])
    expect(edge.bearing).toBeCloseTo(0, 1)
    expect(edge.dist).toBeCloseTo(400, 0)
    const last = localPolar(C, ring[ring.length - 2])
    expect(last.bearing).toBeCloseTo(10, 1)
  })
})

describe('sumDailyBins and binsToWedges', () => {
  it('adds days element-wise, missing bins as zero', () => {
    const a = new Array(360).fill(1)
    const b = new Array(360).fill(null)
    b[5] = 4
    const s = sumDailyBins([a, b, null])
    expect(s[5]).toBe(5)
    expect(s[6]).toBe(1)
    expect(s).toHaveLength(360)
  })

  it('averages the 1° bins under each 10° wedge', () => {
    const bins = Array.from({ length: 360 }, (_, i) => (i < 10 ? 20 : i < 20 ? 10 : 0))
    const w = binsToWedges(bins, wedgesForArc({ start: 0, span: 360 }))
    expect(w[0]).toBe(20)
    expect(w[1]).toBe(10)
    expect(w[2]).toBe(0)
  })

  it('weights fractional degrees on a partial arc and ignores bins outside it', () => {
    // 86 → 255: bins outside the arc are 1000 and must never appear.
    const bins = Array.from({ length: 360 }, (_, i) => (i >= 86 && i < 255 ? 12 : 1000))
    const wedges = wedgesForArc(pivotArc(86, 255))
    for (const v of binsToWedges(bins, wedges)) expect(v).toBeCloseTo(12, 9)
    // A wedge from 5.5 to 6.5 takes half of bin 5 and half of bin 6.
    const half = binsToWedges(
      Array.from({ length: 360 }, (_, i) => (i === 5 ? 10 : i === 6 ? 20 : 0)),
      [{ index: 0, a0: 5.5, a1: 6.5 }],
    )
    expect(half[0]).toBeCloseTo(15, 9)
  })

  it('wraps across north', () => {
    const bins = new Array(360).fill(0)
    bins[358] = 6
    bins[359] = 6
    bins[0] = 6
    bins[1] = 6
    const [w] = binsToWedges(bins, [{ index: 0, a0: 358, a1: 362 }])
    expect(w).toBe(6)
  })

  it('weights the field mean by wedge width', () => {
    const wedges = [
      { index: 0, a0: 0, a1: 30 },
      { index: 1, a0: 30, a1: 40 },
    ]
    expect(wedgeMean([10, 50], wedges)).toBe(20)
    expect(wedgeMean([null, 50], wedges)).toBe(50)
  })
})

describe('needScore', () => {
  it('is dryness alone without NDVI', () => {
    // 20% under the mean is fully dry.
    expect(needScore(-0.2, null)).toEqual({ score: 1, dryness: 1, weakness: null, vigourIgnored: false })
    expect(needScore(0.1, null)!.score).toBeCloseTo(-0.5, 9)
  })

  it('blends dryness and weakness 60/40', () => {
    // 10% dry (0.5) and 5% under the NDVI median (0.5).
    expect(needScore(-0.1, -0.05)!.score).toBeCloseTo(0.5, 9)
    // Clamped at both ends.
    expect(needScore(-1, -1)!.score).toBeCloseTo(1, 9)
    expect(needScore(1, 1)!.score).toBeCloseTo(-1, 9)
  })

  it('does not blame water for a weak crop that got extra water', () => {
    const s = needScore(0.1, -0.1)!
    expect(s.vigourIgnored).toBe(true)
    expect(s.score).toBeCloseTo(0.6 * -0.5, 9)
  })

  it('needs applied water to say anything', () => {
    expect(needScore(null, -0.2)).toBeNull()
    expect(relativeTo(5, 0)).toBeNull()
    expect(relativeTo(12, 10)).toBeCloseTo(0.2, 9)
  })
})

describe('geometry', () => {
  const square: Polygon = {
    type: 'Polygon',
    coordinates: [
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
        [0, 0],
      ],
      [
        [4, 4],
        [6, 4],
        [6, 6],
        [4, 6],
        [4, 4],
      ],
    ],
  }

  it('respects holes', () => {
    expect(pointInGeometry([1, 1], square)).toBe(true)
    expect(pointInGeometry([5, 5], square)).toBe(false)
    expect(pointInGeometry([11, 5], square)).toBe(false)
  })

  it('winds the mask holes against the outer ring', () => {
    const m = outsideMask(square, { west: -5, south: -5, east: 15, north: 15 })
    expect(m.coordinates).toHaveLength(2)
    const signed = (r: number[][]) => r.reduce((a, p, i) => a + (r[i === 0 ? r.length - 1 : i - 1][0] - p[0]) * (r[i === 0 ? r.length - 1 : i - 1][1] + p[1]), 0)
    expect(Math.sign(signed(m.coordinates[0]))).toBe(-Math.sign(signed(m.coordinates[1])))
    // Either winding of the field goes in the opposite way.
    const flipped: Polygon = { type: 'Polygon', coordinates: [[...square.coordinates[0]].reverse()] }
    const m2 = outsideMask(flipped, { west: -5, south: -5, east: 15, north: 15 })
    expect(Math.sign(signed(m2.coordinates[0]))).toBe(-Math.sign(signed(m2.coordinates[1])))
  })
})

describe('binsFromAppliedGeom', () => {
  it('reads each degree off the wedge polygon it falls in, whatever the ring order', () => {
    // Two FieldNET-style wedges whose rings do NOT start at the centre.
    const east = wedgeRing(C, 480, 80, 100)
    const south = wedgeRing(C, 480, 170, 190)
    const fc = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: { depth: 83 }, geometry: { type: 'Polygon', coordinates: [[...east.slice(3, -1), ...east.slice(0, 3), east[3]]] } },
        { type: 'Feature', properties: { depth: '150' }, geometry: { type: 'MultiPolygon', coordinates: [[south]] } },
      ],
    }
    const bins = binsFromAppliedGeom(fc, C, 480)!
    expect(bins[85]).toBe(83)
    expect(bins[99]).toBe(83)
    expect(bins[175]).toBe(150)
    expect(bins[0]).toBe(0)
    expect(bins[120]).toBe(0)
  })

  it('is null with nothing to read', () => {
    expect(binsFromAppliedGeom(null, C, 400)).toBeNull()
    expect(binsFromAppliedGeom({ features: [] }, C, 400)).toBeNull()
  })
})

describe('NDVI ramp inversion', () => {
  const ramp = NDVI_RAMP.map(([, hex]) => hexToRgb(hex))

  it('matches the colours the evalscript paints', () => {
    // sat-imagery.ts COLOURS, as 0-255.
    expect(ramp).toEqual([
      [161, 98, 7],
      [202, 138, 4],
      [163, 166, 53],
      [132, 204, 22],
      [77, 159, 14],
      [21, 128, 61],
      [20, 83, 45],
    ])
  })

  it('finds each step exactly and tolerates a nudged channel', () => {
    ramp.forEach(([r, g, b], i) => expect(rampIndex(r, g, b, ramp)).toBe(i))
    expect(rampIndex(79, 157, 16, ramp)).toBe(4)
    // Pure blue is no ramp colour at all.
    expect(rampIndex(0, 0, 255, ramp)).toBe(-1)
  })

  it('maps a step back to the NDVI the evalscript centred it on', () => {
    // shade(): step = round((ndvi - lo) / (hi - lo) * 6)
    const lo = 0.1662
    const hi = 0.552
    for (const ndvi of [0.2, 0.3, 0.41, 0.5]) {
      const step = Math.round(((ndvi - lo) / (hi - lo)) * 6)
      const back = rampValue(step, 7, lo, hi)
      expect(Math.abs(back - ndvi)).toBeLessThanOrEqual((hi - lo) / 12 + 1e-9)
    }
    expect(rampValue(0, 7, lo, hi)).toBe(lo)
    expect(rampValue(6, 7, lo, hi)).toBeCloseTo(hi, 12)
  })

  it('averages pixels into their wedges and skips cloud', () => {
    // A 40 × 40 raster centred on the pivot, ~10 m pixels. East half one ramp
    // step, west half another, top-left quarter clouded (alpha 0).
    const size = 40
    const halfLat = (200 / 6_371_000) * (180 / Math.PI)
    const halfLng = halfLat / Math.cos((C[1] * Math.PI) / 180)
    const box = { west: C[0] - halfLng, east: C[0] + halfLng, south: C[1] - halfLat, north: C[1] + halfLat }
    const data = new Uint8ClampedArray(size * size * 4)
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const o = (y * size + x) * 4
        const [r, g, b] = x >= size / 2 ? ramp[5] : ramp[2]
        data.set([r, g, b, x < size / 2 && y < size / 2 ? 0 : 255], o)
      }
    const raster: Raster = { width: size, height: size, data }
    const arc = pivotArc(0, 0)
    const wedges = wedgesForArc(arc)
    const res = ndviByWedge(raster, box, C, 190, arc, wedges.length, ramp, 0.2, 0.8)
    // Wedge 2 (20-30°, north-east) is all step 5; wedge 20 (200-210°, south-west) is all step 2.
    expect(res.means[2]).toBeCloseTo(rampValue(5, 7, 0.2, 0.8), 9)
    expect(res.means[20]).toBeCloseTo(rampValue(2, 7, 0.2, 0.8), 9)
    // North-west (300-310°) is under cloud.
    expect(res.means[30]).toBeNull()
    expect(res.pixels[30]).toBe(0)

    const field: Polygon = {
      type: 'Polygon',
      coordinates: [[[box.west, box.south], [box.east, box.south], [box.east, box.north], [box.west, box.north], [box.west, box.south]]],
    }
    expect(clearFraction(raster, box, field)).toBeCloseTo(0.75, 9)
  })
})
