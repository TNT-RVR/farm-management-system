import { describe, expect, it } from 'vitest'
import type { LineString, MultiPolygon } from 'geojson'
import { AOPA_SETBACK_M, checkSetback, distanceToFeature, setbackFor } from './aopa'

const LAT = 52.38
const M_PER_DEG_LAT = 111_132
const M_PER_DEG_LON = 111_320 * Math.cos((LAT * Math.PI) / 180)

/** A rectangle given in metres from an origin, so distances are readable. */
function box(x0: number, y0: number, w: number, h: number): MultiPolygon {
  const lon = (m: number) => -108.7 + m / M_PER_DEG_LON
  const lat = (m: number) => LAT + m / M_PER_DEG_LAT
  return {
    type: 'MultiPolygon',
    coordinates: [
      [
        [
          [lon(x0), lat(y0)],
          [lon(x0 + w), lat(y0)],
          [lon(x0 + w), lat(y0 + h)],
          [lon(x0), lat(y0 + h)],
          [lon(x0), lat(y0)],
        ],
      ],
    ],
  }
}

const line = (pts: [number, number][]): LineString => ({
  type: 'LineString',
  coordinates: pts.map(([x, y]) => [-108.7 + x / M_PER_DEG_LON, LAT + y / M_PER_DEG_LAT]),
})

describe('the distances themselves', () => {
  it('is 30 m surface and 10 m injected', () => {
    // Straight out of AOPA. If these ever change, they change here and the
    // screen follows.
    expect(setbackFor('surface')).toBe(30)
    expect(setbackFor('injected')).toBe(10)
    expect(AOPA_SETBACK_M.surface).toBe(30)
  })
})

describe('distanceToFeature', () => {
  it('measures edge to edge, not centre to centre', () => {
    // A 200 m spread whose east edge stops 50 m short of a creek. Measured from
    // the centre it would read 150 m and pass a setback it does not clear.
    const spread = box(0, 0, 200, 200)
    const creek = line([
      [250, -100],
      [250, 300],
    ])
    expect(distanceToFeature(spread, creek)).toBeCloseTo(50, 0)
  })

  it('does not confuse a degree of longitude with a degree of latitude', () => {
    // The same gap east and north must measure the same. Working in degrees
    // with one constant makes the east-west figure a third too large, which at
    // a 30 m setback is the difference between compliant and not.
    const spread = box(0, 0, 100, 100)
    const east = distanceToFeature(spread, line([[160, -50], [160, 150]]))
    const north = distanceToFeature(
      spread,
      line([
        [-50, 160],
        [150, 160],
      ]),
    )
    expect(east).toBeCloseTo(60, 0)
    expect(north).toBeCloseTo(60, 0)
  })

  it('is zero when the spread crosses the water', () => {
    const spread = box(0, 0, 200, 200)
    expect(distanceToFeature(spread, line([[100, -50], [100, 250]]))).toBe(0)
  })

  it('is zero when the spread sits entirely inside a water body', () => {
    // A shape wholly within another crosses no edge, so an edge test alone
    // would report the distance to the nearest bank and call it clear.
    const spread = box(100, 100, 20, 20)
    const lake = box(0, 0, 500, 500)
    expect(distanceToFeature(spread, lake)).toBe(0)
  })

  it('is zero when a water body sits entirely inside the spread', () => {
    // The case that actually happens: a slough in the middle of a field.
    const spread = box(0, 0, 500, 500)
    const slough = box(200, 200, 40, 40)
    expect(distanceToFeature(spread, slough)).toBe(0)
  })

  it('measures a corner, not just the nearest edges', () => {
    // Diagonally offset by 30 m each way: the true gap is the corner-to-corner
    // 42 m, and a shape that only compared parallel edges would say 30.
    const spread = box(0, 0, 100, 100)
    const other = box(130, 130, 100, 100)
    expect(distanceToFeature(spread, other)).toBeCloseTo(Math.hypot(30, 30), 0)
  })

  it('gives infinity for an empty geometry rather than zero', () => {
    // Zero would read as "touching the water" and block a legitimate spread.
    expect(distanceToFeature(box(0, 0, 10, 10), { type: 'LineString', coordinates: [] } as LineString)).toBe(
      Number.POSITIVE_INFINITY,
    )
  })
})

describe('checkSetback', () => {
  const creekAt = (x: number) => ({
    name: 'Unnamed creek',
    kind: 'stream',
    geometry: line([
      [x, -200],
      [x, 400],
    ]),
  })

  it('flags a spread inside the setback', () => {
    const r = checkSetback(box(0, 0, 100, 100), [creekAt(120)])
    expect(r.breach).toBe(true)
    expect(r.distanceM).toBeCloseTo(20, 0)
    expect(r.requiredM).toBe(30)
    expect(r.nearest?.name).toBe('Unnamed creek')
  })

  it('passes a spread outside it', () => {
    const r = checkSetback(box(0, 0, 100, 100), [creekAt(140)])
    expect(r.breach).toBe(false)
    expect(r.distanceM).toBeCloseTo(40, 0)
  })

  it('takes the nearest of several features', () => {
    const r = checkSetback(box(0, 0, 100, 100), [creekAt(500), creekAt(115), creekAt(300)])
    expect(r.distanceM).toBeCloseTo(15, 0)
    expect(r.breach).toBe(true)
  })

  it('lets an injected spread closer, as the regulation does', () => {
    const spread = box(0, 0, 100, 100)
    expect(checkSetback(spread, [creekAt(115)], 'surface').breach).toBe(true)
    expect(checkSetback(spread, [creekAt(115)], 'injected').breach).toBe(false)
  })

  it('says nothing rather than "clear" when no water is on file', () => {
    // The distinction that matters: an app reporting compliance it has not
    // established is worse than one saying it did not check. A null distance
    // is what the screen keys "not checked" off.
    const r = checkSetback(box(0, 0, 100, 100), [])
    expect(r.distanceM).toBeNull()
    expect(r.breach).toBe(false)
    expect(r.nearest).toBeNull()
  })
})
