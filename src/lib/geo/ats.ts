/**
 * Alberta Township System → coordinates. Pure functions — no React, no network.
 *
 * Turns any legal land description into a box on the map, whether or not it is
 * a field in the system. The point is scouting: a grower names a quarter you
 * have never worked, and you want to see where it is before driving out.
 *
 * ── This is an APPROXIMATION, and the size of the error is measured ──────────
 *
 * The ATS is a survey, not a formula. Township and range lines were walked in
 * the field, meridians converge toward the pole, and correction lines re-set
 * the ranges periodically — so no arithmetic reproduces it exactly. What this
 * does is lay a regular 6-mile grid north from 49°N and west from each
 * meridian, which is the shape the survey approximates.
 *
 * ── Two tiers ────────────────────────────────────────────────────────────────
 *
 * SURVEY (`atsBox` with a township table) uses the real Alberta Township System
 * survey, collapsed to one origin and section pitch per township by
 * `scripts/build_ats_townships.py`. Median error 7 m. This is what Alberta
 * lookups use.
 *
 * GRID (`atsBox` with no table) lays a regular grid north from 49°N and west
 * from each meridian. Typical error 300 m, and it CANNOT be better: the survey
 * re-sets its ranges at correction lines every four townships, so the offset
 * jumps — two fields either side of one are wrong in opposite directions. This
 * tier exists so Saskatchewan, Manitoba and W1–W3 degrade instead of failing.
 *
 * `ats.test.ts` measures both against fifteen real TNT fields whose surveyed
 * pivot coordinates are known. Even the survey tier is a lookup of section
 * centres, NOT a legal boundary — anything that needs survey accuracy needs
 * Alberta's own ATS dataset.
 */

/** Metres in a survey mile. */
const MILE_M = 1609.344

/**
 * A township is six miles PLUS its road allowances, and so is a range.
 *
 * These two numbers are the whole difference between a naive grid and a usable
 * one. Six miles exactly puts a parcel 1.5–2.9 km from where it is — pointing
 * at the wrong section entirely. The extra comes from the 66-foot road
 * allowances the survey leaves between sections: three east–west crossings per
 * township (~60 m) and six north–south ones per range (~121 m).
 *
 * The values below were FITTED by least squares against fifteen TNT fields
 * whose surveyed pivot coordinates are known, and they land within a few metres
 * of what the road allowances predict — which is the reassuring part. See
 * `ats.test.ts`, which re-measures the fit on every run.
 */
const TOWNSHIP_M = 6 * MILE_M + 56
const RANGE_M = 6 * MILE_M + 138

/**
 * Typical error of each tier, measured — quoted to the user, so they know what
 * the box on the map is worth. A quarter section is 804 m across.
 */
export const SURVEY_ERROR_M = 35
export const GRID_ERROR_M = 300

/**
 * Longitude of each meridian, west negative.
 *
 * The First Meridian is not a round number — it was fixed just west of
 * Winnipeg in 1869 and everything else follows from it.
 */
export const MERIDIANS: Record<number, number> = {
  1: -97.457_5,
  2: -102,
  3: -106,
  4: -110,
  5: -114,
  6: -118,
}

/** The southern edge of Township 1: the international boundary. */
const BASE_LAT = 49

/** Metres per degree of latitude at `lat` (WGS84 approximation, sub-metre). */
function mPerDegLat(lat: number): number {
  const p = (lat * Math.PI) / 180
  return 111132.92 - 559.82 * Math.cos(2 * p) + 1.175 * Math.cos(4 * p) - 0.0023 * Math.cos(6 * p)
}

/** Metres per degree of longitude at `lat`. */
function mPerDegLon(lat: number): number {
  const p = (lat * Math.PI) / 180
  return 111412.84 * Math.cos(p) - 93.5 * Math.cos(3 * p) + 0.118 * Math.cos(5 * p)
}

/**
 * Latitude of the southern boundary of `township`.
 *
 * Stepped township by township rather than multiplied out, because degrees per
 * mile shrink as you go north. Over 126 townships a single multiplication is
 * out by kilometres; stepping keeps it consistent with the survey's own
 * north-from-the-border construction.
 */
export function townshipSouthLat(township: number): number {
  let lat = BASE_LAT
  for (let t = 1; t < township; t++) {
    lat += TOWNSHIP_M / mPerDegLat(lat)
  }
  return lat
}

export interface LatLng {
  lat: number
  lng: number
}

/** A rectangle on the map, as a closed ring of five points. */
export type Ring = LatLng[]

export interface AtsBox {
  /** Centre of the parcel. */
  center: LatLng
  /** Corner ring, closed (first point repeated last), ready for GeoJSON. */
  ring: Ring
  /** South-west and north-east corners. */
  bounds: { south: number; west: number; north: number; east: number }
  /** Which tier produced this — the UI quotes a different error for each. */
  source: 'survey' | 'grid'
}

// ═══════════════════════════════════════════════════════════════════════════
// The survey table
// ═══════════════════════════════════════════════════════════════════════════

/** One township as surveyed: where it starts and how its sections step. */
export interface Township {
  /** Latitude of the south edge of the southern section row. */
  south: number
  /** Longitude of the east edge of the eastern section column. */
  east: number
  /**
   * Spacing between section edges. NOT the same as `sizeLat`/`sizeLon` — the
   * survey cuts a road allowance between sections, so the pitch is a mile plus
   * that allowance.
   */
  pitchLat: number
  pitchLon: number
  /** The surveyed section itself, without the road allowance. */
  sizeLat: number
  sizeLon: number
}

export interface TownshipTable {
  get(meridian: number, township: number, range: number): Township | null
  readonly size: number
}

/** Fixed-point scales, matching `scripts/build_ats_townships.py`. */
const DEG_SCALE = 1e7
const STEP_SCALE = 1e6
const RECORD_BYTES = 20

const townshipKey = (meridian: number, township: number, range: number) =>
  meridian * 1_000_000 + township * 1_000 + range

/**
 * Decode `public/ats-townships.bin`.
 *
 * Returns null rather than throwing on a bad or truncated file: a corrupt asset
 * should cost the lookup its accuracy, not take the map down with it. The
 * caller falls back to the grid tier.
 */
export function parseTownshipTable(buffer: ArrayBuffer): TownshipTable | null {
  if (buffer.byteLength < 8) return null
  const view = new DataView(buffer)
  // Magic 'ATT1' — guards against a 404 HTML page arriving as the asset.
  if (view.getUint32(0, false) !== 0x41545431) return null
  const count = view.getUint32(4, true)
  if (buffer.byteLength < 8 + count * RECORD_BYTES) return null

  const map = new Map<number, Township>()
  for (let i = 0; i < count; i++) {
    const o = 8 + i * RECORD_BYTES
    map.set(townshipKey(view.getUint8(o), view.getUint8(o + 1), view.getUint8(o + 2)), {
      south: view.getInt32(o + 4, true) / DEG_SCALE,
      east: view.getInt32(o + 8, true) / DEG_SCALE,
      pitchLat: view.getUint16(o + 12, true) / STEP_SCALE,
      pitchLon: view.getUint16(o + 14, true) / STEP_SCALE,
      sizeLat: view.getUint16(o + 16, true) / STEP_SCALE,
      sizeLon: view.getUint16(o + 18, true) / STEP_SCALE,
    })
  }
  return {
    get: (meridian, township, range) => map.get(townshipKey(meridian, township, range)) ?? null,
    size: map.size,
  }
}

/**
 * Where section `section` sits in its township, as a grid position.
 *
 * Sections are numbered in a serpentine ("boustrophedon") from the SOUTH-EAST
 * corner: 1–6 run east to west along the bottom, 7–12 run back west to east on
 * the next row up, and so on to 36 in the north-east. Getting this backwards
 * puts a parcel up to six miles from where it belongs, and the result still
 * looks plausible on a map — which is why it has its own test.
 */
export function sectionGridPosition(section: number): { colFromWest: number; rowFromSouth: number } | null {
  if (!Number.isInteger(section) || section < 1 || section > 36) return null
  const rowFromSouth = Math.floor((section - 1) / 6)
  const posInRow = (section - 1) % 6
  // Even rows (1–6, 13–18, 25–30) are numbered east→west; odd rows west→east.
  const colFromWest = rowFromSouth % 2 === 0 ? 5 - posInRow : posInRow
  return { colFromWest, rowFromSouth }
}

/** Where a quarter sits inside its section. */
function quarterOffset(quarter: string | null): { east: number; north: number } {
  // Half-mile steps from the section's south-west corner to the quarter's.
  switch (quarter) {
    case 'NE':
      return { east: 1, north: 1 }
    case 'NW':
      return { east: 0, north: 1 }
    case 'SE':
      return { east: 1, north: 0 }
    case 'SW':
      return { east: 0, north: 0 }
    default:
      return { east: 0, north: 0 }
  }
}

export interface AtsParts {
  quarter: string | null
  section: number
  township: number
  range: number
  meridian: number
}

/** Assemble a box from its edges. */
function makeBox(
  south: number,
  west: number,
  north: number,
  east: number,
  source: 'survey' | 'grid',
): AtsBox {
  return {
    center: { lat: (south + north) / 2, lng: (west + east) / 2 },
    ring: [
      { lat: south, lng: west },
      { lat: south, lng: east },
      { lat: north, lng: east },
      { lat: north, lng: west },
      { lat: south, lng: west },
    ],
    bounds: { south, west, north, east },
    source,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Township frames — why the survey tier is not four numbers per township
// ═══════════════════════════════════════════════════════════════════════════
//
// Each record in the table is a township fitted as a RECTANGLE: one south
// latitude, one east longitude, one step each way. That is a good fit inside a
// township and a bad one at its edges, because the townships were surveyed
// independently and their fitted rectangles do not agree with each other:
//
//   • Two townships side by side in the same row disagree about the latitude of
//     the township line they share — measured across W4, usually 0–5 m but up
//     to 25 m (T11 R13/R14 is the worst of the local ones, and is the step
//     visible on the map).
//   • Two townships stacked disagree about the latitude between them by 3–44 m,
//     sometimes as a gap and sometimes as an overlap.
//   • They disagree about a shared range line by 2–11 m — except across a
//     correction line, where the range line genuinely jogs 840–1020 m and the
//     disagreement is the survey, not an error.
//
// So a township is drawn as a QUADRILATERAL whose four corners are shared with
// its neighbours. Every corner is computed by `cornerAt`, a pure function of
// (meridian, township, range) that averages what the four townships meeting
// there each think that corner is. Two neighbours asking for the same corner
// get the same number, so the drawn grid closes at every seam by construction —
// no stretching one row to reach the next.
//
// The averaging is skipped for any neighbour that disagrees by more than a
// survey seam could account for. That is what preserves the correction lines:
// a 900 m jog is nothing like a 10 m fitting difference, so the townships above
// and below one keep their own longitudes and the range line steps, as it does
// on the ground.

/** Beyond this, a neighbour's idea of a corner is not a survey seam. */
const LAT_SEAM = 0.0009 // ~100 m
const LON_SEAM = 0.003 // ~215 m; a correction-line jog is four times this

/** One township's estimate of a corner, or null if it is not in the table. */
function cornerEstimate(
  table: TownshipTable,
  meridian: number,
  township: number,
  range: number,
  /** Which of that township's own corners this is. */
  corner: 'se' | 'sw' | 'ne' | 'nw',
): LatLng | null {
  const t = table.get(meridian, township, range)
  if (!t) return null
  const north = corner === 'ne' || corner === 'nw'
  const west = corner === 'sw' || corner === 'nw'
  return {
    lat: t.south + (north ? 6 * t.pitchLat : 0),
    lng: t.east - (west ? 6 * t.pitchLon : 0),
  }
}

/**
 * The south-east corner of township (meridian, township, range), as seen from
 * the township asking for it.
 *
 * Averaged over the (up to four) townships that meet at this point, but the two
 * coordinates are treated very differently:
 *
 * LATITUDE is requester-independent. A township line is continuous east to west
 * across the province, so there is exactly one right answer at a corner and
 * everyone gets it — which is what closes the east-west lines.
 *
 * LONGITUDE is judged against the REQUESTER's own idea of the corner, because
 * at a correction line the corner honestly has two longitudes: the range line
 * below it and the range line above it are ~900 m apart. Anchoring on the
 * requester keeps each township on its own side of that jog. Without this the
 * township below a correction line is stretched into a 900 m parallelogram —
 * which is exactly what it looked like.
 */
function cornerAt(
  table: TownshipTable,
  meridian: number,
  township: number,
  range: number,
  /** The township doing the asking, and which of its corners this is. */
  asker: { township: number; range: number; corner: 'se' | 'sw' | 'ne' | 'nw' },
): LatLng | null {
  // This corner is the SE of this township, the SW of the one to its east, the
  // NE of the one below, and the NW of the one below and east.
  const votes = [
    cornerEstimate(table, meridian, township, range, 'se'),
    cornerEstimate(table, meridian, township, range - 1, 'sw'),
    cornerEstimate(table, meridian, township - 1, range, 'ne'),
    cornerEstimate(table, meridian, township - 1, range - 1, 'nw'),
  ].filter((v): v is LatLng => v != null)
  if (votes.length === 0) return null

  const own = cornerEstimate(table, meridian, asker.township, asker.range, asker.corner)
  const mean = (values: number[], ref: number, tol: number) => {
    const kept = values.filter((x) => Math.abs(x - ref) <= tol)
    return kept.length ? kept.reduce((s, x) => s + x, 0) / kept.length : ref
  }
  return {
    lat: mean(votes.map((v) => v.lat), votes[0].lat, LAT_SEAM),
    lng: mean(votes.map((v) => v.lng), own?.lng ?? votes[0].lng, LON_SEAM),
  }
}

/** A township as a quadrilateral, corners shared with its neighbours. */
interface TownshipFrame {
  se: LatLng
  sw: LatLng
  ne: LatLng
  nw: LatLng
}

// Frames are rebuilt for every parcel drawn, and a grid pass draws hundreds.
// Keyed by table identity so a reloaded table is never served a stale frame.
let frameCacheTable: TownshipTable | null = null
let frameCache = new Map<number, TownshipFrame | null>()

function townshipFrame(
  table: TownshipTable,
  meridian: number,
  township: number,
  range: number,
): TownshipFrame | null {
  if (frameCacheTable !== table) {
    frameCacheTable = table
    frameCache = new Map()
  }
  const key = meridian * 1_000_000 + township * 1_000 + range
  const hit = frameCache.get(key)
  if (hit !== undefined) return hit

  // Ranges are numbered westward, so range+1 is the township to the WEST.
  const me = { township, range }
  const se = cornerAt(table, meridian, township, range, { ...me, corner: 'se' })
  const sw = cornerAt(table, meridian, township, range + 1, { ...me, corner: 'sw' })
  const ne = cornerAt(table, meridian, township + 1, range, { ...me, corner: 'ne' })
  const nw = cornerAt(table, meridian, township + 1, range + 1, { ...me, corner: 'nw' })
  const frame = se && sw && ne && nw ? { se, sw, ne, nw } : null
  frameCache.set(key, frame)
  return frame
}

/**
 * A point inside a township frame.
 *
 * `u` runs 0→1 south to north, `v` runs 0→1 east to west — the directions the
 * survey itself counts in.
 */
function framePoint(f: TownshipFrame, u: number, v: number): LatLng {
  const w = (a: number, b: number, c: number, d: number) =>
    (1 - u) * (1 - v) * a + (1 - u) * v * b + u * (1 - v) * c + u * v * d
  return {
    lat: w(f.se.lat, f.sw.lat, f.ne.lat, f.nw.lat),
    lng: w(f.se.lng, f.sw.lng, f.ne.lng, f.nw.lng),
  }
}

/**
 * Where a lat/lng sits inside a frame, as the same (u, v) `framePoint` takes.
 *
 * Newton's method on the bilinear map. A township frame is very nearly a
 * parallelogram — the corners differ by tens of metres over ten kilometres — so
 * this converges in two or three steps; six is a ceiling, not a working count.
 * Returns the solution even when it lands outside 0–1, because the caller uses
 * that to decide the point is in a different township.
 */
function frameUv(f: TownshipFrame, p: LatLng): { u: number; v: number } {
  let u = 0.5
  let v = 0.5
  for (let i = 0; i < 6; i++) {
    const at = framePoint(f, u, v)
    const dLat = at.lat - p.lat
    const dLng = at.lng - p.lng
    if (Math.abs(dLat) < 1e-10 && Math.abs(dLng) < 1e-10) break
    // ∂/∂u and ∂/∂v of the bilinear map at (u, v).
    const dLatDu = (1 - v) * (f.ne.lat - f.se.lat) + v * (f.nw.lat - f.sw.lat)
    const dLatDv = (1 - u) * (f.sw.lat - f.se.lat) + u * (f.nw.lat - f.ne.lat)
    const dLngDu = (1 - v) * (f.ne.lng - f.se.lng) + v * (f.nw.lng - f.sw.lng)
    const dLngDv = (1 - u) * (f.sw.lng - f.se.lng) + u * (f.nw.lng - f.ne.lng)
    const det = dLatDu * dLngDv - dLatDv * dLngDu
    if (Math.abs(det) < 1e-18) break
    u -= (dLat * dLngDv - dLng * dLatDv) / det
    v -= (dLng * dLatDu - dLat * dLngDu) / det
  }
  return { u, v }
}

/** Assemble a box from four corners that are not necessarily axis-aligned. */
function makeQuad(
  se: LatLng,
  sw: LatLng,
  ne: LatLng,
  nw: LatLng,
  source: 'survey' | 'grid',
): AtsBox {
  const lats = [se.lat, sw.lat, ne.lat, nw.lat]
  const lngs = [se.lng, sw.lng, ne.lng, nw.lng]
  return {
    center: {
      lat: (se.lat + sw.lat + ne.lat + nw.lat) / 4,
      lng: (se.lng + sw.lng + ne.lng + nw.lng) / 4,
    },
    ring: [sw, se, ne, nw, sw],
    bounds: {
      south: Math.min(...lats),
      west: Math.min(...lngs),
      north: Math.max(...lats),
      east: Math.max(...lngs),
    },
    source,
  }
}

/**
 * The box for a legal land description.
 *
 * With a quarter, the box is that quarter (half a mile square). Without one it
 * is the whole section (a mile square) — which is the right answer to "where is
 * 35-8-21", rather than silently picking a corner.
 *
 * Pass `table` (from `parseTownshipTable`) to use the survey. Without it, or
 * for a township the survey data does not cover, this falls back to the grid —
 * see the two tiers at the top of the file.
 */
export interface AtsBoxOptions {
  /**
   * Draw parcels edge to edge instead of at their surveyed size.
   *
   * The survey cuts a road allowance between sections, so a section is smaller
   * than the pitch it sits on and consecutive sections do not touch. That is
   * true of the ground, and right for showing one parcel's extent.
   *
   * It is wrong for a grid over the whole view: the gaps read as a broken or
   * misaligned overlay, and — worse — they disagree with `reverseLld`, which
   * tiles on the PITCH so that no point falls between two parcels. Without this
   * the map can name a point as part of a quarter it visibly sits outside.
   */
  tile?: boolean
}

export function atsBox(
  parts: AtsParts,
  table?: TownshipTable | null,
  opts: AtsBoxOptions = {},
): AtsBox | null {
  const meridianLng = MERIDIANS[parts.meridian]
  if (meridianLng === undefined) return null
  const pos = sectionGridPosition(parts.section)
  if (!pos) return null
  if (parts.township < 1 || parts.township > 126) return null
  if (parts.range < 1 || parts.range > 34) return null

  const surveyed = table?.get(parts.meridian, parts.township, parts.range)
  const frame = table && surveyed ? townshipFrame(table, parts.meridian, parts.township, parts.range) : null
  if (surveyed && frame) {
    const q = quarterOffset(parts.quarter)
    // Sections step west from the township's east edge, so a column counted
    // from the west has to be flipped.
    const colFromEast = 5 - pos.colFromWest
    const span = parts.quarter ? 0.5 : 1
    // Position inside the township, in sixths: u north from its south edge,
    // v west from its east edge.
    let u0 = (pos.rowFromSouth + (parts.quarter ? q.north * 0.5 : 0)) / 6
    let v0 = (colFromEast + (parts.quarter ? (1 - q.east) * 0.5 : 0)) / 6
    let u1 = u0 + span / 6
    let v1 = v0 + span / 6

    // Tiling spends the road allowance on the parcels either side of it, so the
    // grid closes; otherwise the parcel is inset to the size actually surveyed.
    if (!opts.tile) {
      const insetU = (surveyed.pitchLat - surveyed.sizeLat) / 2 / (6 * surveyed.pitchLat)
      const insetV = (surveyed.pitchLon - surveyed.sizeLon) / 2 / (6 * surveyed.pitchLon)
      u0 += insetU
      u1 -= insetU
      v0 += insetV
      v1 -= insetV
    }

    return makeQuad(
      framePoint(frame, u0, v0),
      framePoint(frame, u0, v1),
      framePoint(frame, u1, v0),
      framePoint(frame, u1, v1),
      'survey',
    )
  }

  const southLat = townshipSouthLat(parts.township)
  // Work at the township's middle latitude: longitude degrees change with
  // latitude, and using the south edge would skew the box's east-west size.
  const midLat = southLat + TOWNSHIP_M / 2 / mPerDegLat(southLat)
  const degLat = (m: number) => m / mPerDegLat(midLat)
  const degLon = (m: number) => m / mPerDegLon(midLat)

  // A section is a sixth of its township/range — very slightly over a mile,
  // because the road allowances are inside the township, not around it.
  const secH = TOWNSHIP_M / 6
  const secW = RANGE_M / 6
  const q = quarterOffset(parts.quarter)

  // South edge: up from the township line by whole sections, then the quarter.
  const south = southLat + degLat(pos.rowFromSouth * secH + (parts.quarter ? (q.north * secH) / 2 : 0))
  const north = south + degLat(parts.quarter ? secH / 2 : secH)

  // Ranges count WEST from the meridian, and sections count west within the
  // township — so east longitude decreases as both increase.
  const rangeEast = meridianLng - degLon((parts.range - 1) * RANGE_M)
  const sectionEast = rangeEast - degLon((5 - pos.colFromWest) * secW)
  const east = sectionEast - (parts.quarter ? degLon(((1 - q.east) * secW) / 2) : 0)
  const west = east - degLon(parts.quarter ? secW / 2 : secW)

  return makeBox(south, west, north, east, 'grid')
}

// ═══════════════════════════════════════════════════════════════════════════
// Reverse: a coordinate → a legal land description
// ═══════════════════════════════════════════════════════════════════════════

export interface ReverseLld {
  parts: AtsParts
  /** Canonical text, e.g. `SW-35-68-21-W4`. Round-trips through `parseLld`. */
  text: string
  source: 'survey' | 'grid'
}

/** Section number from a grid position — the inverse of the serpentine. */
export function sectionAt(rowFromSouth: number, colFromEast: number): number {
  const posInRow = rowFromSouth % 2 === 0 ? colFromEast : 5 - colFromEast
  return rowFromSouth * 6 + posInRow + 1
}

const clamp05 = (n: number) => Math.min(5, Math.max(0, Math.floor(n)))

/** The meridian a point hangs off: the nearest one to its EAST. */
function meridianFor(lng: number): number | null {
  let best: number | null = null
  for (const key of Object.keys(MERIDIANS)) {
    const m = Number(key)
    if (MERIDIANS[m] > lng && (best === null || MERIDIANS[m] < MERIDIANS[best])) best = m
  }
  return best
}

function formatParts(p: AtsParts, granularity: Granularity): string {
  const head = granularity === 'quarter' && p.quarter ? `${p.quarter}-` : ''
  const body = granularity === 'township' ? `${p.township}-${p.range}` : `${p.section}-${p.township}-${p.range}`
  return `${head}${body}-W${p.meridian}`
}

export type Granularity = 'quarter' | 'section' | 'township'

/**
 * The legal land description covering a point — the inverse of `atsBox`.
 *
 * Used to fill in a field's LLD from its pivot, so the description is captured
 * as a by-product of dropping the pin instead of being typed from a contract.
 *
 * Same two tiers as `atsBox`, and the same caveat: this answers "which parcel
 * is this in", not "where is the boundary". A point within a few metres of a
 * section line can land on either side of it.
 */
export function reverseLld(
  p: LatLng,
  table?: TownshipTable | null,
  granularity: Granularity = 'quarter',
): ReverseLld | null {
  const meridian = meridianFor(p.lng)
  if (meridian === null) return null
  if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return null
  if (p.lat < BASE_LAT) return null

  // ── Grid estimate. Also the answer outright when there is no survey data. ──
  let township = 1
  let southLat = BASE_LAT
  while (township < 126) {
    const next = southLat + TOWNSHIP_M / mPerDegLat(southLat)
    if (next > p.lat) break
    southLat = next
    township++
  }
  const midLat = southLat + TOWNSHIP_M / 2 / mPerDegLat(southLat)
  const degLon = (m: number) => m / mPerDegLon(midLat)
  const range = Math.floor((MERIDIANS[meridian] - p.lng) / degLon(RANGE_M)) + 1

  // ── Survey tier: find the township that actually contains the point. ──────
  //
  // Searched as a small neighbourhood around the grid estimate rather than by
  // scanning all 7,196: the estimate is never more than a few hundred metres
  // out, and a township is ten kilometres across, so ±2 is far more slack than
  // it needs. A scan would work too — this just keeps a pin drag cheap.
  if (table) {
    // Solved in the same frame `atsBox` draws, so a point can never be named as
    // part of a quarter it visibly sits outside: the frames tile exactly, and a
    // point is in this township precisely when its (u, v) lands in 0–1.
    let hit: { uv: { u: number; v: number }; twp: number; rng: number } | null = null
    let nearest: { uv: { u: number; v: number }; twp: number; rng: number; d: number } | null = null
    for (let twp = township - 2; twp <= township + 2 && !hit; twp++) {
      for (let rng = range - 2; rng <= range + 2; rng++) {
        if (twp < 1 || rng < 1) continue
        const frame = townshipFrame(table, meridian, twp, rng)
        if (!frame) continue
        const uv = frameUv(frame, p)
        if (uv.u >= 0 && uv.u < 1 && uv.v >= 0 && uv.v < 1) {
          hit = { uv, twp, rng }
          break
        }
        // How far outside, so the nearest township answers when the point falls
        // in a hole in the data rather than returning nothing.
        const d =
          Math.max(0, -uv.u, uv.u - 1) + Math.max(0, -uv.v, uv.v - 1) + Math.abs(uv.u - 0.5) * 1e-6
        if (!nearest || d < nearest.d) nearest = { uv, twp, rng, d }
      }
    }
    const found = hit ?? nearest
    if (found) {
      const u = Math.min(0.999999, Math.max(0, found.uv.u))
      const v = Math.min(0.999999, Math.max(0, found.uv.v))
      const row = clamp05(u * 6)
      const col = clamp05(v * 6)
      // Halves within the section: north when past its middle, east when the
      // point is in the section's eastern half — v counts westward, so east is
      // the LOW half of v.
      const northHalf = u * 6 - row >= 0.5
      const eastHalf = v * 6 - col < 0.5
      const parts: AtsParts = {
        quarter:
          granularity === 'quarter'
            ? `${northHalf ? 'N' : 'S'}${eastHalf ? 'E' : 'W'}`
            : null,
        section: sectionAt(row, col),
        township: found.twp,
        range: found.rng,
        meridian,
      }
      return { parts, text: formatParts(parts, granularity), source: 'survey' }
    }
  }

  if (range < 1 || range > 34) return null
  const secH = TOWNSHIP_M / 6
  const secW = RANGE_M / 6
  const degLat = (m: number) => m / mPerDegLat(midLat)
  const rangeEast = MERIDIANS[meridian] - degLon((range - 1) * RANGE_M)
  const row = clamp05((p.lat - southLat) / degLat(secH))
  const col = clamp05((rangeEast - p.lng) / degLon(secW))
  const secMidLat = southLat + (row + 0.5) * degLat(secH)
  const secMidLng = rangeEast - (col + 0.5) * degLon(secW)
  const parts: AtsParts = {
    quarter: granularity === 'quarter' ? `${p.lat >= secMidLat ? 'N' : 'S'}${p.lng >= secMidLng ? 'E' : 'W'}` : null,
    section: sectionAt(row, col),
    township,
    range,
    meridian,
  }
  return { parts, text: formatParts(parts, granularity), source: 'grid' }
}

/**
 * Whether a written description and a computed one name the same parcel.
 *
 * Used to warn when a field's LLD disagrees with where its pivot actually is —
 * a pin dropped on the neighbouring field, or a transposed township and range,
 * both of which look entirely plausible written down.
 *
 * Deliberately lenient about what the written one LEAVES OUT: `35-8-21` with no
 * quarter, or no meridian, is not a contradiction of `SW-35-68-21-W4`, it is
 * less precise. Only a stated value that actually differs counts. Being strict
 * here would fire the warning on half the real fields, and a warning that cries
 * wolf gets ignored on the day it is right.
 */
export function sameParcel(
  // Accepts `parseLld`'s shape, whose optional parts are null rather than
  // absent — the whole point is that they may be missing.
  written: { quarter?: string | null; section: number; township: number; range: number; meridian?: number | null } | null,
  computed: AtsParts,
): boolean {
  if (!written) return false
  if (written.section !== computed.section) return false
  if (written.township !== computed.township) return false
  if (written.range !== computed.range) return false
  if (written.meridian != null && written.meridian !== computed.meridian) return false
  if (written.quarter && written.quarter !== computed.quarter) return false
  return true
}

/** Great-circle distance in metres. For measuring how far off we are. */
export function distanceM(a: LatLng, b: LatLng): number {
  const R = 6371008.8
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/** Whether a point falls inside a box. */
export function contains(box: AtsBox, p: LatLng): boolean {
  return (
    p.lat >= box.bounds.south &&
    p.lat <= box.bounds.north &&
    p.lng >= box.bounds.west &&
    p.lng <= box.bounds.east
  )
}

/** The box as a GeoJSON Feature, ready to hand to MapLibre. */
export function toGeoJson(box: AtsBox, label: string): GeoJSON.Feature<GeoJSON.Polygon> {
  return {
    type: 'Feature',
    properties: { label },
    geometry: {
      type: 'Polygon',
      coordinates: [box.ring.map((p) => [p.lng, p.lat] as [number, number])],
    },
  }
}
