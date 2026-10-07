/**
 * One Deere export, gridded for the Profit/Loss Map.
 *
 * Pure: it takes the two record streams and the export's metadata and returns
 * layers, so the Netlify function only fetches and stores, and this is tested
 * without Deere.
 *
 * WHAT COMES OUT, BY OPERATION:
 *  - seeding and application: an `input` layer per product (Deere's
 *    ProductUseHash), with the applied rate in each cell. A tank mix therefore
 *    stays split into the products actually bought.
 *  - harvest: always a `coverage` layer (where the harvester went), plus a
 *    `yield` layer when the export has a yield column. A bean harvest is a
 *    tractor pulling a harvester and logs no yield — confirmed on the East Ranch
 *    Main export, 14 Sep 2026 — so for those fields coverage is all there is,
 *    and the yield comes from the scale tickets instead.
 */
import { FT, GridAccumulator, M_PER_DEG_LAT, M_PER_DEG_LON, type PackedCell } from './pl-grid'
import { zipRecords } from './shp-stream'

export type DeereMetadata = {
  Products?: { ProductName?: string; ProductUseHash?: string }[]
  DataAttributes?: { Name?: string; Unit?: string }[]
}

export type GridLayer = {
  kind: 'input' | 'yield' | 'coverage'
  product_hash: string
  product_name: string | null
  rate_unit: string | null
  cells: PackedCell[]
  point_count: number
}

export type ExportColumns = {
  rate: string | null
  yield: string | null
  width: string | null
  distance: string | null
  heading: string | null
  hash: string | null
}

const find = (names: string[], test: (n: string) => boolean) => names.find((n) => test(n)) ?? null

/**
 * Which columns to read, chosen from what the export actually has.
 *
 * The applied rate is `AppliedRate` on every seeding and spray export seen so
 * far. TargetRate and ControlRate are what the monitor was ASKED for, not what
 * went down, and must not stand in for it.
 *
 * Yield is matched loosely because Deere names it by machine and none of this
 * farm's harvests has had one yet: dry yield is preferred over wet, since the
 * scale weighs dry-ish grain and the price is for it.
 */
export function chooseColumns(names: string[]): ExportColumns {
  const lower = (n: string) => n.toLowerCase()
  return {
    rate:
      find(names, (n) => lower(n) === 'appliedrate') ??
      find(names, (n) => /rate/i.test(n) && !/target|control/i.test(n)),
    yield:
      find(names, (n) => /dry.*yield|yield.*dry|vryieldvol/i.test(n)) ??
      find(names, (n) => /yield|yld/i.test(n) && !/wet/i.test(n)) ??
      find(names, (n) => /yield/i.test(n)),
    width: find(names, (n) => lower(n) === 'swathwidth'),
    distance: find(names, (n) => lower(n) === 'distance'),
    heading: find(names, (n) => lower(n) === 'heading'),
    hash: find(names, (n) => lower(n) === 'producthash'),
  }
}

const unitOf = (meta: DeereMetadata | null, column: string | null) =>
  column ? (meta?.DataAttributes?.find((a) => a.Name?.toLowerCase() === column.toLowerCase())?.Unit ?? null) : null

/**
 * Grid one export.
 *
 * `openDbf` is given the column chooser so the caller can hand it to the
 * streaming reader; the chosen columns come back through `onColumns` for the
 * note written beside the layers.
 */
export async function gridExport(opts: {
  operationType: string
  points: AsyncIterator<[number, number] | null>
  records: (choose: (names: string[]) => string[]) => AsyncIterator<Record<string, string> | null>
  meta: DeereMetadata | null
}): Promise<{ layers: GridLayer[]; columns: ExportColumns | null; points: number; skipped: number }> {
  let columns: ExportColumns | null = null
  const records = opts.records((names) => {
    columns = chooseColumns(names)
    return Object.values(columns).filter((c): c is string => Boolean(c))
  })

  const harvest = opts.operationType === 'harvest'
  const inputs = new Map<string, GridAccumulator>()
  const coverage = new GridAccumulator()
  const yields = new GridAccumulator()
  let points = 0
  let skipped = 0

  /**
   * A harvester logs one record per header SECTION, every one at the same
   * GPS position, each only a section wide. Taken one at a time, no record was
   * wider than a 5 m cell, nothing got spread, and every pass piled into a
   * single column of cells: #5's bean harvest drew as stripes with gaps of
   * one to six cells between them. So records at one position are gathered
   * into one strip, the header's full width, and laid out across the pass.
   */
  let group: { lon: number; lat: number; widthM: number; distM: number; hdg: number | null; yArea: number; yWidth: number } | null = null
  let lastPos: [number, number] | null = null
  const flush = () => {
    if (!group) return
    let hdg = group.hdg
    // No heading logged: take it from the last position, as the FarmTRX reader does.
    if (hdg == null && lastPos) {
      const dx = (group.lon - lastPos[0]) * M_PER_DEG_LON
      const dy = (group.lat - lastPos[1]) * M_PER_DEG_LAT
      if (Math.hypot(dx, dy) > 0.1) hdg = (Math.atan2(dx, dy) * 180) / Math.PI
    }
    coverage.addSwath(group.lon, group.lat, 1, group.widthM, group.distM, hdg)
    if (group.yWidth > 0) yields.addSwath(group.lon, group.lat, group.yArea / group.yWidth, group.yWidth, group.distM, hdg)
    lastPos = [group.lon, group.lat]
    group = null
  }

  for await (const [pt, rec] of zipRecords(opts.points, records)) {
    points++
    const cols = columns as ExportColumns | null
    if (!pt || !rec || !cols) {
      skipped++
      continue
    }
    const width = cols.width ? Number(rec[cols.width]) : NaN
    const dist = cols.distance ? Number(rec[cols.distance]) : NaN
    const widthM = width * FT
    const distM = dist * FT
    const heading = cols.heading ? Number(rec[cols.heading]) : NaN
    const hdg = Number.isFinite(heading) ? heading : null
    if (!(widthM * distM > 0)) {
      // Standing still, or a record with no swath: it covered no ground.
      skipped++
      continue
    }
    const [lon, lat] = pt
    if (harvest) {
      if (!group || group.lon !== lon || group.lat !== lat) {
        flush()
        group = { lon, lat, widthM: 0, distM, hdg, yArea: 0, yWidth: 0 }
      }
      group.widthM += widthM
      group.distM = Math.max(group.distM, distM)
      if (group.hdg == null) group.hdg = hdg
      if (cols.yield) {
        const y = Number(rec[cols.yield])
        if (Number.isFinite(y) && y >= 0) {
          group.yArea += y * widthM
          group.yWidth += widthM
        }
      }
      continue
    }
    if (!cols.rate) {
      skipped++
      continue
    }
    const rate = Number(rec[cols.rate])
    if (!Number.isFinite(rate) || rate < 0) {
      skipped++
      continue
    }
    const hash = cols.hash ? (rec[cols.hash] ?? '') : ''
    let acc = inputs.get(hash)
    if (!acc) {
      acc = new GridAccumulator()
      inputs.set(hash, acc)
    }
    acc.addSwath(lon, lat, rate, widthM, distM, hdg)
  }

  flush()

  const cols = columns as ExportColumns | null
  const nameOf = (hash: string) => opts.meta?.Products?.find((p) => p.ProductUseHash === hash)?.ProductName ?? null
  const layers: GridLayer[] = []
  if (harvest) {
    if (coverage.size)
      layers.push({ kind: 'coverage', product_hash: '', product_name: null, rate_unit: null, cells: coverage.packed(), point_count: coverage.points })
    if (yields.size)
      layers.push({
        kind: 'yield',
        product_hash: '',
        product_name: null,
        rate_unit: unitOf(opts.meta, cols?.yield ?? null),
        cells: yields.packed(),
        point_count: yields.points,
      })
  } else {
    for (const [hash, acc] of inputs) {
      if (!acc.size) continue
      layers.push({
        kind: 'input',
        product_hash: hash,
        product_name: nameOf(hash),
        rate_unit: unitOf(opts.meta, cols?.rate ?? null),
        cells: acc.packed(),
        point_count: acc.points,
      })
    }
  }
  return { layers, columns: cols, points, skipped }
}
