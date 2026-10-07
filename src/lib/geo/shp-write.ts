/**
 * A polygon shapefile, zipped — what John Deere Operations Center (and every
 * other prescription importer) takes. Written by hand because the only thing
 * needed is polygons with a few numeric attributes, and a library for that
 * would outweigh the rest of the export.
 *
 * ESRI Shapefile Technical Description (1998) for .shp/.shx; dBase III for
 * .dbf; WGS 84 geographic .prj. The zip is stored, not deflated — every
 * importer reads that.
 */

export type ShpPolygon = {
  /** Rings in lon/lat, outer ring first; holes after. Closed or not. */
  rings: number[][][]
  props: Record<string, number | string | null>
}

export type DbfField = { name: string; type: 'N' | 'C'; length: number; decimals?: number }

const WGS84_PRJ =
  'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]'

/** Twice the signed area; positive is counter-clockwise. */
function signedArea(r: number[][]): number {
  let s = 0
  for (let i = 0; i < r.length - 1; i++) s += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]
  return s
}

function closed(r: number[][]): number[][] {
  const a = r[0]
  const b = r[r.length - 1]
  return a[0] === b[0] && a[1] === b[1] ? r : [...r, a]
}

/** Shapefiles want outer rings clockwise and holes counter-clockwise. */
function orient(rings: number[][][]): number[][][] {
  return rings.map((r, i) => {
    const c = closed(r)
    const ccw = signedArea(c) > 0
    return (i === 0 ? ccw : !ccw) ? [...c].reverse() : c
  })
}

export function writeShapefile(polys: ShpPolygon[], fields: DbfField[]): { shp: Uint8Array; shx: Uint8Array; dbf: Uint8Array; prj: Uint8Array } {
  const shapes = polys.map((p) => orient(p.rings))
  const recLens = shapes.map((rings) => 44 + 4 * rings.length + 16 * rings.reduce((a, r) => a + r.length, 0))
  const shpLen = 100 + recLens.reduce((a, l) => a + 8 + l, 0)
  const shp = new DataView(new ArrayBuffer(shpLen))
  const shx = new DataView(new ArrayBuffer(100 + 8 * shapes.length))

  let xmin = Infinity, ymin = Infinity, xmax = -Infinity, ymax = -Infinity
  for (const rings of shapes)
    for (const r of rings)
      for (const [x, y] of r) {
        xmin = Math.min(xmin, x); ymin = Math.min(ymin, y); xmax = Math.max(xmax, x); ymax = Math.max(ymax, y)
      }
  if (!shapes.length) xmin = ymin = xmax = ymax = 0

  const header = (v: DataView, lengthBytes: number) => {
    v.setInt32(0, 9994, false)
    v.setInt32(24, lengthBytes / 2, false)
    v.setInt32(28, 1000, true)
    v.setInt32(32, 5, true)
    v.setFloat64(36, xmin, true)
    v.setFloat64(44, ymin, true)
    v.setFloat64(52, xmax, true)
    v.setFloat64(60, ymax, true)
  }
  header(shp, shpLen)
  header(shx, 100 + 8 * shapes.length)

  let off = 100
  shapes.forEach((rings, i) => {
    const len = recLens[i]
    shx.setInt32(100 + 8 * i, off / 2, false)
    shx.setInt32(104 + 8 * i, len / 2, false)
    shp.setInt32(off, i + 1, false)
    shp.setInt32(off + 4, len / 2, false)
    let o = off + 8
    let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity
    for (const r of rings) for (const [x, y] of r) { bx0 = Math.min(bx0, x); by0 = Math.min(by0, y); bx1 = Math.max(bx1, x); by1 = Math.max(by1, y) }
    shp.setInt32(o, 5, true)
    shp.setFloat64(o + 4, bx0, true)
    shp.setFloat64(o + 12, by0, true)
    shp.setFloat64(o + 20, bx1, true)
    shp.setFloat64(o + 28, by1, true)
    const nPts = rings.reduce((a, r) => a + r.length, 0)
    shp.setInt32(o + 36, rings.length, true)
    shp.setInt32(o + 40, nPts, true)
    o += 44
    let start = 0
    for (const r of rings) {
      shp.setInt32(o, start, true)
      o += 4
      start += r.length
    }
    for (const r of rings)
      for (const [x, y] of r) {
        shp.setFloat64(o, x, true)
        shp.setFloat64(o + 8, y, true)
        o += 16
      }
    off += 8 + len
  })

  // dBase III
  const recLen = 1 + fields.reduce((a, f) => a + f.length, 0)
  const headLen = 32 + 32 * fields.length + 1
  const dbf = new Uint8Array(headLen + recLen * polys.length + 1)
  const dv = new DataView(dbf.buffer)
  const now = new Date()
  dbf[0] = 0x03
  dbf[1] = now.getFullYear() - 1900
  dbf[2] = now.getMonth() + 1
  dbf[3] = now.getDate()
  dv.setUint32(4, polys.length, true)
  dv.setUint16(8, headLen, true)
  dv.setUint16(10, recLen, true)
  const ascii = (s: string, at: number, len: number, padLeft = false) => {
    const t = (padLeft ? s.slice(-len).padStart(len, ' ') : s.slice(0, len).padEnd(len, ' ')).replace(/[^\x20-\x7e]/g, '?')
    for (let i = 0; i < len; i++) dbf[at + i] = t.charCodeAt(i)
  }
  fields.forEach((f, i) => {
    const at = 32 + 32 * i
    const name = f.name.slice(0, 10).toUpperCase()
    for (let k = 0; k < name.length; k++) dbf[at + k] = name.charCodeAt(k)
    dbf[at + 11] = f.type.charCodeAt(0)
    dbf[at + 16] = f.length
    dbf[at + 17] = f.decimals ?? 0
  })
  dbf[headLen - 1] = 0x0d
  polys.forEach((p, r) => {
    let at = headLen + r * recLen
    dbf[at++] = 0x20
    for (const f of fields) {
      const v = p.props[f.name]
      if (f.type === 'N') ascii(v == null || v === '' ? '' : Number(v).toFixed(f.decimals ?? 0), at, f.length, true)
      else ascii(v == null ? '' : String(v), at, f.length)
      at += f.length
    }
  })
  dbf[dbf.length - 1] = 0x1a

  return { shp: new Uint8Array(shp.buffer), shx: new Uint8Array(shx.buffer), dbf, prj: new TextEncoder().encode(WGS84_PRJ) }
}

/* ------------------------------------------------------------------ zip */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** A stored (uncompressed) zip. */
export function zipStore(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder()
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0
  for (const f of files) {
    const name = enc.encode(f.name)
    const crc = crc32(f.data)
    const lh = new DataView(new ArrayBuffer(30))
    lh.setUint32(0, 0x04034b50, true)
    lh.setUint16(4, 20, true)
    lh.setUint16(8, 0, true) // stored
    lh.setUint32(14, crc, true)
    lh.setUint32(18, f.data.length, true)
    lh.setUint32(22, f.data.length, true)
    lh.setUint16(26, name.length, true)
    const local = new Uint8Array(30 + name.length + f.data.length)
    local.set(new Uint8Array(lh.buffer), 0)
    local.set(name, 30)
    local.set(f.data, 30 + name.length)
    locals.push(local)

    const ch = new DataView(new ArrayBuffer(46))
    ch.setUint32(0, 0x02014b50, true)
    ch.setUint16(4, 20, true)
    ch.setUint16(6, 20, true)
    ch.setUint32(16, crc, true)
    ch.setUint32(20, f.data.length, true)
    ch.setUint32(24, f.data.length, true)
    ch.setUint16(28, name.length, true)
    ch.setUint32(42, offset, true)
    const central = new Uint8Array(46 + name.length)
    central.set(new Uint8Array(ch.buffer), 0)
    central.set(name, 46)
    centrals.push(central)
    offset += local.length
  }
  const cdSize = centrals.reduce((a, c) => a + c.length, 0)
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true)
  end.setUint16(8, files.length, true)
  end.setUint16(10, files.length, true)
  end.setUint32(12, cdSize, true)
  end.setUint32(16, offset, true)
  const out = new Uint8Array(offset + cdSize + 22)
  let at = 0
  for (const l of locals) { out.set(l, at); at += l.length }
  for (const c of centrals) { out.set(c, at); at += c.length }
  out.set(new Uint8Array(end.buffer), at)
  return out
}

/** A prescription zip: name.shp, .shx, .dbf and .prj. */
export function prescriptionZip(base: string, polys: ShpPolygon[], fields: DbfField[]): Uint8Array {
  const f = writeShapefile(polys, fields)
  const b = base.replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 40) || 'prescription'
  return zipStore([
    { name: `${b}.shp`, data: f.shp },
    { name: `${b}.shx`, data: f.shx },
    { name: `${b}.dbf`, data: f.dbf },
    { name: `${b}.prj`, data: f.prj },
  ])
}
