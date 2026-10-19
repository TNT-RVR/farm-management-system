import type { BoundaryItem } from './combine-monitor'

/**
 * The same fields as an ISOXML task file (ISO 11783-10), so the display can
 * make the Grower, Farms and Fields itself instead of someone typing them
 * (Sam, 19 Oct 2026). Written as TASKDATA/TASKDATA.XML at the top of the
 * stick, beside the Shapefile folder.
 *
 * Modelled on what combine #2's IntelliView IV (V30.26) wrote on Export:
 * CTR = grower, FRM = farm, PFD = field, and its guidance lines as GGP/GPN
 * with an LSG of type 5 holding A (PNT 6) and B (PNT 7). Boundaries are the
 * standard PLN type 1 with an exterior LSG (1) and holes (2). Whether this
 * display imports a TASKDATA file is not known yet: it is tried once in the
 * cab, and the shapefiles stay as the way that is known to work.
 */

/** Points as written: [lon, lat] from GeoJSON, nine decimals as the display writes them. */
type Pt = number[]
type LinePart = Pt[]

export type IsoLine = { name: string; parts: LinePart[]; curve: boolean }
export type IsoField = Pick<BoundaryItem, 'monitorName' | 'farm' | 'grower' | 'acres' | 'geometry'> & { lines: IsoLine[] }

const M2_PER_ACRE = 4046.8564224

/** A Polygon's or MultiPolygon's rings (GeoJSON), as lib/combine-monitor.ts reads them. */
function polygonsOf(geometry: unknown): number[][][][] {
  const g = geometry as { type?: string; coordinates?: unknown } | null
  if (!g || !Array.isArray(g.coordinates)) return []
  if (g.type === 'Polygon') return [g.coordinates as number[][][]]
  if (g.type === 'MultiPolygon') return g.coordinates as number[][][][]
  return []
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const deg = (n: number) => n.toFixed(9)
const pnt = (type: number, p: Pt) => `<PNT A="${type}" C="${deg(p[1])}" D="${deg(p[0])}" />`

/** A closed ring without its repeated last point (ISOXML rings close themselves). */
const openRing = (ring: Pt[]) => (ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? ring.slice(0, -1) : ring)

function boundaryXml(geometry: unknown, areaM2: number, indent: string): string[] {
  const out: string[] = []
  for (const poly of polygonsOf(geometry)) {
    out.push(`${indent}<PLN A="1"${areaM2 > 0 ? ` C="${Math.round(areaM2)}"` : ''} >`)
    poly.forEach((ring, i) => {
      const pts = openRing(ring)
      if (pts.length < 3) return
      out.push(`${indent}\t<LSG A="${i === 0 ? 1 : 2}" >`)
      for (const p of pts) out.push(`${indent}\t\t${pnt(2, p)}`)
      out.push(`${indent}\t</LSG>`)
    })
    out.push(`${indent}</PLN>`)
  }
  return out
}

/** A guidance line: AB as A and B; a curve as A, its middle points (9) and B. */
function lineXml(line: IsoLine, ggp: number, gpn: number, indent: string): string[] {
  const part = line.parts.find((p) => p.length >= 2)
  if (!part) return []
  const name = esc(line.name)
  const pts = line.curve ? part : [part[0], part[part.length - 1]]
  return [
    `${indent}<GGP A="GGP${ggp}" B="${name}" >`,
    `${indent}\t<GPN A="GPN${gpn}" B="${name}" C="${line.curve ? 3 : 1}" E="1" F="1" >`,
    `${indent}\t\t<LSG A="5" >`,
    ...pts.map((p, i) => `${indent}\t\t\t${pnt(i === 0 ? 6 : i === pts.length - 1 ? 7 : 9, p)}`),
    `${indent}\t\t</LSG>`,
    `${indent}\t</GPN>`,
    `${indent}</GGP>`,
  ]
}

/** TASKDATA.XML for these fields: one CTR per grower, one FRM per farm, one PFD per field. Pure. */
export function taskDataXml(fields: IsoField[], opts: { appName?: string } = {}): string {
  const ctrs = new Map<string, number>()
  const frms = new Map<string, { id: number; ctr: number; name: string }>()
  const ctrOf = (g: string) => {
    if (!ctrs.has(g)) ctrs.set(g, ctrs.size + 1)
    return ctrs.get(g)!
  }
  const frmOf = (g: string, f: string) => {
    const key = `${g}\u0000${f}`
    if (!frms.has(key)) frms.set(key, { id: frms.size + 1, ctr: ctrOf(g), name: f })
    return frms.get(key)!
  }

  const body: string[] = []
  let ggp = 0
  let gpn = 0
  fields.forEach((f, i) => {
    const grower = (f.grower ?? '').trim() || (f.farm ?? '').trim() || 'Grower'
    const ctr = ctrOf(grower)
    const farm = (f.farm ?? '').trim()
    const frm = farm ? frmOf(grower, farm) : null
    const area = (f.acres ?? 0) * M2_PER_ACRE
    body.push(`\t<PFD A="PFD${i + 1}" C="${esc(f.monitorName)}" D="${Math.max(0, Math.round(area))}" E="CTR${ctr}"${frm ? ` F="FRM${frm.id}"` : ''} >`)
    body.push(...boundaryXml(f.geometry, area, '\t\t'))
    for (const l of f.lines) body.push(...lineXml(l, ++ggp, ++gpn, '\t\t'))
    body.push('\t</PFD>')
  })

  const app = esc(opts.appName ?? 'Farm app')
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<ISO11783_TaskData VersionMajor="3" VersionMinor="0" ManagementSoftwareManufacturer="${app}" ManagementSoftwareVersion="1" DataTransferOrigin="1" >`,
    ...[...ctrs.entries()].map(([name, id]) => `\t<CTR A="CTR${id}" B="${esc(name)}" />`),
    ...[...frms.values()].map((f) => `\t<FRM A="FRM${f.id}" B="${esc(f.name)}" I="CTR${f.ctr}" />`),
    ...body,
    '</ISO11783_TaskData>',
    '',
  ].join('\r\n')
}
