/**
 * A yield monitor's shapefile (FarmTRX), gridded in the browser for the
 * Profit/Loss Map.
 *
 * WHY THE PERSON PICKS THE COLUMN. No FarmTRX export had been seen when this
 * was written, and a guessed column name that happened to be wrong would put
 * moisture or speed on the map as yield with nothing looking amiss. So the
 * columns are shown with sample values, the likeliest is pre-selected, and a
 * person confirms it.
 *
 * WHY THE UNIT MOSTLY DOES NOT MATTER. The map keeps a monitor's PATTERN and
 * scales it to the scale total (profit-loss.ts, `file` mode): the scale is what
 * got paid for, and monitors drift. So bu/ac against lb/ac washes out, and the
 * unit is only needed for a field with no scale total yet.
 *
 * Read with the same streaming readers as the Deere exports, fed from memory:
 * a monitor file is megabytes, not the gigabytes a Deere harvest runs to.
 */
import { CELL_M, GridAccumulator, M_PER_DEG_LAT, M_PER_DEG_LON, cellKey, type PackedCell } from './pl-grid'
import { dbfColumns, dbfRecords, shpPoints, zipRecords } from './shp-stream'
import { isZip, listZip, readZipMember } from './zipListing'

export type ShapefileBytes = { name: string; shp: Uint8Array; dbf: Uint8Array; prj: string | null }

async function* once(bytes: Uint8Array) {
  yield bytes
}

const stem = (n: string) => n.replace(/\.[^./\\]+$/, '').toLowerCase()
const ext = (n: string) => n.slice(n.lastIndexOf('.') + 1).toLowerCase()

/**
 * The .shp and .dbf out of what was picked: a zip, or the loose files chosen
 * together. A shapefile is several files sharing a name, and the .shp alone
 * has positions but no readings.
 */
export async function openShapefile(files: File[]): Promise<ShapefileBytes> {
  const found = new Map<string, { name: string; bytes: () => Promise<Uint8Array> }>()
  for (const f of files) {
    const bytes = new Uint8Array(await f.arrayBuffer())
    if (ext(f.name) === 'zip' || isZip(bytes)) {
      for (const e of listZip(bytes)) {
        const x = ext(e.name)
        if (['shp', 'dbf', 'prj'].includes(x) && !e.name.includes('__MACOSX')) {
          found.set(`${stem(e.name)}.${x}`, { name: e.name, bytes: () => readZipMember(bytes, e) })
        }
      }
    } else {
      found.set(`${stem(f.name)}.${ext(f.name)}`, { name: f.name, bytes: async () => bytes })
    }
  }
  const shps = [...found.keys()].filter((k) => k.endsWith('.shp'))
  if (!shps.length) throw new Error('No .shp file in what was picked. Choose the .shp and .dbf together, or the .zip.')
  // The largest layer, if a zip carries more than one (a boundary beside the points).
  let best: { key: string; size: number } | null = null
  for (const k of shps) {
    const b = await found.get(k)!.bytes()
    if (!best || b.length > best.size) best = { key: k, size: b.length }
  }
  const base = best!.key.slice(0, -4)
  const dbf = found.get(`${base}.dbf`)
  if (!dbf) throw new Error(`Found ${found.get(best!.key)!.name} but not its .dbf, which holds the yield. Pick both files.`)
  const prj = found.get(`${base}.prj`)
  return {
    name: found.get(best!.key)!.name,
    shp: await found.get(best!.key)!.bytes(),
    dbf: await dbf.bytes(),
    prj: prj ? new TextDecoder().decode(await prj.bytes()) : null,
  }
}

export type ColumnPreview = { name: string; samples: string[]; numeric: boolean }

/** Every column with a few values from it, so a person can see which is yield. */
export async function previewColumns(file: ShapefileBytes, rows = 5): Promise<ColumnPreview[]> {
  const header = file.dbf.subarray(0, new DataView(file.dbf.buffer, file.dbf.byteOffset).getUint16(8, true))
  const names = dbfColumns(header).columns.map((c) => c.name)
  const samples = new Map(names.map((n) => [n, [] as string[]]))
  let seen = 0
  // Skip the first records: a monitor's first seconds are often zeros while it fills.
  const skip = 50
  let i = 0
  for await (const rec of dbfRecords(once(file.dbf), () => names)) {
    if (i++ < skip || !rec) continue
    for (const n of names) samples.get(n)!.push(rec[n] ?? '')
    if (++seen >= rows) break
  }
  if (seen === 0) {
    // A file shorter than the skip: take it from the top.
    for await (const rec of dbfRecords(once(file.dbf), () => names)) {
      if (!rec) continue
      for (const n of names) samples.get(n)!.push(rec[n] ?? '')
      if (++seen >= rows) break
    }
  }
  return names.map((name) => {
    const s = samples.get(name)!
    return { name, samples: s, numeric: s.length > 0 && s.every((v) => v === '' || Number.isFinite(Number(v))) }
  })
}

/** The likeliest yield column: dry over wet, and never moisture or mass flow. */
export function guessYieldColumn(columns: ColumnPreview[]): string | null {
  const num = columns.filter((c) => c.numeric)
  const pick = (re: RegExp, not?: RegExp) => num.find((c) => re.test(c.name) && !(not && not.test(c.name)))?.name ?? null
  return (
    pick(/dry.*y(ie)?ld|y(ie)?ld.*dry/i) ??
    pick(/y(ie)?ld|yield/i, /wet|moist|flow|mass|vol/i) ??
    pick(/y(ie)?ld|yield/i) ??
    null
  )
}

export type GriddedYield = {
  /**
   * Yield per cell. covered = 1 where the monitor read the cell itself,
   * 0 where the value was filled from good readings nearby.
   */
  cells: PackedCell[]
  /** Where the combine cut, from every point, readings or not. */
  footprint: PackedCell[]
  points: number
  /** Points with no yield reading (zero or blank). */
  unread: number
  /** Share of the footprint with a reading of its own, and after filling. */
  measuredShare: number
  filledShare: number
  headerM: number | null
}

/** How far a good reading is allowed to speak for ground the monitor missed. */
export const FILL_RADIUS_M = 20

const numericColumn = (names: string[], re: RegExp) => names.find((n) => re.test(n)) ?? null

/**
 * The yield column on the farm grid, the way the combine actually cut it.
 *
 * EACH POINT IS A STRIP THE WIDTH OF THE HEADER. FarmTRX logs the header's
 * centre every couple of seconds; the Moreaus export carries `headerw_m`
 * (11.12 m). Dropped into single 5 m cells, a field drew as thin north-south
 * lines with bare ground between the passes. So each point is laid across the
 * header's width, square to the direction of travel worked out from the points
 * either side of it.
 *
 * NO READING IS NOT ZERO YIELD. On Moreaus 2026 the yield sensor failed for
 * two-thirds of the points: moving, cutting, and reading 0 in every yield
 * column. Those points still mark ground that was harvested — they make the
 * footprint — but they say nothing about yield. A cell with no good reading
 * takes the distance-weighted average of good readings within
 * FILL_RADIUS_M; past that it is left for the field average, which is what
 * profit-loss.ts does with a footprint cell the yield layer lacks.
 */
export async function gridYieldFile(file: ShapefileBytes, column: string): Promise<GriddedYield> {
  const header = file.dbf.subarray(0, new DataView(file.dbf.buffer, file.dbf.byteOffset).getUint16(8, true))
  const names = dbfColumns(header).columns.map((c) => c.name)
  const widthCol = numericColumn(names, /header.?w|swath|width/i)
  const widthToM = widthCol && /ft|feet/i.test(widthCol) ? 0.3048 : 1
  const timeCol = numericColumn(names, /^timestamp$|^time$/i)

  const lon: number[] = [], lat: number[] = [], y: number[] = [], w: number[] = [], t: number[] = []
  let points = 0
  let checked = false
  for await (const [pt, rec] of zipRecords(
    shpPoints(once(file.shp))[Symbol.asyncIterator](),
    dbfRecords(once(file.dbf), () => [column, ...(widthCol ? [widthCol] : []), ...(timeCol ? [timeCol] : [])])[Symbol.asyncIterator](),
  )) {
    points++
    if (!pt || !rec) continue
    if (!checked) {
      checked = true
      if (Math.abs(pt[0]) > 180 || Math.abs(pt[1]) > 90) {
        throw new Error(
          'This file is in map-projection coordinates (metres), not latitude/longitude. Export it from FarmTRX as WGS84 / lat-long and try again.',
        )
      }
    }
    lon.push(pt[0])
    lat.push(pt[1])
    y.push(Number(rec[column]))
    w.push(widthCol ? Number(rec[widthCol]) * widthToM : NaN)
    t.push(timeCol ? Number(rec[timeCol]) : NaN)
  }

  const footprint = new GridAccumulator()
  const measured = new GridAccumulator()
  let unread = 0
  const widths: number[] = []
  // Consecutive points in one pass: close in time (when the file says) and in space.
  const linked = (i: number, j: number) => {
    if (j < 0 || j >= lon.length) return false
    if (Number.isFinite(t[i]) && Number.isFinite(t[j]) && Math.abs(t[i] - t[j]) > 15) return false
    const d = Math.hypot((lon[i] - lon[j]) * M_PER_DEG_LON, (lat[i] - lat[j]) * M_PER_DEG_LAT)
    return d > 0.1 && d < 20
  }
  for (let i = 0; i < lon.length; i++) {
    const good = Number.isFinite(y[i]) && y[i] > 0
    if (!good) unread++
    // Travel from the previous point, or toward the next at the start of a pass.
    const j = linked(i, i - 1) ? i - 1 : linked(i, i + 1) ? i + 1 : -1
    let heading: number | null = null
    let distM = 3
    if (j >= 0) {
      const sign = j < i ? 1 : -1
      const dx = (lon[i] - lon[j]) * M_PER_DEG_LON * sign
      const dy = (lat[i] - lat[j]) * M_PER_DEG_LAT * sign
      distM = Math.hypot(dx, dy)
      heading = (Math.atan2(dx, dy) * 180) / Math.PI
    }
    const widthM = Number.isFinite(w[i]) && w[i] > 0 ? w[i] : CELL_M
    if (Number.isFinite(w[i]) && w[i] > 0) widths.push(w[i])
    footprint.addSwath(lon[i], lat[i], 1, widthM, distM, heading)
    if (good) measured.addSwath(lon[i], lat[i], y[i], widthM, distM, heading)
  }

  const foot = footprint.packed()
  const read = new Map(measured.packed().map((c) => [cellKey(c[0], c[1]), c[2]]))
  const R = Math.ceil(FILL_RADIUS_M / CELL_M)
  const cells: PackedCell[] = []
  let filled = 0
  for (const [gx, gy] of foot) {
    const own = read.get(cellKey(gx, gy))
    if (own != null) {
      cells.push([gx, gy, own, 1])
      continue
    }
    let s = 0, ws = 0
    for (let dy = -R; dy <= R; dy++)
      for (let dx = -R; dx <= R; dx++) {
        const d2 = dx * dx + dy * dy
        if (!d2 || d2 > R * R) continue
        const v = read.get(cellKey(gx + dx, gy + dy))
        if (v == null) continue
        s += v / d2
        ws += 1 / d2
      }
    if (ws > 0) {
      cells.push([gx, gy, Math.round((s / ws) * 1e4) / 1e4, 0])
      filled++
    }
  }
  widths.sort((a, b) => a - b)
  return {
    cells,
    footprint: foot,
    points,
    unread,
    measuredShare: foot.length ? read.size / foot.length : 0,
    filledShare: foot.length ? (read.size + filled) / foot.length : 0,
    headerM: widths.length ? widths[Math.floor(widths.length / 2)] : null,
  }
}
