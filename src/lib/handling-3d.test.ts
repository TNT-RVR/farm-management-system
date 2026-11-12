import { describe, expect, it } from 'vitest'
import {
  axisOf,
  buildScene,
  fitScene,
  northOnScreen,
  pieceFaces,
  project3d,
  shadeFor,
  tint,
  type Camera,
  type Piece,
} from './handling-3d'

const PLAN: Camera = { azimuth: 0, elevation: 90 }
const EYE: Camera = { azimuth: 0, elevation: 0 }
const CORNER: Camera = { azimuth: 25, elevation: 30 }

const panel = (over: Partial<Piece> = {}): Piece => ({
  id: 'p1',
  centre: { x: 0, y: 0 },
  rotation: 0,
  widthFt: 10,
  depthFt: 5.5,
  heightFt: 5.5,
  color: '#64748b',
  look: 'bars',
  ...over,
})

describe('project3d', () => {
  it('looks straight down at ninety degrees, with north up', () => {
    // North up is the whole reason the northing is negated: screen y grows
    // downward, so without it a plan view comes out upside down.
    const north = project3d(PLAN, { x: 0, y: 100, z: 0 })
    expect(north.x).toBeCloseTo(0, 9)
    expect(north.y).toBeCloseTo(-100, 9)
  })

  it('loses nothing but height when looking straight down', () => {
    const low = project3d(PLAN, { x: 10, y: 10, z: 0 })
    const high = project3d(PLAN, { x: 10, y: 10, z: 20 })
    expect(high.y).toBeCloseTo(low.y, 9)
  })

  it('shows only height from ground level', () => {
    const p = project3d(EYE, { x: 0, y: 500, z: 6 })
    expect(p.y).toBeCloseTo(-6, 9)
  })

  it('puts taller things higher up the screen', () => {
    const low = project3d(CORNER, { x: 0, y: 0, z: 0 })
    const high = project3d(CORNER, { x: 0, y: 0, z: 10 })
    expect(high.y).toBeLessThan(low.y)
  })

  it('puts east to the right at the default bearing', () => {
    expect(project3d(PLAN, { x: 50, y: 0, z: 0 }).x).toBeGreaterThan(0)
  })

  it('reports farther ground as deeper, so the painter can sort by it', () => {
    const near = project3d(CORNER, { x: 0, y: -100, z: 0 })
    const far = project3d(CORNER, { x: 0, y: 100, z: 0 })
    expect(far.depth).toBeGreaterThan(near.depth)
  })

  it('swings the yard round as the viewer walks about it', () => {
    const from = project3d({ azimuth: 0, elevation: 30 }, { x: 100, y: 0, z: 0 })
    const to = project3d({ azimuth: 180, elevation: 30 }, { x: 100, y: 0, z: 0 })
    expect(to.x).toBeCloseTo(-from.x, 9)
  })
})

describe('axisOf', () => {
  it('runs a panel east at no rotation', () => {
    const a = axisOf(0)
    expect(a.x).toBeCloseTo(1, 9)
    expect(a.y).toBeCloseTo(0, 9)
  })

  it('runs it south at a quarter turn, matching the plan view', () => {
    const a = axisOf(90)
    expect(a.x).toBeCloseTo(0, 9)
    expect(a.y).toBeCloseTo(-1, 9)
  })

  it('is always a unit step', () => {
    for (const deg of [0, 17, 90, 200, 355]) {
      const a = axisOf(deg)
      expect(Math.hypot(a.x, a.y)).toBeCloseTo(1, 9)
    }
  })
})

describe('tint', () => {
  it('leaves a colour alone at one', () => {
    expect(tint('#64748b', 1)).toBe('#64748b')
  })

  it('darkens and lightens', () => {
    expect(tint('#808080', 0.5)).toBe('#404040')
    expect(tint('#404040', 2)).toBe('#808080')
  })

  it('will not run past black or white', () => {
    expect(tint('#ffffff', 2)).toBe('#ffffff')
    expect(tint('#000000', 0.5)).toBe('#000000')
  })

  it('reads the short form', () => {
    expect(tint('#fff', 1)).toBe('#ffffff')
  })

  it('hands back anything it cannot read', () => {
    expect(tint('rebeccapurple', 0.5)).toBe('rebeccapurple')
  })
})

describe('shadeFor', () => {
  it('lights a lid brightest', () => {
    expect(shadeFor(0, 'top')).toBeGreaterThan(shadeFor(0, 'ground'))
  })

  it('lights a wall facing the sun more than one facing away', () => {
    // Not a lot more: a wall edge-on to the light is the dark one, and the
    // two opposite walls read the same, which is what flat shading gives.
    const facing = shadeFor(215, 'wall')
    const edgeOn = shadeFor(215 + 90, 'wall')
    expect(facing).toBeGreaterThan(edgeOn)
  })

  it('never goes black or blows out', () => {
    for (let b = 0; b < 360; b += 15) {
      const k = shadeFor(b, 'wall')
      expect(k).toBeGreaterThan(0.5)
      expect(k).toBeLessThan(1.1)
    }
  })
})

describe('pieceFaces', () => {
  it('stands a panel up to its own height', () => {
    const faces = pieceFaces(CORNER, panel())
    const wall = faces.find((f) => f.kind === 'wall')!
    const flat = pieceFaces(CORNER, panel({ heightFt: 0 })).find((f) => f.kind === 'wall')!
    const span = (f: typeof wall) => Math.max(...f.pts.map((p) => p.y)) - Math.min(...f.pts.map((p) => p.y))
    expect(span(wall)).toBeGreaterThan(span(flat))
  })

  it('draws a bar panel see-through and a wind fence solid', () => {
    const bars = pieceFaces(CORNER, panel({ look: 'bars' })).find((f) => f.kind === 'wall')!
    const wind = pieceFaces(CORNER, panel({ look: 'wind' })).find((f) => f.kind === 'wall')!
    expect(bars.opacity).toBeLessThan(0.5)
    expect(wind.opacity).toBeGreaterThan(0.9)
  })

  it('gives a bar panel its rails and posts, and a wind fence neither', () => {
    expect(pieceFaces(CORNER, panel({ look: 'bars' })).filter((f) => f.kind === 'line')).not.toHaveLength(0)
    expect(pieceFaces(CORNER, panel({ look: 'wind' })).filter((f) => f.kind === 'line')).toHaveLength(0)
  })

  it('dashes a gate, so it reads as something that opens', () => {
    expect(pieceFaces(CORNER, panel({ look: 'gate' })).find((f) => f.kind === 'wall')?.dash).toBeTruthy()
  })

  it('boxes a trough with four walls and a lid', () => {
    const faces = pieceFaces(CORNER, panel({ look: 'box', widthFt: 8, depthFt: 2, heightFt: 2 }))
    expect(faces.filter((f) => f.kind === 'wall')).toHaveLength(4)
    expect(faces.filter((f) => f.kind === 'top')).toHaveLength(1)
  })

  it('rounds a tank off instead of boxing it', () => {
    const faces = pieceFaces(CORNER, panel({ look: 'round', widthFt: 6, depthFt: 6, heightFt: 2 }))
    expect(faces.filter((f) => f.kind === 'wall').length).toBeGreaterThan(8)
  })

  it('keeps a lid in front of the box it belongs to, whichever way it is turned', () => {
    // Otherwise a trough seen from the far side has its own floor drawn over
    // its lid and reads as a hole in the ground.
    for (const azimuth of [0, 90, 180, 270]) {
      const faces = pieceFaces({ azimuth, elevation: 30 }, panel({ look: 'box', depthFt: 3, heightFt: 2 }))
      const top = faces.find((f) => f.kind === 'top')!
      const walls = faces.filter((f) => f.kind === 'wall')
      expect(top.depth).toBeLessThan(Math.min(...walls.map((w) => w.depth)))
    }
  })
})

describe('buildScene', () => {
  const pens = [
    {
      id: 'pen1',
      pts: [
        { x: -50, y: -50 },
        { x: 50, y: -50 },
        { x: 50, y: 50 },
        { x: -50, y: 50 },
      ],
      color: '#22c55e',
      label: 'Holding',
      closed: true,
    },
  ]

  it('draws far things before near ones', () => {
    const scene = buildScene({
      cam: CORNER,
      pieces: [panel({ id: 'near', centre: { x: 0, y: -100 } }), panel({ id: 'far', centre: { x: 0, y: 100 } })],
      pens: [],
    })
    const depths = scene.faces.map((f) => f.depth)
    expect(depths).toEqual([...depths].sort((a, b) => b - a))
  })

  it('does not drag a far trough in front of a near panel', () => {
    // The lid of a box has to be pulled in front of its OWN box, and no
    // further. A flat offset big enough for any box is big enough to put the
    // lid of a trough at the back of the yard over a panel at the front.
    const scene = buildScene({
      cam: { azimuth: 0, elevation: 30 },
      pieces: [
        panel({ id: 'near', centre: { x: 0, y: -150 } }),
        panel({ id: 'far', centre: { x: 0, y: 150 }, look: 'box', widthFt: 8, depthFt: 2, heightFt: 2 }),
      ],
      pens: [],
    })
    const order = scene.faces.map((f) => f.depth)
    const farLid = scene.faces.findIndex((f) => f.kind === 'top')
    const nearWall = scene.faces.findIndex((f, i) => f.kind === 'wall' && order[i] < 0)
    expect(farLid).toBeLessThan(nearWall)
  })

  it('keeps the ground under everything standing on it', () => {
    const scene = buildScene({
      cam: CORNER,
      pieces: [panel()],
      pens,
      ground: { x1: -100, y1: -100, x2: 100, y2: 100, gridFt: 50 },
    })
    const kit = scene.faces.filter((f) => f.kind === 'wall' || f.kind === 'top')
    const under = scene.faces.filter((f) => f.kind === 'ground')
    expect(Math.min(...under.map((f) => f.depth))).toBeGreaterThan(Math.max(...kit.map((f) => f.depth)))
  })

  it('names the pens it drew', () => {
    const scene = buildScene({ cam: CORNER, pieces: [], pens })
    expect(scene.labels.map((l) => l.text)).toEqual(['Holding'])
  })

  it('leaves an open fence line unnamed and dashed', () => {
    const open = [{ ...pens[0], closed: false, id: 'line' }]
    const scene = buildScene({ cam: CORNER, pieces: [], pens: open })
    expect(scene.labels).toHaveLength(0)
    expect(scene.faces[0].dash).toBeTruthy()
  })

  it('skips a pen with nothing to draw', () => {
    expect(buildScene({ cam: CORNER, pieces: [], pens: [{ ...pens[0], pts: [] }] }).faces).toHaveLength(0)
  })

  it('draws a grid over the ground sheet', () => {
    const bare = buildScene({ cam: CORNER, pieces: [], pens: [] })
    const grassed = buildScene({
      cam: CORNER,
      pieces: [],
      pens: [],
      ground: { x1: 0, y1: 0, x2: 200, y2: 200, gridFt: 50 },
    })
    expect(bare.faces).toHaveLength(0)
    expect(grassed.faces.length).toBeGreaterThan(5)
  })
})

describe('fitScene', () => {
  const scene = (cam: Camera) =>
    buildScene({
      cam,
      pieces: [panel({ widthFt: 200 })],
      pens: [],
    }).faces

  it('centres whatever it is given', () => {
    const fit = fitScene(scene(CORNER), { w: 800, h: 600 })
    const pts = scene(CORNER).flatMap((f) => f.pts)
    const midX = (Math.min(...pts.map((p) => p.x)) + Math.max(...pts.map((p) => p.x))) / 2
    expect(fit.ox + midX * fit.scale).toBeCloseTo(400, 6)
  })

  it('fits a long run inside the pane whichever way it lies', () => {
    // Fitted from the projected scene rather than the ground, because the
    // shape of a yard on screen changes as it turns: an alley seen end-on is
    // a few feet wide and seen across is two hundred.
    for (const azimuth of [0, 45, 90, 135]) {
      const faces = scene({ azimuth, elevation: 30 })
      const fit = fitScene(faces, { w: 800, h: 600 })
      const xs = faces.flatMap((f) => f.pts).map((p) => fit.ox + p.x * fit.scale)
      expect(Math.min(...xs)).toBeGreaterThanOrEqual(-0.001)
      expect(Math.max(...xs)).toBeLessThanOrEqual(800.001)
    }
  })

  it('falls back to the middle with nothing to fit', () => {
    expect(fitScene([], { w: 400, h: 200 })).toEqual({ scale: 1, ox: 200, oy: 100 })
  })
})

describe('northOnScreen', () => {
  it('points up in a plan view', () => {
    const n = northOnScreen(PLAN)
    expect(n.x).toBeCloseTo(0, 9)
    expect(n.y).toBeCloseTo(-1, 9)
  })

  it('points down once the viewer has walked round the back', () => {
    expect(northOnScreen({ azimuth: 180, elevation: 90 }).y).toBeCloseTo(1, 9)
  })

  it('is always a unit needle', () => {
    for (const azimuth of [0, 37, 90, 211, 300]) {
      const n = northOnScreen({ azimuth, elevation: 35 })
      expect(Math.hypot(n.x, n.y)).toBeCloseTo(1, 9)
    }
  })
})

describe('the models', () => {
  /**
   * Straight down, the projection drops z entirely, so what is left is the
   * ground the model covers. That has to be the footprint the catalog row
   * states and no more: the footprint is what every clearance check and every
   * pen area is read off, and a model that overhangs it would quietly make
   * the alley narrower than the arithmetic says.
   */
  const footprint = (p: Piece) => {
    const pts = pieceFaces(PLAN, p).flatMap((f) => f.pts)
    return {
      alongHalf: Math.max(...pts.map((q) => Math.abs(q.x))),
      acrossHalf: Math.max(...pts.map((q) => Math.abs(q.y))),
    }
  }

  const cow = (over: Partial<Piece> = {}): Piece =>
    panel({ look: 'animal', beast: 'cow', widthFt: 7, depthFt: 2.5, heightFt: 4.6, ...over })
  const rig = (): Piece => panel({ look: 'machine', widthFt: 29, depthFt: 9.33, heightFt: 9.5 })

  it('keeps a cow inside the footprint her row claims', () => {
    const f = footprint(cow())
    expect(f.alongHalf).toBeLessThanOrEqual(7 / 2 + 1e-9)
    expect(f.acrossHalf).toBeLessThanOrEqual(2.5 / 2 + 1e-9)
  })

  it('keeps the tractor and chopper inside theirs', () => {
    const f = footprint(rig())
    expect(f.alongHalf).toBeLessThanOrEqual(29 / 2 + 1e-9)
    expect(f.acrossHalf).toBeLessThanOrEqual(9.33 / 2 + 1e-9)
  })

  it('builds a beast out of more than a box', () => {
    // Four legs and a tail are lines; the barrel, neck and head are solid.
    const faces = pieceFaces(CORNER, cow())
    expect(faces.filter((f) => f.kind === 'line')).toHaveLength(5)
    expect(faces.filter((f) => f.kind === 'top').length).toBeGreaterThanOrEqual(3)
  })

  it('gives a bull a crest a cow does not have', () => {
    const asCow = pieceFaces(CORNER, cow()).length
    const asBull = pieceFaces(CORNER, cow({ beast: 'bull' })).length
    expect(asBull).toBeGreaterThan(asCow)
  })

  it('stands the beast on the ground and no higher than the withers', () => {
    // Straight on from the side, screen y is just height: -z.
    const pts = pieceFaces(EYE, cow()).flatMap((f) => f.pts)
    expect(Math.max(...pts.map((p) => p.y))).toBeCloseTo(0, 9)
    expect(Math.min(...pts.map((p) => p.y))).toBeCloseTo(-4.6, 9)
  })

  it('puts six wheels under the rig', () => {
    // A disc is drawn as one closed face of fourteen points; nothing else in
    // the model has that many.
    const wheels = pieceFaces(CORNER, rig()).filter((f) => f.pts.length === 14)
    expect(wheels).toHaveLength(6)
  })

  it('stands the cab higher than the chopper tub', () => {
    const pts = (p: Piece) => pieceFaces(EYE, p).flatMap((f) => f.pts)
    expect(Math.min(...pts(rig()).map((p) => p.y))).toBeCloseTo(-9.5, 9)
  })
})
