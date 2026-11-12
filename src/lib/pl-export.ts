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
 *    stays split into the products actually bought. Which product a point put
 *    down is read differently by the two export APIs — see `productLookup`.
 *  - harvest: always a `coverage` layer (where the harvester went), plus a
 *    `yield` layer when the export has a yield column. A bean harvest is a
 *    tractor pulling a harvester and logs no yield — confirmed on the East Ranch
 *    Main export, 14 Sep 2026 — so for those fields coverage is all there is,
 *    and the yield comes from the scale tickets instead.
 */
import { FT, GridAccumulator, M_PER_DEG_LAT, M_PER_DEG_LON, type PackedCell } from './pl-grid'
import { declaredUnit, lengthToMetres } from './export-units'
import { zipRecords } from './shp-stream'

export type DeereProduct = { ProductName?: string; ProductUseHash?: string }
export type DeereAttribute = { Name?: string; Unit?: string }

/**
 * An export's `metadata.json`.
 *
 * The Operations Data Export API that replaces `/fieldOps/` keys these by the
 * index its DBF now writes, so both arrive as either a list or a map keyed by
 * index. Read them through `entriesOf`, never with `.find()`: calling an array
 * method on the map throws, and this file is the only thing standing between
 * that and the Profit/Loss Map. See docs/JD-OPERATIONS-EXPORT.md.
 */
export type DeereMetadata = {
  Products?: DeereProduct[] | Record<string, DeereProduct>
  /**
   * What a SEEDING put in the ground, indexed by its `VARIETY` column.
   *
   * A seeding carries no `Products` at all — the 25 Jun 2026 seeding of
   * 11 SE 16-1 has `Products: undefined` and
   * `Varieties: {"1": {ProductName: "Barley (Cover Crop)", ProductUseHash:
   * "c88ef020"}}`, read out of the real export on 11 Nov 2026. The export does
   * name the seed; it simply names it somewhere else, and reading only
   * `Products` is what made every seeding layer come back unnamed.
   */
  Varieties?: DeereProduct[] | Record<string, DeereProduct>
  DataAttributes?: DeereAttribute[] | Record<string, DeereAttribute>
}

/**
 * The entries of one of those fields, each with the index Deere would use to
 * point at it. An array is 1-based, matching the new DBF's `PRODUCT` values.
 */
const entriesOf = <T,>(field: T[] | Record<string, T> | undefined): [string, T][] =>
  Array.isArray(field)
    ? field.map((v, i) => [String(i + 1), v])
    : Object.entries(field ?? {})

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
  product: string | null
  /** A seeding's own product column, into `Varieties` rather than `Products`. */
  variety: string | null
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
    // The new export dropped PRODUCTHASH and writes an index into the
    // metadata's products instead. The old export has a `Product` column too,
    // holding the NAME, so this is only ever consulted when there is no hash.
    product: find(names, (n) => lower(n) === 'product'),
    // And a seeding indexes `Varieties` instead, through its own column.
    variety: find(names, (n) => lower(n) === 'variety'),
  }
}

/**
 * How to tell which product a logged point put down.
 *
 * Old export: every record carries the `ProductUseHash` itself. New export:
 * the record carries a 1-based index and the hash lives in the metadata. The
 * hash stays the grouping key either way, so a re-grid after the migration
 * does not renumber a field's layers.
 *
 * With an index we cannot resolve — no metadata, or a product missing from it
 * — the index itself becomes the key. The layer goes unnamed, but a tank mix
 * stays split into the products actually bought rather than collapsing into
 * one bucket.
 */
export function productLookup(meta: DeereMetadata | null, cols: ExportColumns) {
  // A pass is one or the other: an application indexes Products through
  // PRODUCT, a seeding indexes Varieties through VARIETY. Kept apart, because
  // both are numbered from 1 — merging them would let a seeding's variety 1
  // answer for a spray's product 1.
  const products = new Map(entriesOf(meta?.Products))
  const varieties = new Map(entriesOf(meta?.Varieties))
  const nameByHash = new Map<string, string>()
  for (const p of [...products.values(), ...varieties.values()]) {
    if (p.ProductUseHash && p.ProductName) nameByHash.set(p.ProductUseHash, p.ProductName)
  }

  /**
   * The product, when the metadata names exactly one.
   *
   * A pass that put down one product is unambiguous however the records are
   * written, and the new export does not always give a way to look it up: the
   * 25 Jun 2026 seeding of 11 SE 16-1 came back with no usable product column
   * at all, so every point fell into the `''` bucket and the layer lost both
   * the hash and the name it had under the old endpoint — which is the layer
   * the Profit/Loss prices seed by. One product in the metadata is the answer
   * for that point, so use it rather than throwing the identity away.
   */
  const named = [...products.entries(), ...varieties.entries()]
  const soleEntry = named.length === 1 ? named[0] : null
  const sole = soleEntry ? { key: soleEntry[1].ProductUseHash || soleEntry[0], name: soleEntry[1].ProductName ?? null } : null
  const unknown = sole ?? { key: '', name: null }

  // An application's column against Products, a seeding's against Varieties.
  const byColumn: [string | null, Map<string, DeereProduct>][] = [
    [cols.product, products],
    [cols.variety, varieties],
  ]

  return (rec: Record<string, string>): { key: string; name: string | null } => {
    if (cols.hash) {
      const hash = rec[cols.hash] ?? ''
      return hash ? { key: hash, name: nameByHash.get(hash) ?? null } : unknown
    }
    for (const [column, byIndex] of byColumn) {
      if (!column) continue
      // A DBF numeric field is padded text, and may be written `1` or `1.000`.
      const n = Number(rec[column])
      if (!Number.isFinite(n) || n <= 0) continue
      const index = String(n)
      const product = byIndex.get(index)
      // An index with nothing behind it still keys its own layer, so a tank
      // mix stays split into the products actually bought.
      return product ? { key: product.ProductUseHash || index, name: product.ProductName ?? null } : { key: index, name: null }
    }
    return unknown
  }
}

const unitOf = (meta: DeereMetadata | null, column: string | null) =>
  column
    ? (entriesOf(meta?.DataAttributes).find(([, a]) => a.Name?.toLowerCase() === column.toLowerCase())?.[1].Unit ??
      null)
    : null

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
  /**
   * What to multiply SWATHWIDTH and DISTANCE by to get metres. Defaults to
   * `FT`, which is what the old `/fieldOps/` endpoint sends.
   *
   * The Operations Data Export asked for in METRIC sends both in metres, and
   * `FT` then shrinks every swath by 3.28 and every step along it by 3.28
   * again. Measured on the 25 Jun 2026 seeding of 11 SE 16-1: mean coverage
   * per cell fell from 0.96–1.07 across every pass ever gridded to 0.194,
   * and the pass covered 5.9 acres where it had covered about sixty. The map
   * still draws, the point count is right and the rate is right, so nothing
   * about it looks wrong — only the dollars an acre are.
   */
  lengthToM?: number
}): Promise<{ layers: GridLayer[]; columns: ExportColumns | null; points: number; skipped: number }> {
  /*
   * The export's own answer first. `DataAttributes` names the unit of every
   * per-point column — `ft` out of the old endpoint, `m` out of the
   * Operations Data Export — so a zip of unknown age reads correctly without
   * anybody having to remember which system it was asked for. `lengthToM` is
   * the caller's fallback for an export that declares nothing, and `FT` is
   * what the old endpoint always sent.
   */
  const toM = lengthToMetres(declaredUnit(opts.meta, 'SWATHWIDTH')) ?? opts.lengthToM ?? FT
  let columns: ExportColumns | null = null
  const records = opts.records((names) => {
    columns = chooseColumns(names)
    return Object.values(columns).filter((c): c is string => Boolean(c))
  })

  const harvest = opts.operationType === 'harvest'
  const inputs = new Map<string, { acc: GridAccumulator; name: string | null }>()
  let productOf: ((rec: Record<string, string>) => { key: string; name: string | null }) | null = null
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
    const widthM = width * toM
    const distM = dist * toM
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
    // Built on the first record, because it needs the chosen columns.
    productOf ??= productLookup(opts.meta, cols)
    const { key, name } = productOf(rec)
    let input = inputs.get(key)
    if (!input) {
      input = { acc: new GridAccumulator(), name }
      inputs.set(key, input)
    }
    input.acc.addSwath(lon, lat, rate, widthM, distM, hdg)
  }

  flush()

  const cols = columns as ExportColumns | null
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
    for (const [hash, { acc, name }] of inputs) {
      if (!acc.size) continue
      layers.push({
        kind: 'input',
        product_hash: hash,
        product_name: name,
        rate_unit: unitOf(opts.meta, cols?.rate ?? null),
        cells: acc.packed(),
        point_count: acc.points,
      })
    }
  }
  return { layers, columns: cols, points, skipped }
}

export type DeereOperationProduct = { name?: string; productId?: string; productType?: string }

/**
 * The one product an operation's own Deere record names, when it names one.
 *
 * The export is not always able to say what a pass put down. The 25 Jun 2026
 * seeding of 11 SE 16-1 came back from the Operations Data Export with no
 * product column and no `Products` in its metadata, so the layer lost the hash
 * and the name it had carried under the old endpoint — and `autoInputs` prices
 * a seeding by that name, so the seed line fell to "Seed" with no price.
 *
 * The farm already holds the answer. `jd_field_operations.raw` is the Field
 * Operations API's own record, which the notice does not deprecate, and its
 * `varieties` (seeding) or `products` (application) carry a `productId` that
 * is **the same hash the old export's PRODUCTHASH column held** — `c88ef020`
 * for that seeding, byte for byte. So the identity is recovered from a source
 * that cannot drift with the export format.
 *
 * Only when there is exactly one: a tank mix has to be split by the export or
 * not at all, and guessing would put every product's acres on one of them.
 * Deere writes `---` where a product has no name, which is not a name.
 */
export function soleOperationProduct(raw: unknown): { hash: string; name: string | null } | null {
  const r = raw as { varieties?: DeereOperationProduct[]; products?: DeereOperationProduct[] } | null
  const list = [...(r?.varieties ?? []), ...(r?.products ?? [])].filter((p) => p && typeof p === 'object')
  if (list.length !== 1) return null
  const hash = typeof list[0].productId === 'string' ? list[0].productId.trim() : ''
  if (!hash) return null
  const name = typeof list[0].name === 'string' ? list[0].name.trim() : ''
  return { hash, name: name && name !== '---' ? name : null }
}

/**
 * Whether a layer's key is a real Deere product id rather than a position.
 *
 * `productLookup` keys a layer by the index in the export when it can resolve
 * nothing better, so that a tank mix stays split. An index is a position in
 * one file, not an identity: it means nothing to another pass, and it is not
 * what the price book or the old endpoint's PRODUCTHASH ever held. Deere's own
 * ids are hex and eight characters or more, so a bare one- to three-digit
 * number is a position and the operation's own record should win.
 */
export const isRealHash = (key: string | null | undefined) => Boolean(key) && !/^\d{1,3}$/.test(String(key))
