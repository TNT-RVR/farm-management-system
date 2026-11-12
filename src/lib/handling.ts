import type { Position } from 'geojson'
import { haversineM, pathAreaM2 } from '@/lib/geo/measure'

/**
 * The arithmetic behind the Handling System designer.
 *
 * Kept out of the map component because none of it is about a map: it is "how
 * many cows fit in that pen", "how many panels does this cost me", "have I got
 * them". The component's job is collecting clicks.
 *
 * Carried over from the prototype spec (Sam, 3 Nov 2026) so the new module
 * answers the same numbers he has been laying out yards with. Where it departs
 * from the spec it says so and why.
 */

const FT2_PER_M2 = 10.7639104167

/** Square feet inside a drawn pen, closing the ring back to the first point. */
export const areaFt2 = (points: Position[]): number => pathAreaM2(points) * FT2_PER_M2

/**
 * Screen pixels in one foot, taken from the map's own projection.
 *
 * The spec computes this from the Web Mercator ground resolution and a tile
 * size. That is right, but it has to agree with whatever zoom convention the
 * map library counts in — and MapLibre counts in 512 px tiles where the spec's
 * constant assumes 256, which is a silent factor of two in every panel on the
 * screen. So: measure a degree of longitude both ways, on the ground with
 * haversine and on the screen with the projection the map is actually using,
 * and take the ratio. Correct by construction, and it stays correct if the
 * basemap or the library changes under it.
 */
export function pxPerFoot(
  project: (p: Position) => { x: number; y: number },
  at: Position,
): number {
  const east: Position = [at[0] + 0.001, at[1]]
  const groundM = haversineM(at, east)
  if (groundM === 0) return 0
  const a = project(at)
  const b = project(east)
  const px = Math.hypot(b.x - a.x, b.y - a.y)
  return (px / groundM) * 0.3048
}

export type UsageType = 'crowding' | 'working' | 'holding' | 'pasture'

/**
 * Square feet a head needs, by what the pen is for.
 *
 * A range rather than a number, because it is a range: the low figure is what
 * cattle will stand in for an hour on working day, the high is what they need
 * to lie down and eat. Showing one number would make the tool look more
 * certain than the stockmanship it is quoting.
 */
export const PEN_SPACE: Record<UsageType, { label: string; low: number; high: number; note: string }> = {
  crowding: { label: 'Crowding / loading', low: 14, high: 20, note: 'Standing room on the way to the chute' },
  working: { label: 'Working pen', low: 25, high: 40, note: 'Sorting and holding for a few hours' },
  holding: { label: 'Holding pen', low: 60, high: 100, note: 'Overnight; room to lie down' },
  pasture: { label: 'Drylot / pasture', low: 300, high: 500, note: 'Days at a time, fed in the pen' },
}

export const USAGE_TYPES = Object.keys(PEN_SPACE) as UsageType[]

/**
 * Head a pen holds: the low estimate is the roomy one.
 *
 * Reads backwards until you see it — more square feet per head means fewer
 * head, so the generous allowance gives the smaller number.
 */
export function penCapacity(areaSqFt: number, usage: UsageType): { low: number; high: number } {
  const space = PEN_SPACE[usage]
  return {
    low: Math.floor(areaSqFt / space.high),
    high: Math.floor(areaSqFt / space.low),
  }
}

export type Fit = 'empty' | 'fits' | 'marginal' | 'over'

/** Does the head assigned to this pen fit in it? */
export function penFit(head: number, cap: { low: number; high: number }): Fit {
  if (head <= 0) return 'empty'
  if (head <= cap.low) return 'fits'
  if (head <= cap.high) return 'marginal'
  return 'over'
}

export const FIT_WORDS: Record<Fit, string> = {
  empty: 'Nothing in it',
  fits: 'Fits',
  marginal: 'Tight',
  over: 'Over capacity',
}

export type HerdClass = { class_name: string; head_count: number }
export type PenGroups = { id: string; assigned_classes: string[] }

/**
 * Head per pen, from the herd and which classes are ticked where.
 *
 * A class ticked in two pens splits evenly between them, and an odd head goes
 * to the earliest pen rather than being dropped or double-counted — 321 cows
 * across two pens is 161 and 160, not 160 and 160.
 *
 * Nothing here is stored. The pens record which classes they hold and the head
 * is worked out on the way past, so putting twenty more cows on the Herd tab
 * re-checks every pen in the yard instead of leaving saved numbers to rot.
 */
export function distributeHerd(
  herd: HerdClass[],
  pens: PenGroups[],
): { byPen: Record<string, Record<string, number>>; unplaced: HerdClass[] } {
  const byPen: Record<string, Record<string, number>> = {}
  for (const p of pens) byPen[p.id] = {}
  const unplaced: HerdClass[] = []

  for (const cls of herd) {
    const holders = pens.filter((p) => p.assigned_classes.includes(cls.class_name))
    if (holders.length === 0) {
      if (cls.head_count > 0) unplaced.push(cls)
      continue
    }
    const each = Math.floor(cls.head_count / holders.length)
    let extra = cls.head_count % holders.length
    for (const p of holders) {
      byPen[p.id][cls.class_name] = each + (extra > 0 ? 1 : 0)
      if (extra > 0) extra--
    }
  }
  return { byPen, unplaced }
}

/** Head in a pen, across every class ticked in it. */
export const headIn = (counts: Record<string, number> | undefined): number =>
  Object.values(counts ?? {}).reduce((s, n) => s + n, 0)

export type CatalogLite = { id: string; name: string; category: string; counted: boolean }

/**
 * The parts list: what this layout is built from.
 *
 * The cattle and the tractor are dropped on a plan to check clearance, so they
 * are placed items that are not parts. `counted` on the catalog row is what
 * keeps them off a list somebody might order from.
 */
export function partsList(
  items: { catalog_id: string }[],
  catalog: CatalogLite[],
): { item: CatalogLite; count: number }[] {
  const byId = new Map(catalog.map((c) => [c.id, c]))
  const counts = new Map<string, number>()
  for (const i of items) {
    const c = byId.get(i.catalog_id)
    if (!c || !c.counted) continue
    counts.set(c.id, (counts.get(c.id) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([id, count]) => ({ item: byId.get(id)!, count }))
    .sort((a, b) => a.item.category.localeCompare(b.item.category) || a.item.name.localeCompare(b.item.name))
}

export type Shortfall = { item: CatalogLite; needed: number; owned: number; short: number; spare: number }

/**
 * What the design asks for against what is in the yard.
 *
 * Every piece of kit is listed, not only what this layout uses, for two
 * reasons: "I have fourteen 12 ft panels sitting behind the shop" is half the
 * reason to open this screen, and a row has to exist before anybody can type
 * how many they own into it — list only what is placed and a new yard offers
 * nowhere to record anything.
 *
 * Order: what is short, then what the design uses, then the rest. The top of
 * the list is the shopping list.
 */
export function inventoryStatus(
  parts: { item: CatalogLite; count: number }[],
  owned: Record<string, number>,
  catalog: CatalogLite[],
): Shortfall[] {
  const needed = new Map(parts.map((p) => [p.item.id, p.count]))
  return catalog
    .filter((c) => c.counted)
    .map((item) => {
      const need = needed.get(item.id) ?? 0
      const have = owned[item.id] ?? 0
      return { item, needed: need, owned: have, short: Math.max(0, need - have), spare: Math.max(0, have - need) }
    })
    .sort(
      (a, b) =>
        b.short - a.short ||
        b.needed - a.needed ||
        b.owned - a.owned ||
        a.item.category.localeCompare(b.item.category) ||
        a.item.name.localeCompare(b.item.name),
    )
}

/**
 * The nearest vertex within reach, in SCREEN pixels.
 *
 * Pixels and not feet on purpose: a snap that is forgiving when the yard fills
 * the screen and unusable when it does not is worse than no snap. Fourteen
 * pixels is about a fingertip and is what the prototype settled on.
 */
export const SNAP_PX = 14

export function nearestPoint(
  cursor: { x: number; y: number },
  candidates: { x: number; y: number; key: string }[],
  withinPx = SNAP_PX,
): { key: string; x: number; y: number } | null {
  let best: { key: string; x: number; y: number } | null = null
  let bestD = withinPx
  for (const c of candidates) {
    const d = Math.hypot(c.x - cursor.x, c.y - cursor.y)
    if (d <= bestD) {
      bestD = d
      best = c
    }
  }
  return best
}

/**
 * How far to turn a label so it reads left to right.
 *
 * A panel label rotated with its panel is upside down for half the compass,
 * which the prototype shipped with and Sam read as a bug. Flipping it a
 * further 180° past the quarter turns keeps the text the right way up without
 * moving the panel.
 */
export function labelSpin(rotationDeg: number): number {
  const r = ((rotationDeg % 360) + 360) % 360
  return r > 90 && r < 270 ? 180 : 0
}

/** The box around everything placed, for framing the map on open. */
export function layoutBounds(
  items: { lng: number; lat: number }[],
  paths: { points: Position[] }[],
): [[number, number], [number, number]] | null {
  const pts: Position[] = [...items.map((i) => [i.lng, i.lat] as Position), ...paths.flatMap((p) => p.points)]
  if (pts.length === 0) return null
  let w = pts[0][0]
  let e = pts[0][0]
  let s = pts[0][1]
  let n = pts[0][1]
  for (const [lng, lat] of pts) {
    if (lng < w) w = lng
    if (lng > e) e = lng
    if (lat < s) s = lat
    if (lat > n) n = lat
  }
  return [
    [w, s],
    [e, n],
  ]
}

/**
 * The box to open a yard on, never tighter than a corral.
 *
 * Framing the bounds of what is placed is right once there is a layout and
 * wrong on the way there: one panel is a box with no width, and a map asked to
 * frame a point goes to its maximum zoom — a screen about two panels wide, with
 * nothing on it to tell you where in the yard you are. Anything smaller than a
 * corral is opened out around its own middle instead.
 */
export function framedBounds(
  bounds: [[number, number], [number, number]] | null,
  minFt = 300,
): [[number, number], [number, number]] | null {
  if (!bounds) return null
  const [[w, s], [e, n]] = bounds
  const minDeg = (minFt * 0.3048) / 111_320
  const midLat = (s + n) / 2
  const lngScale = Math.max(0.1, Math.cos((midLat * Math.PI) / 180))
  const padTo = (lo: number, hi: number, min: number): [number, number] => {
    const span = hi - lo
    if (span >= min) return [lo, hi]
    const mid = (lo + hi) / 2
    return [mid - min / 2, mid + min / 2]
  }
  const [s2, n2] = padTo(s, n, minDeg)
  const [w2, e2] = padTo(w, e, minDeg / lngScale)
  return [
    [w2, s2],
    [e2, n2],
  ]
}

/**
 * Move a point a given number of feet on a bearing.
 *
 * Used for dropping an item where the cursor is and for the ends of a panel,
 * which are the only places the designer converts feet back to ground.
 *
 * The mean earth radius, matching haversineM, so a distance measured straight
 * after being walked comes back the same. lib/geo measures AREA on the
 * equatorial radius instead, which leaves a pen about 0.2% larger than the
 * feet that drew it — twenty square feet in ten thousand. Not worth a second
 * set of geodesy to chase, and worth writing down so nobody chases it twice.
 */
export function offsetFt(from: Position, feet: number, bearingDeg: number): Position {
  const R = 6371008.8
  const d = (feet * 0.3048) / R
  const b = (bearingDeg * Math.PI) / 180
  const lat1 = (from[1] * Math.PI) / 180
  const lng1 = (from[0] * Math.PI) / 180
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(b))
  const lng2 =
    lng1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2))
  return [(lng2 * 180) / Math.PI, (lat2 * 180) / Math.PI]
}

/** Rotation snapped the way the handle and the wheel snap it. */
export const snapAngle = (deg: number, fine = false): number => {
  const step = fine ? 1 : 5
  return ((Math.round(deg / step) * step) % 360 + 360) % 360
}

/* ── Ends, and joining them up ─────────────────────────────────────────────
   A panel, a gate and a wind fence are lines of fence: what matters about
   them is where the two ends are, because that is where the next one has to
   start. Everything else -- a trough, a tub, the tractor -- is a footprint
   with no ends to join. */

/** Is this piece a run of fence, rather than a thing standing on the ground? */
export const isLinear = (c: { panel_type?: string | null; gate_type?: string | null }): boolean =>
  Boolean(c.panel_type || c.gate_type)

/**
 * The two ends of a piece of fence, on the ground.
 *
 * Rotation is the SVG rotation the overlay draws with: the glyph runs along its
 * own x, screen +x is east and screen +y is south, so a rotation of r points
 * the piece along the bearing r + 90. A panel at 0° runs east-west.
 */
export function itemEnds(centre: Position, lengthFt: number, rotationDeg: number): [Position, Position] {
  const bearing = rotationDeg + 90
  return [offsetFt(centre, lengthFt / 2, bearing), offsetFt(centre, -lengthFt / 2, bearing)]
}

/* ── Gates that open ───────────────────────────────────────────────────────── */

export type Leaf = { centre: { x: number; y: number }; rotation: number; lengthFt: number }

/** The piece's long axis as a unit step, east and north, for a given rotation. */
const axisStep = (rotationDeg: number) => {
  const b = ((rotationDeg + 90) * Math.PI) / 180
  return { x: Math.sin(b), y: Math.cos(b) }
}

/**
 * Where a gate's leaves lie at a given swing.
 *
 * A gate is hinged — at one end, or at both for a two-panel — so opening it
 * sweeps the leaf about that hinge and the leaf's own middle moves with it.
 * The answer comes back as a centre and a rotation per leaf, because that is
 * what both the plan glyph and the 3D view draw a run of fence from.
 *
 * Feet, in the overlay's own convention: a piece runs along the bearing
 * rotation + 90, and a positive swing turns the leaf clockwise seen from
 * above, the same sense as rotation itself. Shut is 0.
 *
 * The two leaves of a double gate turn in OPPOSITE senses, which is what makes
 * them both open to the same side — a barn door, not a revolving door.
 */
export function gateLeaves(
  centre: { x: number; y: number },
  lengthFt: number,
  rotation: number,
  swingDeg: number,
  twoPanel = false,
): Leaf[] {
  const axis = axisStep(rotation)
  const half = lengthFt / 2
  const hingeA = { x: centre.x - axis.x * half, y: centre.y - axis.y * half }
  const leaf = (hinge: { x: number; y: number }, rot: number, len: number): Leaf => {
    const a = axisStep(rot)
    return { centre: { x: hinge.x + a.x * (len / 2), y: hinge.y + a.y * (len / 2) }, rotation: rot, lengthFt: len }
  }
  if (!twoPanel) return [leaf(hingeA, rotation + swingDeg, lengthFt)]
  const hingeB = { x: centre.x + axis.x * half, y: centre.y + axis.y * half }
  return [leaf(hingeA, rotation + swingDeg, half), leaf(hingeB, rotation + 180 - swingDeg, half)]
}

export type EndTarget = { x: number; y: number; key: string; rotation: number }

/**
 * The end-to-end snap: which end of the piece being dragged is closest to the
 * end of another one, and how far the piece has to shift to meet it.
 *
 * In screen pixels for the same reason the vertex snap is (see SNAP_PX): a
 * snap measured in feet is either unusably sticky at one zoom or useless at
 * another. The caller turns the pixel shift back into ground.
 */
export function endSnap(
  ends: { x: number; y: number }[],
  targets: EndTarget[],
  withinPx = SNAP_PX,
): { endIndex: number; target: EndTarget; dx: number; dy: number } | null {
  let best: { endIndex: number; target: EndTarget; dx: number; dy: number } | null = null
  let bestD = withinPx
  ends.forEach((end, endIndex) => {
    for (const target of targets) {
      const d = Math.hypot(target.x - end.x, target.y - end.y)
      if (d <= bestD) {
        bestD = d
        best = { endIndex, target, dx: target.x - end.x, dy: target.y - end.y }
      }
    }
  })
  return best
}

/**
 * Line a piece up with the one it is joining, if it is nearly in line already.
 *
 * A run of fence wants to be dead straight, and a panel dropped by hand is
 * never more than a few degrees off. Either direction counts — a panel laid
 * end to end with one at 90° is in line whether it reads as 90 or 270 — so
 * both are tried and the near one wins. Turn it further than this and the
 * angle is deliberate: a corner, a funnel, the mouth of an alley, and it is
 * left exactly where it was put.
 */
export function alignRotation(dragged: number, target: number, withinDeg = 12): number {
  const norm = (d: number) => ((d % 360) + 360) % 360
  for (const candidate of [target, target + 180]) {
    let diff = norm(dragged - candidate)
    if (diff > 180) diff -= 360
    if (Math.abs(diff) <= withinDeg) return norm(candidate)
  }
  return norm(dragged)
}

/* ── Picking several things at once ─────────────────────────────────────────
   What is selected is a set, not a thing. A corral is laid out in runs — six
   panels and a gate make an alley — and a tool that can only ever hold one
   panel makes you move the alley one panel at a time. */

export type Selection = { items: string[]; paths: string[] }
export const NO_SELECTION: Selection = { items: [], paths: [] }

export const selectionSize = (s: Selection): number => s.items.length + s.paths.length

/** Just this one, for a plain click. */
export const onlySelected = (kind: 'item' | 'path', id: string): Selection =>
  kind === 'item' ? { items: [id], paths: [] } : { items: [], paths: [id] }

/** In or out, for a shift-click. */
export function toggleSelected(s: Selection, kind: 'item' | 'path', id: string): Selection {
  if (kind === 'item')
    return { ...s, items: s.items.includes(id) ? s.items.filter((x) => x !== id) : [...s.items, id] }
  return { ...s, paths: s.paths.includes(id) ? s.paths.filter((x) => x !== id) : [...s.paths, id] }
}

/** Both sets together, so a box drag can add to what is already picked. */
export const mergeSelected = (a: Selection, b: Selection): Selection => ({
  items: [...new Set([...a.items, ...b.items])],
  paths: [...new Set([...a.paths, ...b.paths])],
})

/** What a group gesture is about to describe, for the readout. */
export function selectionWords(s: Selection): string {
  const bits: string[] = []
  if (s.items.length) bits.push(`${s.items.length} ${s.items.length === 1 ? 'piece' : 'pieces'}`)
  if (s.paths.length) bits.push(`${s.paths.length} ${s.paths.length === 1 ? 'pen' : 'pens'}`)
  return bits.join(' and ')
}

export type Box = { x1: number; y1: number; x2: number; y2: number }

/** A box drawn in any direction, read left-top to right-bottom. */
export const normBox = (b: Box): Box => ({
  x1: Math.min(b.x1, b.x2),
  y1: Math.min(b.y1, b.y2),
  x2: Math.max(b.x1, b.x2),
  y2: Math.max(b.y1, b.y2),
})

export const inBox = (b: Box, p: { x: number; y: number }): boolean =>
  p.x >= b.x1 && p.x <= b.x2 && p.y >= b.y1 && p.y <= b.y2

/**
 * What a dragged box caught.
 *
 * A piece of kit is caught when its centre is inside, which is how a box
 * selection behaves everywhere. A pen has to be inside WHOLE: half a fence
 * line is not a thing you can do anything with, and a box drawn over one
 * corner of a yard would otherwise pick up every pen that corner touches.
 */
export function marqueeHits(
  box: Box,
  items: { id: string; x: number; y: number }[],
  paths: { id: string; pts: { x: number; y: number }[] }[],
): { items: string[]; paths: string[] } {
  const b = normBox(box)
  return {
    items: items.filter((i) => inBox(b, i)).map((i) => i.id),
    paths: paths.filter((p) => p.pts.length > 0 && p.pts.every((pt) => inBox(b, pt))).map((p) => p.id),
  }
}

/**
 * Spin a point about another, in screen pixels.
 *
 * Clockwise for a positive angle, matching the overlay's rotations: screen y
 * grows downward, so the usual anticlockwise formula comes out clockwise
 * without changing a sign.
 */
export function rotateAboutPx(
  p: { x: number; y: number },
  centre: { x: number; y: number },
  deg: number,
): { x: number; y: number } {
  const a = (deg * Math.PI) / 180
  const dx = p.x - centre.x
  const dy = p.y - centre.y
  return {
    x: centre.x + dx * Math.cos(a) - dy * Math.sin(a),
    y: centre.y + dx * Math.sin(a) + dy * Math.cos(a),
  }
}

/** The middle of a set of screen points: what a group turns about. */
export function centroidPx(pts: { x: number; y: number }[]): { x: number; y: number } | null {
  if (!pts.length) return null
  return {
    x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
    y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
  }
}

/* ── Ground feet, for the views that are not a map ────────────────────────── */

const FT_PER_M = 1 / 0.3048

/**
 * Feet east and north of an origin.
 *
 * The 3D view and the printed plan both need a flat sheet of ground to draw
 * on, and over a corral the earth is flat: a yard is six hundred feet across
 * and the curvature over that is thinner than the line the plan is drawn with.
 *
 * Measured with haversine on purpose rather than with a metres-per-degree
 * series. It is the same function the measure tool uses, so a fence that reads
 * 63 ft on the map reads 63 ft on the plan — two sets of geodesy that disagree
 * in the third digit would be a bug report nobody could reproduce.
 */
export function toLocalFt(origin: Position, p: Position): { x: number; y: number } {
  const dx = haversineM(origin, [p[0], origin[1]]) * FT_PER_M
  const dy = haversineM(origin, [origin[0], p[1]]) * FT_PER_M
  return { x: p[0] >= origin[0] ? dx : -dx, y: p[1] >= origin[1] ? dy : -dy }
}

/** The middle of a lng/lat box, which is what local feet are measured from. */
export const boundsCentre = (b: [[number, number], [number, number]]): Position => [
  (b[0][0] + b[1][0]) / 2,
  (b[0][1] + b[1][1]) / 2,
]

/**
 * The scale that fits a span of ground onto a sheet, and where its middle goes.
 *
 * One scale for both axes, so a square pen prints square. A yard with nothing
 * in it has no span, hence the floor: an empty sheet at some arbitrary
 * magnification is how the map once came up at maximum zoom.
 */
export function fitScale(
  spanFt: { w: number; h: number },
  paper: { w: number; h: number },
  padPx = 24,
): { scale: number; cx: number; cy: number } {
  const usableW = Math.max(1, paper.w - padPx * 2)
  const usableH = Math.max(1, paper.h - padPx * 2)
  const scale = Math.min(usableW / Math.max(spanFt.w, 10), usableH / Math.max(spanFt.h, 10))
  return { scale, cx: paper.w / 2, cy: paper.h / 2 }
}

/**
 * A round number of feet for a scale bar, and how wide it draws.
 *
 * Bars read 10, 20, 50, 100 and so on: a bar labelled "37 ft" is a bar nobody
 * can lay a thumb against.
 */
export function scaleBar(pxPerFt: number, aimPx = 120): { feet: number; px: number } {
  const steps = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000]
  const want = aimPx / Math.max(pxPerFt, 1e-6)
  const feet = steps.find((s) => s >= want) ?? steps[steps.length - 1]
  return { feet, px: feet * pxPerFt }
}
