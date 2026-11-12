/**
 * The yard stood up: the same layout, seen from a corner instead of straight
 * down.
 *
 * Why it is worth having at all, when the plan view is the one you build from:
 * a plan answers "will it fit" and says nothing about "will it work". Whether
 * a bull can see over the wind fence, whether the chopper clears the gate,
 * whether a man standing at the tub can see the alley — those are height
 * questions, and on a plan every piece of kit is the same flat line.
 *
 * Orthographic, and hand-rolled. Orthographic because a corral is a technical
 * drawing and a vanishing point makes the far end of an alley look narrower
 * than it is, which is exactly the lie this tool exists to not tell. Hand-
 * rolled because the whole renderer is the hundred lines below — a 3D library
 * would be most of a megabyte on a phone to draw forty quads.
 *
 * Everything here is pure arithmetic over feet. The component does the
 * dragging and the SVG.
 */

export type Camera = {
  /** Which way the viewer is looking, in degrees clockwise from north. 0 looks north. */
  azimuth: number
  /** How far above the ground, 0 (standing in the yard) to 90 (straight down). */
  elevation: number
}

export type Vec3 = { x: number; y: number; z: number }
export type Pt = { x: number; y: number }

/**
 * Ground feet to camera feet.
 *
 * x east, y north, z up. Screen y grows downward, hence the minus on the
 * northing: without it the plan view comes out with north at the bottom.
 */
export function project3d(cam: Camera, v: Vec3): { x: number; y: number; depth: number } {
  const a = (cam.azimuth * Math.PI) / 180
  const e = (cam.elevation * Math.PI) / 180
  const right = v.x * Math.cos(a) - v.y * Math.sin(a)
  const into = v.x * Math.sin(a) + v.y * Math.cos(a)
  return { x: right, y: -into * Math.sin(e) - v.z * Math.cos(e), depth: into }
}

export type FaceKind = 'ground' | 'wall' | 'top' | 'line'

export type Face = {
  pts: Pt[]
  fill: string | null
  stroke: string | null
  strokeWidth: number
  opacity: number
  dash?: string
  /** Farther from the viewer draws first. */
  depth: number
  kind: FaceKind
}

export type Label = { at: Pt; text: string; sub?: string; depth: number }
export type Scene = { faces: Face[]; labels: Label[] }

export type Piece = {
  id: string
  /** The middle of the piece, in feet east and north of the layout's own origin. */
  centre: Pt
  /** Degrees, the overlay's convention: the piece runs along the bearing rotation + 90. */
  rotation: number
  widthFt: number
  depthFt: number
  heightFt: number
  color: string
  look: 'bars' | 'wind' | 'gate' | 'box' | 'round' | 'animal' | 'machine'
  /** Which beast, where look is 'animal'. A bull is built differently. */
  beast?: 'cow' | 'bull' | 'calf' | null
}

export type Pen = { id: string; pts: Pt[]; color: string; label: string; closed: boolean }

/** Where the light comes from, as a bearing. South-west, late in the day. */
const SUN = 215

/* ── Colour ───────────────────────────────────────────────────────────────── */

const clamp255 = (n: number) => Math.max(0, Math.min(255, Math.round(n)))

/** A hex colour lightened (k > 1) or darkened (k < 1). */
export function tint(hex: string, k: number): string {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  if (full.length !== 6) return hex
  const r = clamp255(parseInt(full.slice(0, 2), 16) * k)
  const g = clamp255(parseInt(full.slice(2, 4), 16) * k)
  const b = clamp255(parseInt(full.slice(4, 6), 16) * k)
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

/**
 * How lit a surface is, from the way it faces.
 *
 * Flat shading from one fixed light, which is all it takes: without it every
 * face of a trough is the same colour and a box reads as a blob.
 */
export function shadeFor(normalBearing: number, kind: FaceKind): number {
  if (kind === 'top') return 1.12
  if (kind === 'ground') return 1
  const d = ((normalBearing - SUN) * Math.PI) / 180
  return 0.6 + 0.45 * Math.abs(Math.cos(d))
}

/* ── Pieces ───────────────────────────────────────────────────────────────── */

const rad = (d: number) => (d * Math.PI) / 180

/** A piece's long axis as a unit step in ground feet. */
export function axisOf(rotation: number): Pt {
  const b = rad(rotation + 90)
  return { x: Math.sin(b), y: Math.cos(b) }
}

const quad = (cam: Camera, corners: Vec3[]): { pts: Pt[]; depth: number } => {
  const p = corners.map((c) => project3d(cam, c))
  return { pts: p.map((q) => ({ x: q.x, y: q.y })), depth: Math.max(...p.map((q) => q.depth)) }
}

/** The upright face of a run of fence, and its rails. */
function fenceFaces(cam: Camera, piece: Piece): Face[] {
  const axis = axisOf(piece.rotation)
  const half = piece.widthFt / 2
  const a = { x: piece.centre.x + axis.x * half, y: piece.centre.y + axis.y * half }
  const b = { x: piece.centre.x - axis.x * half, y: piece.centre.y - axis.y * half }
  const h = piece.heightFt
  const normal = piece.rotation + 90 + 90
  const k = shadeFor(normal, 'wall')
  const solid = piece.look === 'wind'
  const wall = quad(cam, [
    { x: a.x, y: a.y, z: 0 },
    { x: b.x, y: b.y, z: 0 },
    { x: b.x, y: b.y, z: h },
    { x: a.x, y: a.y, z: h },
  ])
  const faces: Face[] = [
    {
      ...wall,
      fill: tint(piece.color, k),
      stroke: tint(piece.color, k * 0.75),
      strokeWidth: 1,
      // A wind fence is a solid sheet; a bar panel you can see the yard through.
      opacity: solid ? 0.95 : 0.22,
      dash: piece.look === 'gate' ? '5 3' : undefined,
      kind: 'wall',
    },
  ]
  // The rails, so a bar panel reads as bars rather than as glass.
  if (piece.look === 'bars' || piece.look === 'gate') {
    for (const f of [0.18, 0.42, 0.66, 0.9, 1]) {
      const z = h * f
      const line = quad(cam, [
        { x: a.x, y: a.y, z },
        { x: b.x, y: b.y, z },
      ])
      faces.push({
        ...line,
        fill: null,
        stroke: tint(piece.color, k),
        strokeWidth: f === 1 ? 1.8 : 1.2,
        opacity: 1,
        dash: piece.look === 'gate' ? '5 3' : undefined,
        kind: 'line',
      })
    }
    // The posts at each end.
    for (const end of [a, b]) {
      const post = quad(cam, [
        { x: end.x, y: end.y, z: 0 },
        { x: end.x, y: end.y, z: h },
      ])
      faces.push({ ...post, fill: null, stroke: tint(piece.color, 0.7), strokeWidth: 2.2, opacity: 1, kind: 'line' })
    }
  }
  return faces
}

/** A thing standing on the ground: trough, bunk, tub, beast, tractor. */
function blockFaces(cam: Camera, piece: Piece): Face[] {
  const axis = axisOf(piece.rotation)
  const side = { x: -axis.y, y: axis.x }
  const hw = piece.widthFt / 2
  const hd = Math.max(piece.depthFt, 0.5) / 2
  const h = Math.max(piece.heightFt, 0.5)
  const corner = (sw: number, sd: number): Pt => ({
    x: piece.centre.x + axis.x * hw * sw + side.x * hd * sd,
    y: piece.centre.y + axis.y * hw * sw + side.y * hd * sd,
  })
  const round = piece.look === 'round'
  // Troughs, bunks and tubs only: a beast and a machine have models of their own.
  const opacity = 0.9

  const ring: Pt[] = round
    ? Array.from({ length: 12 }, (_, i) => {
        const t = rad((i * 360) / 12)
        return {
          x: piece.centre.x + axis.x * hw * Math.cos(t) + side.x * hd * Math.sin(t),
          y: piece.centre.y + axis.y * hw * Math.cos(t) + side.y * hd * Math.sin(t),
        }
      })
    : [corner(1, -1), corner(1, 1), corner(-1, 1), corner(-1, -1)]

  const faces: Face[] = []
  ring.forEach((p, i) => {
    const q = ring[(i + 1) % ring.length]
    const normal = (Math.atan2(q.x - p.x, q.y - p.y) * 180) / Math.PI + 90
    const k = shadeFor(normal, 'wall')
    faces.push({
      ...quad(cam, [
        { x: p.x, y: p.y, z: 0 },
        { x: q.x, y: q.y, z: 0 },
        { x: q.x, y: q.y, z: h },
        { x: p.x, y: p.y, z: h },
      ]),
      fill: tint(piece.color, k),
      stroke: tint(piece.color, k * 0.7),
      strokeWidth: 0.8,
      opacity,
      kind: 'wall',
    })
  })
  const top = quad(cam, ring.map((p) => ({ x: p.x, y: p.y, z: h })))
  faces.push({
    ...top,
    // The lid draws after the walls whatever the angle: it is the one face
    // always in front of the box it belongs to, and a far trough seen over
    // its own back wall otherwise reads as a hole in the ground.
    //
    // Pulled forward by this box's own size and no further. A flat offset
    // large enough for any box is large enough to drag the lid of a trough at
    // the back of the yard in front of a panel at the front of it.
    depth: top.depth - (piece.widthFt + Math.max(piece.depthFt, 0.5)),
    fill: tint(piece.color, shadeFor(0, 'top')),
    stroke: tint(piece.color, 0.7),
    strokeWidth: 0.8,
    opacity,
    kind: 'top',
  })
  return faces
}

/* ── Models ───────────────────────────────────────────────────────────────── */

/**
 * A piece's own frame, so a model can be written in the shape of the thing
 * rather than in compass bearings: `f` runs forward to the nose or the front
 * wheels, `s` to its right, `u` up from the ground, all in feet.
 */
type Frame = { o: Pt; ax: Pt; sd: Pt; bearing: number }
type Local = { f: number; s: number }
type Skin = { color: string; opacity: number; dash?: string }

function frameOf(piece: Piece): Frame {
  const ax = axisOf(piece.rotation)
  return { o: piece.centre, ax, sd: { x: -ax.y, y: ax.x }, bearing: piece.rotation + 90 }
}

const at = (fr: Frame, f: number, s: number, u: number): Vec3 => ({
  x: fr.o.x + fr.ax.x * f + fr.sd.x * s,
  y: fr.o.y + fr.ax.y * f + fr.sd.y * s,
  z: u,
})

const seg = (cam: Camera, a: Vec3, b: Vec3, stroke: string, strokeWidth: number): Face => ({
  ...quad(cam, [a, b]),
  fill: null,
  stroke,
  strokeWidth,
  opacity: 1,
  kind: 'line',
})

/** An upright thing with a given plan outline: the walls, and the lid on top. */
function prismFaces(cam: Camera, fr: Frame, plan: Local[], u0: number, u1: number, skin: Skin): Face[] {
  const faces: Face[] = []
  plan.forEach((c, i) => {
    const n = plan[(i + 1) % plan.length]
    const p = at(fr, c.f, c.s, 0)
    const q = at(fr, n.f, n.s, 0)
    const normal = (Math.atan2(q.x - p.x, q.y - p.y) * 180) / Math.PI + 90
    const k = shadeFor(normal, 'wall')
    faces.push({
      ...quad(cam, [at(fr, c.f, c.s, u0), at(fr, n.f, n.s, u0), at(fr, n.f, n.s, u1), at(fr, c.f, c.s, u1)]),
      fill: tint(skin.color, k),
      stroke: tint(skin.color, k * 0.7),
      strokeWidth: 0.8,
      opacity: skin.opacity,
      dash: skin.dash,
      kind: 'wall',
    })
  })
  const lid = quad(cam, plan.map((c) => at(fr, c.f, c.s, u1)))
  const fs = plan.map((c) => c.f)
  const ss = plan.map((c) => c.s)
  faces.push({
    ...lid,
    // Same rule as a trough's lid: it is always in front of the thing it caps,
    // and pulled forward by that thing's own size and no further.
    depth: lid.depth - (Math.max(...fs) - Math.min(...fs) + (Math.max(...ss) - Math.min(...ss))),
    fill: tint(skin.color, shadeFor(0, 'top')),
    stroke: tint(skin.color, 0.7),
    strokeWidth: 0.8,
    opacity: skin.opacity,
    dash: skin.dash,
    kind: 'top',
  })
  return faces
}

const boxFaces = (
  cam: Camera,
  fr: Frame,
  b: { f0: number; f1: number; s0: number; s1: number; u0: number; u1: number },
  skin: Skin,
): Face[] =>
  prismFaces(
    cam,
    fr,
    [
      { f: b.f1, s: b.s0 },
      { f: b.f1, s: b.s1 },
      { f: b.f0, s: b.s1 },
      { f: b.f0, s: b.s0 },
    ],
    b.u0,
    b.u1,
    skin,
  )

/** A wheel: a disc standing in the plane the machine drives along. */
function wheelFace(cam: Camera, fr: Frame, f: number, s: number, r: number, color: string): Face {
  const ring = Array.from({ length: 14 }, (_, i) => {
    const t = rad((i * 360) / 14)
    return at(fr, f + r * Math.cos(t), s, r + r * Math.sin(t))
  })
  return {
    ...quad(cam, ring),
    fill: tint(color, 0.45),
    stroke: tint(color, 0.3),
    strokeWidth: 0.8,
    opacity: 0.95,
    kind: 'wall',
  }
}

/**
 * A beast, standing: barrel on four legs, neck and head at the front, tail at
 * the back.
 *
 * Every number is a fraction of the catalog row's own length, width and
 * withers height, so correcting a measurement restretches the animal instead
 * of breaking it. The proportions are a beef cow's: the barrel is most of the
 * length, the legs are about half the height, the head is carried a little
 * below the withers.
 */
function animalFaces(cam: Camera, piece: Piece): Face[] {
  const fr = frameOf(piece)
  const L = Math.max(piece.widthFt, 1)
  const W = Math.max(piece.depthFt, 0.5)
  const H = Math.max(piece.heightFt, 1)
  // A beef cow's belly hangs at about four tenths of her withers height, which
  // leaves the barrel deeper than the legs are long. Get this the other way
  // round and she reads as a table, which is what the first cut of this did.
  const belly = H * 0.46
  const skin: Skin = { color: piece.color, opacity: 0.95 }
  const dark = tint(piece.color, 0.55)
  const faces: Face[] = []

  // Legs, as lines: at a corral's scale a beast is a barrel and four sticks,
  // and drawing the legs as solid posts only makes the table worse.
  for (const f of [0.28, -0.3])
    for (const s of [0.32, -0.32])
      faces.push(seg(cam, at(fr, L * f, W * s, 0), at(fr, L * f, W * s, belly + H * 0.04), dark, 3))

  // The barrel: nine-sided in plan, narrowing to the shoulders at the front
  // and rounded off at the pin bones, so it is a body and not a crate.
  faces.push(
    ...prismFaces(
      cam,
      fr,
      [
        { f: 0.3, s: 0 },
        { f: 0.22, s: 0.4 },
        { f: 0.02, s: 0.5 },
        { f: -0.3, s: 0.48 },
        { f: -0.45, s: 0.22 },
        { f: -0.45, s: -0.22 },
        { f: -0.3, s: -0.48 },
        { f: 0.02, s: -0.5 },
        { f: 0.22, s: -0.4 },
      ].map((c) => ({ f: c.f * L, s: c.s * W })),
      belly,
      H,
      skin,
    ),
  )

  // A bull carries a crest over his shoulders that a cow does not, and at a
  // corral's scale it is the only thing that tells the two apart at a glance.
  if (piece.beast === 'bull')
    faces.push(
      ...boxFaces(cam, fr, { f0: 0, f1: 0.24 * L, s0: -0.3 * W, s1: 0.3 * W, u0: H * 0.96, u1: H * 1.12 }, skin),
    )

  // Neck, tapering from the shoulders to the head, then the head itself,
  // carried below the withers the way a standing beast carries it.
  faces.push(
    ...prismFaces(
      cam,
      fr,
      [
        { f: 0.1 * L, s: 0.3 * W },
        { f: 0.35 * L, s: 0.18 * W },
        { f: 0.35 * L, s: -0.18 * W },
        { f: 0.1 * L, s: -0.3 * W },
      ],
      0.6 * H,
      0.98 * H,
      skin,
    ),
  )
  faces.push(
    ...boxFaces(cam, fr, { f0: 0.32 * L, f1: 0.5 * L, s0: -0.16 * W, s1: 0.16 * W, u0: 0.58 * H, u1: 0.86 * H }, skin),
  )
  // Ears. Two chips of nothing, and without them the head is a nose cone.
  for (const s of [0.16, -0.28])
    faces.push(
      ...boxFaces(cam, fr, { f0: 0.34 * L, f1: 0.41 * L, s0: s * W, s1: (s + 0.12) * W, u0: 0.78 * H, u1: 0.86 * H }, skin),
    )
  faces.push(seg(cam, at(fr, -0.44 * L, 0, 0.95 * H), at(fr, -0.5 * L, 0, 0.3 * H), dark, 2))
  return faces
}

/**
 * The tractor and the chopper behind it, as one machine.
 *
 * Split half and half down its length, which is what a 14 ft 5 in tractor and
 * a 14 ft 6 in Bale Pro come to. The forks are drawn stowed up over the tub,
 * because the footprint this is drawn inside is the transport one — forks
 * down, the machine is another four feet longer, and that is a number the plan
 * view shows rather than this one.
 */
function machineFaces(cam: Camera, piece: Piece): Face[] {
  const fr = frameOf(piece)
  const L = Math.max(piece.widthFt, 4)
  const W = Math.max(piece.depthFt, 2)
  const H = Math.max(piece.heightFt, 3)
  const skin: Skin = { color: piece.color, opacity: 0.85 }
  const glass: Skin = { color: tint(piece.color, 1.45), opacity: 0.6 }
  const faces: Face[] = []

  // Wheels first: they sit under the body, and drawing them before it keeps
  // the sort honest wherever the body hides half of one.
  for (const [f, s, r] of [
    [0.1, 0.4, 0.3],
    [0.1, -0.4, 0.3],
    [0.4, 0.36, 0.2],
    [0.4, -0.36, 0.2],
    [-0.28, 0.42, 0.17],
    [-0.28, -0.42, 0.17],
  ])
    faces.push(wheelFace(cam, fr, f * L, s * W, r * H, piece.color))

  // Tractor: chassis, hood, cab.
  faces.push(
    ...boxFaces(cam, fr, { f0: 0.06 * L, f1: 0.34 * L, s0: -0.26 * W, s1: 0.26 * W, u0: 0.26 * H, u1: 0.5 * H }, skin),
  )
  faces.push(
    ...boxFaces(cam, fr, { f0: 0.32 * L, f1: 0.48 * L, s0: -0.2 * W, s1: 0.2 * W, u0: 0.28 * H, u1: 0.58 * H }, skin),
  )
  faces.push(
    ...boxFaces(cam, fr, { f0: 0.08 * L, f1: 0.3 * L, s0: -0.28 * W, s1: 0.28 * W, u0: 0.5 * H, u1: H }, glass),
  )
  // The stack, so the front end reads as a tractor and not a van.
  faces.push(seg(cam, at(fr, 0.44 * L, 0.14 * W, 0.58 * H), at(fr, 0.44 * L, 0.14 * W, 0.88 * H), tint(piece.color, 0.5), 2.2))
  // The drawbar between the two.
  faces.push(seg(cam, at(fr, 0.03 * L, 0, 0.24 * H), at(fr, -0.05 * L, 0, 0.24 * H), tint(piece.color, 0.5), 2))

  // Chopper: the tub, the side discharge it throws out of, and the rear
  // loading forks, stowed.
  faces.push(
    ...boxFaces(cam, fr, { f0: -0.46 * L, f1: -0.04 * L, s0: -0.46 * W, s1: 0.46 * W, u0: 0.18 * H, u1: 0.7 * H }, skin),
  )
  faces.push(
    ...boxFaces(cam, fr, { f0: -0.3 * L, f1: -0.12 * L, s0: 0.4 * W, s1: 0.5 * W, u0: 0.44 * H, u1: 0.68 * H }, skin),
  )
  for (const s of [0.26, -0.26])
    faces.push(seg(cam, at(fr, -0.44 * L, s * W, 0.7 * H), at(fr, -0.2 * L, s * W, 0.95 * H), tint(piece.color, 0.5), 2.2))
  return faces
}

export function pieceFaces(cam: Camera, piece: Piece): Face[] {
  if (piece.look === 'bars' || piece.look === 'wind' || piece.look === 'gate') return fenceFaces(cam, piece)
  if (piece.look === 'animal') return animalFaces(cam, piece)
  if (piece.look === 'machine') return machineFaces(cam, piece)
  return blockFaces(cam, piece)
}

/* ── The whole scene ──────────────────────────────────────────────────────── */

export type SceneInput = {
  cam: Camera
  pieces: Piece[]
  pens: Pen[]
  /** The ground sheet and its grid, in feet; left out, no ground is drawn. */
  ground?: { x1: number; y1: number; x2: number; y2: number; gridFt: number }
}

/**
 * Everything to draw, far to near.
 *
 * A painter's sort rather than a depth buffer: with a few hundred flat quads
 * and no interpenetrating shapes it gives the same picture, and it is a sort.
 */
export function buildScene({ cam, pieces, pens, ground }: SceneInput): Scene {
  const faces: Face[] = []
  const labels: Label[] = []

  if (ground) {
    const sheet = quad(cam, [
      { x: ground.x1, y: ground.y1, z: 0 },
      { x: ground.x2, y: ground.y1, z: 0 },
      { x: ground.x2, y: ground.y2, z: 0 },
      { x: ground.x1, y: ground.y2, z: 0 },
    ])
    faces.push({ ...sheet, depth: 1e9, fill: '#cbd5c0', stroke: null, strokeWidth: 0, opacity: 1, kind: 'ground' })
    const step = Math.max(ground.gridFt, 5)
    for (let x = Math.ceil(ground.x1 / step) * step; x <= ground.x2; x += step) {
      const line = quad(cam, [
        { x, y: ground.y1, z: 0 },
        { x, y: ground.y2, z: 0 },
      ])
      faces.push({ ...line, depth: 1e9 - 1, fill: null, stroke: '#aab79b', strokeWidth: 0.7, opacity: 1, kind: 'line' })
    }
    for (let y = Math.ceil(ground.y1 / step) * step; y <= ground.y2; y += step) {
      const line = quad(cam, [
        { x: ground.x1, y, z: 0 },
        { x: ground.x2, y, z: 0 },
      ])
      faces.push({ ...line, depth: 1e9 - 1, fill: null, stroke: '#aab79b', strokeWidth: 0.7, opacity: 1, kind: 'line' })
    }
  }

  for (const pen of pens) {
    if (pen.pts.length < 2) continue
    const flat = quad(cam, pen.pts.map((p) => ({ x: p.x, y: p.y, z: 0 })))
    faces.push({
      ...flat,
      // Paint on the ground: always under the kit standing on it.
      depth: 1e8,
      fill: pen.closed ? pen.color : null,
      stroke: pen.color,
      strokeWidth: 2,
      opacity: pen.closed ? 0.3 : 1,
      dash: pen.closed ? undefined : '8 5',
      kind: 'ground',
    })
    if (pen.closed && pen.label) {
      const mid = pen.pts.reduce((s, p) => ({ x: s.x + p.x / pen.pts.length, y: s.y + p.y / pen.pts.length }), {
        x: 0,
        y: 0,
      })
      const at = project3d(cam, { x: mid.x, y: mid.y, z: 0 })
      labels.push({ at: { x: at.x, y: at.y }, text: pen.label, depth: at.depth })
    }
  }

  for (const piece of pieces) faces.push(...pieceFaces(cam, piece))

  faces.sort((a, b) => b.depth - a.depth)
  return { faces, labels }
}

/* ── Fitting it on the screen ─────────────────────────────────────────────── */

/**
 * The scale and offset that put a built scene on a given box.
 *
 * Worked out from the projected scene rather than from the ground it came
 * from, because the shape of a yard on the screen changes as it turns: a long
 * alley seen end-on is a few feet wide and seen across is two hundred. Fitting
 * the ground box instead leaves a yard half the size of its pane at most
 * angles.
 */
export function fitScene(
  faces: Face[],
  paper: { w: number; h: number },
  padPx = 28,
): { scale: number; ox: number; oy: number } {
  const pts = faces.flatMap((f) => f.pts)
  if (!pts.length) return { scale: 1, ox: paper.w / 2, oy: paper.h / 2 }
  const xs = pts.map((p) => p.x)
  const ys = pts.map((p) => p.y)
  const x1 = Math.min(...xs)
  const x2 = Math.max(...xs)
  const y1 = Math.min(...ys)
  const y2 = Math.max(...ys)
  const scale = Math.min(
    Math.max(paper.w - padPx * 2, 1) / Math.max(x2 - x1, 10),
    Math.max(paper.h - padPx * 2, 1) / Math.max(y2 - y1, 10),
  )
  return { scale, ox: paper.w / 2 - ((x1 + x2) / 2) * scale, oy: paper.h / 2 - ((y1 + y2) / 2) * scale }
}

/** Where a compass needle points, on screen, for the view's own north arrow. */
export function northOnScreen(cam: Camera): Pt {
  const n = project3d(cam, { x: 0, y: 1, z: 0 })
  const len = Math.hypot(n.x, n.y) || 1
  return { x: n.x / len, y: n.y / len }
}
