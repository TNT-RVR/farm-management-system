// Relative imports only: netlify/shared/jd-guidance.ts bundles this file, and combine-monitor.ts imports it.
import { MONITOR_NAME_MAX } from './monitor-limits'

/**
 * John Deere guidance lines for the combine display (Sam, 17 Oct 2026).
 *
 * Read from Operations Center (GET /platform/organizations/{org}/fields/
 * {field}/guidanceLines, read-only) into jd_guidance_lines. The ones whose
 * name has "Combine" in it go on the stick as polyline shapefiles, which the
 * IntelliView's Import2 reads as Source "Non-IntelliView 2", Data Type
 * MultiSwath+ — its Help says it makes lines "as an approximation of a John
 * Deere AB line".
 *
 * A Deere line (sample from jd_api_probes, 14 Sep 2026):
 *   { id, name, "@type": "ABLine", aPoint: {lat, lon}, bPoint: {lat, lon},
 *     heading, archived, saveMethod: "dtiABLineMethodBPoint",
 *     eastShift / northShift: { unit: "mm", valueAsDouble }, lastModifiedTime }
 * Curves, circles and adaptive curves were not in the sample, so they are
 * read defensively: any list of {lat, lon} points in the line is its shape,
 * and a circle with a centre and radius but no points is drawn round.
 */

export type LineType = 'ab' | 'a_plus' | 'curve' | 'circle' | 'adaptive' | 'other'

/** TYPE in the shapefile and the list. */
export const LINE_TYPE_LABELS: Record<LineType, string> = { ab: 'AB', a_plus: 'A+', curve: 'Curve', circle: 'Circle', adaptive: 'Adaptive', other: 'Other' }

/** The display approximates AB lines; these it may not take at all. */
export const MAY_NOT_IMPORT: LineType[] = ['circle', 'adaptive', 'other']

export type ParsedLine = {
  jdLineId: string
  name: string
  lineType: LineType
  jdType: string | null
  archived: boolean
  headingDeg: number | null
  /** GeoJSON LineString or MultiLineString in lon/lat, the operator's shift applied; null when nothing could be read. */
  geometry: { type: 'LineString'; coordinates: number[][] } | { type: 'MultiLineString'; coordinates: number[][][] } | null
  /** Changes whenever the line's shape, shift, name, type or archived flag does. */
  hash: string
  modifiedAt: string | null
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => Boolean(v) && typeof v === 'object' && !Array.isArray(v)
const pointOf = (v: unknown): number[] | null => (isObj(v) && Number.isFinite(Number(v.lat)) && Number.isFinite(Number(v.lon)) && v.lat != null && v.lon != null ? [Number(v.lon), Number(v.lat)] : null)

/** A measurement in metres: a bare number is taken as metres; {unit, valueAsDouble} is converted. */
function metres(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (!isObj(v)) return null
  const n = Number(v.valueAsDouble ?? v.value)
  if (!Number.isFinite(n)) return null
  const unit = String(v.unit ?? 'm').toLowerCase()
  if (unit === 'mm') return n / 1000
  if (unit === 'cm') return n / 100
  if (unit === 'ft') return n * 0.3048
  if (unit === 'in') return n * 0.0254
  return n
}

/** 64-bit FNV-1a as hex, from two 32-bit passes. Stable across browser and server. */
export function hashText(s: string): string {
  const pass = (seed: number) => {
    let h = seed >>> 0
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i)
      h = Math.imul(h, 0x01000193) >>> 0
    }
    return h.toString(16).padStart(8, '0')
  }
  return pass(0x811c9dc5) + pass(0x050c5d1f)
}

/** Every list of two or more {lat, lon} points anywhere in the line, aPoint/bPoint aside. */
function pointLists(v: unknown, depth = 0, out: number[][][] = []): number[][][] {
  if (depth > 6) return out
  if (Array.isArray(v)) {
    const pts = v.map(pointOf)
    if (v.length >= 2 && pts.every(Boolean)) out.push(pts as number[][])
    else for (const x of v) pointLists(x, depth + 1, out)
  } else if (isObj(v)) {
    for (const [k, x] of Object.entries(v)) if (k !== 'aPoint' && k !== 'bPoint' && k !== 'links') pointLists(x, depth + 1, out)
  }
  return out
}

const M_PER_DEG_LAT = 110_540
const mPerDegLon = (lat: number) => 111_320 * Math.cos((lat * Math.PI) / 180)

/** Move a point by metres east and north. */
const shift = ([lon, lat]: number[], east: number, north: number) => [lon + east / mPerDegLon(lat), lat + north / M_PER_DEG_LAT]

/** A circle as a closed polyline of 72 segments. */
function circle(center: number[], radiusM: number): number[][] {
  return Array.from({ length: 73 }, (_, i) => {
    const a = (2 * Math.PI * (i % 72)) / 72
    return shift(center, radiusM * Math.sin(a), radiusM * Math.cos(a))
  })
}

function typeOf(raw: Obj): LineType {
  const t = String(raw['@type'] ?? raw.type ?? '').toLowerCase()
  if (/abline|straight/.test(t)) {
    const method = String(raw.saveMethod ?? '').toLowerCase()
    return /heading/.test(method) || !pointOf(raw.bPoint) ? 'a_plus' : 'ab'
  }
  if (/adaptive/.test(t)) return 'adaptive'
  if (/circle|pivot/.test(t)) return 'circle'
  if (/curve/.test(t)) return 'curve'
  return 'other'
}

/** One Deere guidance line as stored here, or null when it has no id. */
export function parseDeereLine(raw: unknown): ParsedLine | null {
  if (!isObj(raw) || !raw.id) return null
  const lineType = typeOf(raw)
  const east = metres(raw.eastShift) ?? 0
  const north = metres(raw.northShift) ?? 0
  const heading = Number.isFinite(Number(raw.heading)) && raw.heading != null ? Number(raw.heading) : null
  const moved = (pts: number[][]) => pts.map((p) => shift(p, east, north))

  let parts: number[][][] = []
  if (lineType === 'ab' || lineType === 'a_plus') {
    const a = pointOf(raw.aPoint)
    let b = pointOf(raw.bPoint)
    if (a && !b && heading != null) {
      // An A point and a heading: a short stand-in B, 100 m along it. The export extends it across the field.
      const h = (heading * Math.PI) / 180
      b = shift(a, 100 * Math.sin(h), 100 * Math.cos(h))
    }
    if (a && b) parts = [[a, b]]
  } else {
    parts = pointLists(raw)
    if (!parts.length && lineType === 'circle') {
      const c = pointOf(raw.centerPoint ?? raw.center ?? raw.pivotPoint)
      const r = metres(raw.radius)
      if (c && r && r > 0) parts = [circle(c, r)]
    }
  }
  parts = parts.map(moved)
  const geometry = !parts.length ? null : parts.length === 1 ? ({ type: 'LineString', coordinates: parts[0] } as const) : ({ type: 'MultiLineString', coordinates: parts } as const)

  const name = String(raw.name ?? '').trim()
  const archived = raw.archived === true
  const round = (n: number) => Math.round(n * 1e8) / 1e8
  const hash = hashText(JSON.stringify([name, lineType, archived, heading, parts.map((p) => p.map(([x, y]) => [round(x), round(y)]))]))
  return {
    jdLineId: String(raw.id),
    name,
    lineType,
    jdType: raw['@type'] != null ? String(raw['@type']) : null,
    archived,
    headingDeg: heading,
    geometry,
    hash,
    modifiedAt: typeof raw.lastModifiedTime === 'string' ? raw.lastModifiedTime : null,
  }
}

/* ── For the combine ────────────────────────────────────────────────────── */

/** Sam marks the lines meant for the combines by putting "Combine" in the name. */
export const isCombineLine = (name: string) => /combine/i.test(name)

/** The line's own part of its name: "Combine" taken out. */
export function lineShortName(name: string): string {
  const s = name.replace(/\bcombines?\b|combine/gi, ' ').replace(/[\s_-]+$/, '').replace(/^[\s_-]+/, '').replace(/\s+/g, ' ').trim()
  return s || 'Line'
}

/**
 * "<field's monitor name> <line name without Combine>", at most 18: the line's
 * part is kept to 9 characters and the field's part is cut to make room.
 */
export function lineDisplayName(fieldMonitorName: string, lineName: string): string {
  const line = lineShortName(lineName).slice(0, 9).trimEnd()
  const room = MONITOR_NAME_MAX - line.length - 1
  const field = fieldMonitorName.slice(0, Math.max(room, 0)).replace(/[\s.,/-]+$/, '')
  return field ? `${field} ${line}` : line.slice(0, MONITOR_NAME_MAX)
}

/** How far past the boundary an extended line reaches, each end. */
export const A_PLUS_MARGIN_M = 50
/** With no boundary to measure, an extended line runs this far each way. */
export const A_PLUS_NO_BOUNDARY_M = 1000

/**
 * An A+ line (a point and a heading, no real B) as two points that cross the
 * whole field: along the heading through A, from the field's furthest point
 * behind to its furthest point ahead, plus a margin. A flat local projection
 * around A; at field size the error is centimetres.
 */
export function extendLine(a: number[], headingDeg: number, polygons: number[][][][]): number[][] {
  const h = (headingDeg * Math.PI) / 180
  const dx = Math.sin(h)
  const dy = Math.cos(h)
  const kx = mPerDegLon(a[1])
  let lo = Infinity
  let hi = -Infinity
  for (const poly of polygons)
    for (const ring of poly)
      for (const [lon, lat] of ring) {
        const t = (lon - a[0]) * kx * dx + (lat - a[1]) * M_PER_DEG_LAT * dy
        lo = Math.min(lo, t)
        hi = Math.max(hi, t)
      }
  if (lo === Infinity) {
    lo = -A_PLUS_NO_BOUNDARY_M
    hi = A_PLUS_NO_BOUNDARY_M
  } else {
    lo -= A_PLUS_MARGIN_M
    hi += A_PLUS_MARGIN_M
  }
  return [shift(a, lo * dx, lo * dy), shift(a, hi * dx, hi * dy)]
}

/** Heading of A→B, degrees clockwise from north. */
export function headingOf(a: number[], b: number[]): number {
  const e = (b[0] - a[0]) * mPerDegLon(a[1])
  const n = (b[1] - a[1]) * M_PER_DEG_LAT
  return ((Math.atan2(e, n) * 180) / Math.PI + 360) % 360
}

/** The parts to write for one stored line: AB as A→B, A+ (or an AB with A and B on top of each other) across the field. */
export function exportParts(line: { lineType: LineType; headingDeg: number | null; geometry: unknown }, boundary: number[][][][]): number[][][] {
  const g = line.geometry as { type?: string; coordinates?: unknown } | null
  if (!g || !Array.isArray(g.coordinates)) return []
  const parts = g.type === 'LineString' ? [g.coordinates as number[][]] : g.type === 'MultiLineString' ? (g.coordinates as number[][][]) : []
  if ((line.lineType === 'a_plus' || line.lineType === 'ab') && parts[0]?.length >= 2) {
    const [a, b] = parts[0]
    const short = Math.hypot((b[0] - a[0]) * mPerDegLon(a[1]), (b[1] - a[1]) * M_PER_DEG_LAT) < 10
    if (line.lineType === 'a_plus' || short) return [extendLine(a, line.headingDeg ?? headingOf(a, b), boundary)]
    return [[a, b]]
  }
  return parts.filter((p) => p.length >= 2)
}
