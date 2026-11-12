import type { Position } from 'geojson'
import { describe, expect, it } from 'vitest'
import { haversineM } from './geo/measure'
import {
  NO_SELECTION,
  alignRotation,
  centroidPx,
  endSnap,
  fitScale,
  gateLeaves,
  inBox,
  isLinear,
  itemEnds,
  marqueeHits,
  mergeSelected,
  normBox,
  offsetFt,
  onlySelected,
  rotateAboutPx,
  scaleBar,
  selectionSize,
  selectionWords,
  toLocalFt,
  toggleSelected,
} from './handling'

/**
 * The arithmetic behind picking several things at once, joining runs of fence
 * end to end, and laying a yard out on something that is not a map. The
 * original handling.test.ts covers capacity, parts and the map scale.
 */

const YARD: Position = [-113.5024, 52.4106]

/* ── Joining runs of fence end to end ─────────────────────────────────────── */

describe('itemEnds', () => {
  it('runs a panel east and west at no rotation', () => {
    // The glyph draws along its own x, and screen x is east.
    const [a, b] = itemEnds(YARD, 10, 0)
    expect(a[0]).toBeGreaterThan(YARD[0])
    expect(b[0]).toBeLessThan(YARD[0])
    expect(a[1]).toBeCloseTo(YARD[1], 9)
  })

  it('runs it north and south at a quarter turn', () => {
    const [a, b] = itemEnds(YARD, 10, 90)
    expect(a[1]).toBeLessThan(YARD[1])
    expect(b[1]).toBeGreaterThan(YARD[1])
  })

  it('puts the ends a panel apart', () => {
    const [a, b] = itemEnds(YARD, 12, 37)
    expect(haversineM(a, b) / 0.3048).toBeCloseTo(12, 3)
  })
})

describe('isLinear', () => {
  it('is a run of fence for panels and gates, and not for what stands on the ground', () => {
    expect(isLinear({ panel_type: 'bars', gate_type: null })).toBe(true)
    expect(isLinear({ panel_type: 'wind-fence', gate_type: null })).toBe(true)
    expect(isLinear({ panel_type: null, gate_type: 'swinging' })).toBe(true)
    expect(isLinear({ panel_type: null, gate_type: null })).toBe(false)
  })
})

describe('endSnap', () => {
  const targets = [
    { x: 100, y: 100, key: 'a:0', rotation: 0 },
    { x: 300, y: 100, key: 'a:1', rotation: 0 },
  ]

  it('finds the end within reach and says how far to shift', () => {
    const hit = endSnap(
      [
        { x: 108, y: 103 },
        { x: 208, y: 103 },
      ],
      targets,
    )
    expect(hit?.target.key).toBe('a:0')
    expect(hit?.endIndex).toBe(0)
    expect(hit?.dx).toBe(-8)
    expect(hit?.dy).toBe(-3)
  })

  it('takes the nearest end when several are in reach', () => {
    const hit = endSnap([{ x: 299, y: 100 }], [{ x: 290, y: 100, key: 'near', rotation: 0 }, ...targets])
    expect(hit?.target.key).toBe('a:1')
  })

  it('leaves a panel alone when nothing is near it', () => {
    expect(endSnap([{ x: 500, y: 500 }], targets)).toBeNull()
  })

  it('snaps the trailing end when that is the one closest', () => {
    const hit = endSnap(
      [
        { x: 200, y: 400 },
        { x: 302, y: 104 },
      ],
      targets,
    )
    expect(hit?.endIndex).toBe(1)
    expect(hit?.target.key).toBe('a:1')
  })

  it('has nothing to snap to on an empty layout', () => {
    expect(endSnap([{ x: 0, y: 0 }], [])).toBeNull()
  })
})

describe('alignRotation', () => {
  it('straightens a panel that is a few degrees off', () => {
    expect(alignRotation(7, 0)).toBe(0)
    expect(alignRotation(353, 0)).toBe(0)
  })

  it('counts the other way round as in line too', () => {
    // A panel laid end to end against one at 90° is in line whether its own
    // rotation reads 90 or 270.
    expect(alignRotation(272, 90)).toBe(270)
  })

  it('leaves a deliberate angle alone', () => {
    // The mouth of a funnel: 40° off is a decision, not a wobble.
    expect(alignRotation(40, 0)).toBe(40)
  })

  it('comes back inside one turn', () => {
    expect(alignRotation(-5, 0)).toBe(0)
    expect(alignRotation(400, 95)).toBe(40)
  })
})

/* ── Picking several things ────────────────────────────────────────────────── */

describe('normBox and inBox', () => {
  it('reads a box dragged up and left the same as one dragged down and right', () => {
    expect(normBox({ x1: 90, y1: 80, x2: 10, y2: 20 })).toEqual({ x1: 10, y1: 20, x2: 90, y2: 80 })
  })

  it('counts the edge as inside', () => {
    const b = { x1: 0, y1: 0, x2: 10, y2: 10 }
    expect(inBox(b, { x: 0, y: 10 })).toBe(true)
    expect(inBox(b, { x: 11, y: 5 })).toBe(false)
  })
})

describe('marqueeHits', () => {
  const items = [
    { id: 'in', x: 50, y: 50 },
    { id: 'out', x: 500, y: 50 },
  ]
  const paths = [
    {
      id: 'whole',
      pts: [
        { x: 10, y: 10 },
        { x: 90, y: 90 },
      ],
    },
    {
      id: 'half',
      pts: [
        { x: 10, y: 10 },
        { x: 900, y: 90 },
      ],
    },
  ]

  it('catches a piece whose middle is in the box', () => {
    expect(marqueeHits({ x1: 0, y1: 0, x2: 100, y2: 100 }, items, paths).items).toEqual(['in'])
  })

  it('catches a pen only when the whole of it is in the box', () => {
    // Half a fence line is not something you can move, turn or delete.
    expect(marqueeHits({ x1: 0, y1: 0, x2: 100, y2: 100 }, items, paths).paths).toEqual(['whole'])
  })

  it('reads a box dragged backwards', () => {
    expect(marqueeHits({ x1: 100, y1: 100, x2: 0, y2: 0 }, items, paths).items).toEqual(['in'])
  })

  it('catches nothing with a cornerless pen', () => {
    expect(marqueeHits({ x1: 0, y1: 0, x2: 999, y2: 999 }, [], [{ id: 'bare', pts: [] }]).paths).toEqual([])
  })
})

describe('rotateAboutPx', () => {
  it('turns a quarter clockwise, the way the overlay reads it', () => {
    // Screen y grows downward, so a point to the east swings round to the south.
    const p = rotateAboutPx({ x: 10, y: 0 }, { x: 0, y: 0 }, 90)
    expect(p.x).toBeCloseTo(0, 9)
    expect(p.y).toBeCloseTo(10, 9)
  })

  it('leaves the centre where it is', () => {
    expect(rotateAboutPx({ x: 5, y: 5 }, { x: 5, y: 5 }, 137)).toEqual({ x: 5, y: 5 })
  })

  it('keeps every piece the same distance out', () => {
    const c = { x: 3, y: -4 }
    const p = { x: 20, y: 11 }
    const spun = rotateAboutPx(p, c, 61)
    expect(Math.hypot(spun.x - c.x, spun.y - c.y)).toBeCloseTo(Math.hypot(p.x - c.x, p.y - c.y), 9)
  })
})

describe('centroidPx', () => {
  it('is the middle of what is picked', () => {
    expect(
      centroidPx([
        { x: 0, y: 0 },
        { x: 10, y: 20 },
      ]),
    ).toEqual({ x: 5, y: 10 })
  })

  it('is nothing when nothing is picked', () => {
    expect(centroidPx([])).toBeNull()
  })
})

describe('the selection', () => {
  it('starts empty', () => {
    expect(selectionSize(NO_SELECTION)).toBe(0)
  })

  it('replaces everything on a plain click', () => {
    expect(onlySelected('item', 'b')).toEqual({ items: ['b'], paths: [] })
    expect(onlySelected('path', 'p')).toEqual({ items: [], paths: ['p'] })
  })

  it('adds and takes away on a shift-click', () => {
    const one = toggleSelected(NO_SELECTION, 'item', 'a')
    const two = toggleSelected(one, 'item', 'b')
    expect(two.items).toEqual(['a', 'b'])
    expect(toggleSelected(two, 'item', 'a').items).toEqual(['b'])
  })

  it('keeps pens and pieces apart even when they share an id', () => {
    const s = toggleSelected(toggleSelected(NO_SELECTION, 'item', 'x'), 'path', 'x')
    expect(s).toEqual({ items: ['x'], paths: ['x'] })
  })

  it('merges a box drag into what was already picked, without doubling anything', () => {
    expect(mergeSelected({ items: ['a'], paths: [] }, { items: ['a', 'b'], paths: ['p'] })).toEqual({
      items: ['a', 'b'],
      paths: ['p'],
    })
  })

  it('says what is picked in words', () => {
    expect(selectionWords({ items: ['a'], paths: [] })).toBe('1 piece')
    expect(selectionWords({ items: ['a', 'b'], paths: ['p'] })).toBe('2 pieces and 1 pen')
  })
})

/* ── Ground feet, for the 3D view and the printed plan ────────────────────── */

describe('toLocalFt', () => {
  it('is nothing at the origin', () => {
    expect(toLocalFt(YARD, YARD)).toEqual({ x: 0, y: 0 })
  })

  it('counts east and north positive, west and south negative', () => {
    expect(toLocalFt(YARD, offsetFt(YARD, 100, 90)).x).toBeGreaterThan(0)
    expect(toLocalFt(YARD, offsetFt(YARD, 100, 270)).x).toBeLessThan(0)
    expect(toLocalFt(YARD, offsetFt(YARD, 100, 0)).y).toBeGreaterThan(0)
    expect(toLocalFt(YARD, offsetFt(YARD, 100, 180)).y).toBeLessThan(0)
  })

  it('agrees with the measure tool about how far a hundred feet is', () => {
    // The whole reason it is measured with haversine rather than worked out
    // from a metres-per-degree series: a fence that reads 63 ft on the map has
    // to read 63 ft on the printed plan.
    expect(toLocalFt(YARD, offsetFt(YARD, 100, 90)).x).toBeCloseTo(100, 2)
  })

  it('keeps the distance between two points measured from the same origin', () => {
    const a = offsetFt(YARD, 200, 45)
    const b = offsetFt(YARD, 350, 200)
    const la = toLocalFt(YARD, a)
    const lb = toLocalFt(YARD, b)
    expect(Math.hypot(la.x - lb.x, la.y - lb.y)).toBeCloseTo(haversineM(a, b) / 0.3048, 0)
  })
})

describe('fitScale', () => {
  it('uses one scale for both axes, so a square pen stays square', () => {
    expect(fitScale({ w: 400, h: 100 }, { w: 1000, h: 1000 }, 0).scale).toBe(1000 / 400)
  })

  it('puts the middle of the sheet in the middle', () => {
    const fit = fitScale({ w: 100, h: 100 }, { w: 800, h: 600 })
    expect(fit.cx).toBe(400)
    expect(fit.cy).toBe(300)
  })

  it('will not magnify an empty yard without limit', () => {
    // A span of nothing is what one panel gives, and framing it is how the
    // map once came up at maximum zoom on a blank screen.
    expect(fitScale({ w: 0, h: 0 }, { w: 1000, h: 1000 }, 0).scale).toBe(100)
  })
})

describe('scaleBar', () => {
  it('picks a round number of feet somebody can lay a thumb against', () => {
    expect([5, 10, 20, 25, 50, 100, 200, 250, 500, 1000]).toContain(scaleBar(2).feet)
  })

  it('draws about as wide as it was asked to', () => {
    const bar = scaleBar(1.2, 120)
    expect(bar.px).toBeGreaterThanOrEqual(100)
    expect(bar.px).toBeLessThan(400)
  })

  it('says how wide the bar it chose actually is', () => {
    const bar = scaleBar(3)
    expect(bar.px).toBeCloseTo(bar.feet * 3, 9)
  })
})

describe('gateLeaves', () => {
  const shut = (deg = 0, two = false) => gateLeaves({ x: 0, y: 0 }, 10, 0, deg, two)

  it('leaves a shut gate exactly where its row says it is', () => {
    const [leaf] = shut()
    expect(leaf.centre.x).toBeCloseTo(0, 9)
    expect(leaf.centre.y).toBeCloseTo(0, 9)
    expect(leaf.rotation).toBe(0)
    expect(leaf.lengthFt).toBe(10)
  })

  it('swings the leaf about the hinge, which does not move', () => {
    // Rotation 0 lays the gate east-west, hinged at its west end. A quarter
    // turn clockwise seen from above swings the free end round to the south.
    const [leaf] = shut(90)
    expect(leaf.centre.x).toBeCloseTo(-5, 9)
    expect(leaf.centre.y).toBeCloseTo(-5, 9)
    // The hinge: back half a leaf from the middle, along the leaf.
    const hinge = { x: leaf.centre.x, y: leaf.centre.y + 5 }
    expect(hinge.x).toBeCloseTo(-5, 9)
    expect(hinge.y).toBeCloseTo(0, 9)
  })

  it('keeps the leaf the same length however far it is open', () => {
    for (const deg of [0, 30, 90, 150, -90]) {
      const [leaf] = shut(deg)
      expect(Math.hypot(leaf.centre.x + 5, leaf.centre.y)).toBeCloseTo(5, 9)
    }
  })

  it('splits a two-panel gate into halves that meet in the middle', () => {
    const [a, b] = shut(0, true)
    expect(a.lengthFt).toBe(5)
    expect(b.lengthFt).toBe(5)
    expect(a.centre.x).toBeCloseTo(-2.5, 9)
    expect(b.centre.x).toBeCloseTo(2.5, 9)
  })

  it('opens both leaves of a double gate to the SAME side', () => {
    // A barn door, not a revolving door: the two leaves turn in opposite
    // senses about their own hinges so that both ends come round together.
    const [a, b] = shut(90, true)
    expect(a.centre.y).toBeCloseTo(-2.5, 9)
    expect(b.centre.y).toBeCloseTo(-2.5, 9)
    expect(a.centre.x).toBeCloseTo(-5, 9)
    expect(b.centre.x).toBeCloseTo(5, 9)
  })
})
