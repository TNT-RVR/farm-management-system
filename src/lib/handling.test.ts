import type { Position } from 'geojson'
import { describe, expect, it } from 'vitest'
import {
  areaFt2,
  distributeHerd,
  framedBounds,
  headIn,
  inventoryStatus,
  labelSpin,
  layoutBounds,
  nearestPoint,
  offsetFt,
  partsList,
  penCapacity,
  penFit,
  pxPerFoot,
  snapAngle,
} from './handling'

const YARD: Position = [-113.5024, 52.4106]

/** A square of a given side, in feet, with its corner at the yard. */
const square = (sideFt: number): Position[] => {
  const ne = offsetFt(offsetFt(YARD, sideFt, 90), sideFt, 0)
  return [YARD, offsetFt(YARD, sideFt, 90), ne, offsetFt(YARD, sideFt, 0)]
}

describe('areaFt2', () => {
  it('measures a hundred-foot square as ten thousand square feet', () => {
    // Within a quarter of a percent, and the gap is accounted for: the square
    // is built by walking feet on a sphere of the mean earth radius and
    // measured by lib/geo on the equatorial one, and area goes as the radius
    // squared. Twenty-two square feet in ten thousand, which is a hand's width
    // along one side of a hundred-foot pen.
    expect(areaFt2(square(100))).toBeCloseTo(10_000, -2)
    expect(areaFt2(square(100)) / 10_000).toBeCloseTo(1, 2)
  })

  it('grows with the square of the side', () => {
    // Radius conventions cancel here, so this is the shape of the arithmetic
    // rather than its calibration: double the side, four times the pen.
    expect(areaFt2(square(200)) / areaFt2(square(100))).toBeCloseTo(4, 3)
  })

  it('is nothing until there is a shape', () => {
    expect(areaFt2([])).toBe(0)
    expect(areaFt2([YARD, offsetFt(YARD, 50, 90)])).toBe(0)
  })
})

describe('pxPerFoot', () => {
  const WORLD = 512
  const mercator = (z: number) => (p: Position) => ({
    x: ((p[0] + 180) / 360) * WORLD * 2 ** z,
    y: 0,
  })
  const cosLat = Math.cos((YARD[1] * Math.PI) / 180)

  it('takes the scale from the projection it is handed', () => {
    const ppf = pxPerFoot(mercator(18), YARD)
    const metresPerPx = (40_075_016.686 * cosLat) / (WORLD * 2 ** 18)
    // Within a tenth of a percent, not to the last decimal, and the gap is a
    // known one rather than slack: the ground distance is measured on a sphere
    // of the mean earth radius (6,371,008 m, what haversine uses) while the
    // Mercator constant is built on the equatorial one (6,378,137 m). That is
    // 1.1 mm in a metre — an inch and a bit across a whole corral — and it is
    // the right way round, because a panel is 10 ft on the ground.
    expect(ppf / (0.3048 / metresPerPx)).toBeCloseTo(1, 2)
  })

  it('is twice what the 256 px constant in the spec would give', () => {
    // The reason this helper measures instead of computing: MapLibre counts
    // zoom in 512 px tiles and the spec's constant assumes 256, so the spec
    // formula drawn straight onto a MapLibre map halves every panel. This is
    // the factor of two, and it is a factor of two and not 1.998.
    const ppf = pxPerFoot(mercator(18), YARD)
    const spec256 = (156_543.033_92 * cosLat) / 2 ** 18
    expect(ppf / (0.3048 / spec256)).toBeCloseTo(2, 2)
  })

  it('doubles with each zoom level', () => {
    expect(pxPerFoot(mercator(19), YARD)).toBeCloseTo(pxPerFoot(mercator(18), YARD) * 2, 4)
  })

  it('says nothing rather than dividing by zero', () => {
    expect(pxPerFoot(() => ({ x: 0, y: 0 }), YARD)).toBe(0)
  })
})

describe('penCapacity', () => {
  it('holds fewer head the more room each one gets', () => {
    const area = 10_000
    expect(penCapacity(area, 'crowding')).toEqual({ low: 500, high: 714 })
    expect(penCapacity(area, 'working')).toEqual({ low: 250, high: 400 })
    expect(penCapacity(area, 'holding')).toEqual({ low: 100, high: 166 })
    expect(penCapacity(area, 'pasture')).toEqual({ low: 20, high: 33 })
  })

  it('never promises a part of a cow', () => {
    const cap = penCapacity(999, 'holding')
    expect(Number.isInteger(cap.low) && Number.isInteger(cap.high)).toBe(true)
  })
})

describe('penFit', () => {
  const cap = penCapacity(10_000, 'holding') // 100 roomy, 166 tight

  it('reads the three answers off the range', () => {
    expect(penFit(0, cap)).toBe('empty')
    expect(penFit(90, cap)).toBe('fits')
    expect(penFit(100, cap)).toBe('fits')
    expect(penFit(101, cap)).toBe('marginal')
    expect(penFit(166, cap)).toBe('marginal')
    expect(penFit(167, cap)).toBe('over')
  })
})

describe('distributeHerd', () => {
  const herd = [
    { class_name: 'Cows', head_count: 321 },
    { class_name: 'Bulls', head_count: 23 },
    { class_name: 'Calves', head_count: 320 },
  ]

  it('splits a class evenly across the pens it is ticked in', () => {
    const pens = [
      { id: 'north', assigned_classes: ['Cows'] },
      { id: 'south', assigned_classes: ['Cows'] },
    ]
    const { byPen } = distributeHerd(herd, pens)
    // The odd head goes somewhere rather than being lost.
    expect(byPen.north.Cows).toBe(161)
    expect(byPen.south.Cows).toBe(160)
    expect(byPen.north.Cows + byPen.south.Cows).toBe(321)
  })

  it('gives the remainder to the earliest pens', () => {
    const pens = ['a', 'b', 'c'].map((id) => ({ id, assigned_classes: ['Bulls'] }))
    const { byPen } = distributeHerd(herd, pens)
    expect([byPen.a.Bulls, byPen.b.Bulls, byPen.c.Bulls]).toEqual([8, 8, 7])
  })

  it('names a class with nowhere to go', () => {
    const { unplaced } = distributeHerd(herd, [{ id: 'north', assigned_classes: ['Cows'] }])
    expect(unplaced.map((u) => u.class_name)).toEqual(['Bulls', 'Calves'])
  })

  it('does not call an empty class unplaced', () => {
    // Nought yearlings ticked nowhere is not a problem to report.
    const { unplaced } = distributeHerd([{ class_name: 'Yearlings', head_count: 0 }], [])
    expect(unplaced).toEqual([])
  })

  it('adds up every class in a pen', () => {
    const pens = [{ id: 'north', assigned_classes: ['Cows', 'Bulls'] }]
    const { byPen } = distributeHerd(herd, pens)
    expect(headIn(byPen.north)).toBe(344)
    expect(headIn(undefined)).toBe(0)
  })
})

describe('partsList', () => {
  const catalog = [
    { id: 'p10', name: '10 ft bar panel', category: 'Panel', counted: true },
    { id: 'g12', name: '12 ft gate', category: 'Gate', counted: true },
    { id: 'cow', name: 'Cow', category: 'Animal', counted: false },
  ]

  it('counts the kit and ignores the livestock', () => {
    const items = [
      { catalog_id: 'p10' },
      { catalog_id: 'p10' },
      { catalog_id: 'g12' },
      { catalog_id: 'cow' },
      { catalog_id: 'cow' },
    ]
    const parts = partsList(items, catalog)
    expect(parts.map((p) => [p.item.name, p.count])).toEqual([
      ['12 ft gate', 1],
      ['10 ft bar panel', 2],
    ])
  })

  it('shrugs off an item whose catalog row is gone', () => {
    expect(partsList([{ catalog_id: 'vanished' }], catalog)).toEqual([])
  })
})

describe('inventoryStatus', () => {
  const panel = { id: 'p10', name: '10 ft bar panel', category: 'Panel', counted: true }
  const gate = { id: 'g12', name: '12 ft gate', category: 'Gate', counted: true }
  const trough = { id: 't8', name: '8 ft trough', category: 'Water', counted: true }
  const cow = { id: 'cow', name: 'Cow', category: 'Animal', counted: false }
  const catalog = [panel, gate, trough, cow]

  it('says how many more are needed, shortest first', () => {
    const rows = inventoryStatus(
      [
        { item: panel, count: 40 },
        { item: gate, count: 2 },
      ],
      { p10: 26, g12: 5 },
      catalog,
    )
    expect(rows[0].item.id).toBe('p10')
    expect(rows[0].short).toBe(14)
    expect(rows[0].spare).toBe(0)
    expect(rows[1].item.id).toBe('g12')
    expect(rows[1].short).toBe(0)
    expect(rows[1].spare).toBe(3)
  })

  it('needs nothing when the yard already has them', () => {
    const rows = inventoryStatus([{ item: panel, count: 10 }], { p10: 10 }, catalog)
    expect(rows[0]).toMatchObject({ needed: 10, owned: 10, short: 0, spare: 0 })
  })

  it('offers a row for kit this layout does not use', () => {
    // Otherwise there is nowhere to type what is behind the shop, and a new
    // yard has an Inventory tab you cannot put anything into.
    const rows = inventoryStatus([], {}, catalog)
    expect(rows.map((r) => r.item.id)).toEqual(['g12', 'p10', 't8'])
    expect(rows.every((r) => r.needed === 0 && r.owned === 0)).toBe(true)
  })

  it('leaves the livestock out of the parts you can own', () => {
    const rows = inventoryStatus([], { cow: 300 }, catalog)
    expect(rows.map((r) => r.item.id)).not.toContain('cow')
  })

  it('puts what is owned but unused above what is neither', () => {
    const rows = inventoryStatus([], { t8: 3 }, catalog)
    expect(rows[0].item.id).toBe('t8')
    expect(rows[0].spare).toBe(3)
  })
})

describe('nearestPoint', () => {
  const cursor = { x: 100, y: 100 }
  const pts = [
    { key: 'far', x: 200, y: 200 },
    { key: 'close', x: 106, y: 100 },
    { key: 'closer', x: 102, y: 101 },
  ]

  it('takes the nearest within reach', () => {
    expect(nearestPoint(cursor, pts)?.key).toBe('closer')
  })

  it('snaps to nothing when nothing is near', () => {
    expect(nearestPoint(cursor, [{ key: 'far', x: 200, y: 200 }])).toBeNull()
  })

  it('is measured in pixels, so the reach is the same at any zoom', () => {
    // Fourteen away snaps, fifteen does not, whatever the map is showing.
    expect(nearestPoint(cursor, [{ key: 'edge', x: 114, y: 100 }])?.key).toBe('edge')
    expect(nearestPoint(cursor, [{ key: 'past', x: 115, y: 100 }])).toBeNull()
  })
})

describe('labelSpin', () => {
  it('turns a label that would read upside down', () => {
    expect(labelSpin(0)).toBe(0)
    expect(labelSpin(90)).toBe(0)
    expect(labelSpin(91)).toBe(180)
    expect(labelSpin(180)).toBe(180)
    expect(labelSpin(269)).toBe(180)
    expect(labelSpin(270)).toBe(0)
    expect(labelSpin(359)).toBe(0)
  })

  it('handles the rotations a scroll wheel actually produces', () => {
    // The wheel keeps adding, so a panel can be sitting at 725° or -100°.
    expect(labelSpin(725)).toBe(0)
    // -100° is 260° the long way round, which points back up the page: flip it.
    expect(labelSpin(-100)).toBe(180)
    expect(labelSpin(-200)).toBe(180)
    expect(labelSpin(-20)).toBe(0)
  })
})

describe('layoutBounds', () => {
  it('boxes everything placed and everything drawn', () => {
    const bounds = layoutBounds(
      [{ lng: -113.5, lat: 52.41 }],
      [{ points: [[-113.51, 52.4], [-113.49, 52.42]] }],
    )
    expect(bounds).toEqual([
      [-113.51, 52.4],
      [-113.49, 52.42],
    ])
  })

  it('has nothing to frame on an empty layout', () => {
    expect(layoutBounds([], [])).toBeNull()
  })
})

describe('framedBounds', () => {
  const spanFt = (b: [[number, number], [number, number]]) =>
    (b[1][1] - b[0][1]) * 111_320 * 3.28084

  it('opens a single panel out to a corral-sized view', () => {
    // One item is a box with no width. Framed as-is the map goes to maximum
    // zoom and shows about two panels of ground.
    const one = layoutBounds([{ lng: -113.5, lat: 52.41 }], [])!
    expect(one[0]).toEqual(one[1])
    const framed = framedBounds(one)!
    expect(spanFt(framed)).toBeCloseTo(300, 0)
    // Still centred on the panel.
    expect((framed[0][0] + framed[1][0]) / 2).toBeCloseTo(-113.5, 9)
    expect((framed[0][1] + framed[1][1]) / 2).toBeCloseTo(52.41, 9)
  })

  it('leaves a yard that is already bigger alone', () => {
    const big: [[number, number], [number, number]] = [
      [-113.51, 52.4],
      [-113.49, 52.42],
    ]
    expect(framedBounds(big)).toEqual(big)
  })

  it('widens only the side that is too narrow', () => {
    // A single straight run of panels: long one way, nothing the other.
    const run: [[number, number], [number, number]] = [
      [-113.505, 52.41],
      [-113.495, 52.41],
    ]
    const framed = framedBounds(run)!
    expect(framed[0][0]).toBe(run[0][0])
    expect(framed[1][0]).toBe(run[1][0])
    expect(spanFt(framed)).toBeCloseTo(300, 0)
  })

  it('has nothing to open out when there is nothing placed', () => {
    expect(framedBounds(null)).toBeNull()
  })

  it('pads longitude by more degrees than latitude this far north', () => {
    // A degree of longitude is shorter at 50°N, so the same distance takes
    // more of them. Getting this backwards makes a square yard open oblong.
    const pt = layoutBounds([{ lng: -113.5, lat: 52.41 }], [])!
    const f = framedBounds(pt)!
    expect(f[1][0] - f[0][0]).toBeGreaterThan(f[1][1] - f[0][1])
  })
})

describe('offsetFt', () => {
  it('walks the distance it is given', () => {
    const p = offsetFt(YARD, 100, 90)
    // Due east: latitude unchanged, longitude up.
    expect(p[1]).toBeCloseTo(YARD[1], 6)
    expect(p[0]).toBeGreaterThan(YARD[0])
  })
})

describe('snapAngle', () => {
  it('snaps to five degrees, or one holding shift', () => {
    expect(snapAngle(43)).toBe(45)
    expect(snapAngle(43, true)).toBe(43)
    expect(snapAngle(42.4, true)).toBe(42)
  })

  it('comes back round rather than counting past 360', () => {
    expect(snapAngle(362)).toBe(0)
    expect(snapAngle(-5)).toBe(355)
  })
})
