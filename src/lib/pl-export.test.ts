import { describe, expect, it } from 'vitest'
import { chooseColumns, gridExport, isRealHash, productLookup, soleOperationProduct } from './pl-export'
import { CELL_M2, DLAT, DLON, FT, GridAccumulator, cellOf, centreOf } from './pl-grid'
import { dbfRecords, shpPoints } from './shp-stream'
import { dbf, shp } from './__fixtures__/shapefile'

/** Feeds bytes in awkward sizes, so every record straddles a chunk boundary somewhere. */
async function* chunked(bytes: Uint8Array, size = 7) {
  for (let i = 0; i < bytes.length; i += size) yield bytes.subarray(i, i + size)
}

const collect = async <T>(it: AsyncIterable<T>) => {
  const out: T[] = []
  for await (const x of it) out.push(x)
  return out
}

describe('shpPoints', () => {
  it('reads every point across chunk boundaries, nulls included', async () => {
    const pts = await collect(shpPoints(chunked(shp([[-113.3, 52.4], null, [-113.2, 52.3]]))))
    expect(pts).toEqual([[-113.3, 52.4], null, [-113.2, 52.3]])
  })
})

describe('dbfRecords', () => {
  it('returns chosen columns and keeps deleted records in place as null', async () => {
    const bytes = dbf(['A', 'B'], [['1', 'x'], null, ['3', 'z']])
    const recs = await collect(dbfRecords(chunked(bytes, 5), () => ['B']))
    expect(recs).toEqual([{ B: 'x' }, null, { B: 'z' }])
  })
})

describe('chooseColumns', () => {
  it('takes the applied rate, never the target or control rate', () => {
    const c = chooseColumns(['TargetRate', 'ControlRate', 'AppliedRate', 'SWATHWIDTH', 'DISTANCE', 'PRODUCTHASH'])
    expect(c).toEqual({ rate: 'AppliedRate', yield: null, width: 'SWATHWIDTH', distance: 'DISTANCE', heading: null, hash: 'PRODUCTHASH', product: null, variety: null })
  })
  it('finds the new export’s PRODUCT index, and the old export’s hash in preference to its name column', () => {
    // The new export: no hash column at all, a numeric index instead.
    expect(chooseColumns(['APPLIEDRATE', 'SWATHWIDTH', 'DISTANCE', 'PRODUCT']).product).toBe('PRODUCT')
    // The old export carries both, and `Product` there is the NAME.
    const old = chooseColumns(['AppliedRate', 'SWATHWIDTH', 'DISTANCE', 'Product', 'PRODUCTHASH'])
    expect(old.hash).toBe('PRODUCTHASH')
    expect(old.product).toBe('Product')
  })
  it('prefers a dry yield over a wet one', () => {
    expect(chooseColumns(['WetYield', 'DryYield']).yield).toBe('DryYield')
  })
  it('finds no yield in a bean harvest export', () => {
    const beans = ['DISTANCE', 'SWATHWIDTH', 'SECTIONID', 'Crop', 'Time', 'Heading', 'Elevation', 'FUEL', 'VEHICLSPEED', 'DRYMATTER']
    expect(chooseColumns(beans).yield).toBeNull()
  })
})

describe('productLookup', () => {
  const newShape = { rate: null, yield: null, width: null, distance: null, heading: null, hash: null, product: 'PRODUCT', variety: null }
  const oldShape = { ...newShape, hash: 'PRODUCTHASH', product: 'Product' }

  it('takes the hash straight off an old export record, ignoring its name column', () => {
    const resolve = productLookup({ Products: [{ ProductName: 'Liberty', ProductUseHash: 'abc' }] }, oldShape)
    expect(resolve({ PRODUCTHASH: 'abc', Product: 'something else' })).toEqual({ key: 'abc', name: 'Liberty' })
  })

  it('resolves the new export’s index through the Products map to the same hash', () => {
    const resolve = productLookup(
      { Products: { '1': { ProductName: 'Liberty', ProductUseHash: 'abc' }, '2': { ProductName: 'LI 700', ProductUseHash: 'def' } } },
      newShape,
    )
    expect(resolve({ PRODUCT: '1' })).toEqual({ key: 'abc', name: 'Liberty' })
    expect(resolve({ PRODUCT: '2' })).toEqual({ key: 'def', name: 'LI 700' })
  })

  it('reads a 1-based index off an array of products too', () => {
    const resolve = productLookup({ Products: [{ ProductName: 'Liberty', ProductUseHash: 'abc' }] }, newShape)
    expect(resolve({ PRODUCT: '1' })).toEqual({ key: 'abc', name: 'Liberty' })
  })

  it('accepts the padded and decimal forms a DBF numeric field can hold', () => {
    const resolve = productLookup({ Products: { '2': { ProductUseHash: 'def' } } }, newShape)
    for (const raw of ['2', '2.000', '2.0']) expect(resolve({ PRODUCT: raw }).key).toBe('def')
  })

  it('keeps products apart by index when the metadata cannot name them', () => {
    // No metadata at all: the layers go unnamed, but a tank mix stays split.
    const resolve = productLookup(null, newShape)
    expect(resolve({ PRODUCT: '1' })).toEqual({ key: '1', name: null })
    expect(resolve({ PRODUCT: '2' })).toEqual({ key: '2', name: null })
  })

  it('gives one empty key when the record has no product at all', () => {
    const resolve = productLookup(null, newShape)
    const none: Record<string, string>[] = [{}, { PRODUCT: '' }, { PRODUCT: '0' }]
    for (const rec of none) expect(resolve(rec).key).toBe('')
  })

  /*
   * The 25 Jun 2026 seeding of 11 SE 16-1 came back from the new export with
   * no usable product column at all, so every point fell into the '' bucket
   * and the layer lost the hash and the name it had carried under the old
   * endpoint — the layer the Profit/Loss prices seed by. One product in the
   * metadata is the answer for every point in the pass.
   */
  it('falls back to the only product the metadata names', () => {
    const meta = { Products: { '1': { ProductName: 'Barley (Cover Crop)', ProductUseHash: 'c88ef020' } } }
    const noColumn = { ...newShape, product: null }
    expect(productLookup(meta, noColumn)({})).toEqual({ key: 'c88ef020', name: 'Barley (Cover Crop)' })
    expect(productLookup(meta, newShape)({ PRODUCT: '0' })).toEqual({ key: 'c88ef020', name: 'Barley (Cover Crop)' })
    // An old export whose hash column is there but empty on this record.
    expect(productLookup(meta, oldShape)({ PRODUCTHASH: '' })).toEqual({ key: 'c88ef020', name: 'Barley (Cover Crop)' })
  })

  it('will not guess when the metadata names more than one', () => {
    const meta = { Products: { '1': { ProductUseHash: 'abc' }, '2': { ProductUseHash: 'def' } } }
    expect(productLookup(meta, { ...newShape, product: null })({}).key).toBe('')
  })

  it('still keys the sole product by its index when it carries no hash', () => {
    const meta = { Products: { '1': { ProductName: 'Barley' } } }
    expect(productLookup(meta, { ...newShape, product: null })({})).toEqual({ key: '1', name: 'Barley' })
  })
})

describe('a seeding names its seed in Varieties', () => {
  /*
   * Read straight out of the real export on 11 Nov 2026: the 25 Jun seeding of
   * 11 SE 16-1 has `Products: undefined`, a `VARIETY` column reading "1", and
   * `Varieties: {"1": {ProductName: "Barley (Cover Crop)", ProductUseHash:
   * "c88ef020"}}`. The export does name the seed — it names it somewhere else,
   * and reading only `Products` is what made every seeding layer come back
   * with no hash and no name.
   */
  const seedShape = { rate: null, yield: null, width: null, distance: null, heading: null, hash: null, product: null, variety: 'VARIETY' }
  const meta = { Varieties: { '1': { ProductName: 'Barley (Cover Crop)', ProductUseHash: 'c88ef020' } } }

  it('finds the VARIETY column', () => {
    expect(chooseColumns(['DISTANCE', 'SWATHWIDTH', 'VARIETY', 'FUEL']).variety).toBe('VARIETY')
  })

  it('resolves the index through Varieties, to the hash the old export stored', () => {
    expect(productLookup(meta, seedShape)({ VARIETY: '1' })).toEqual({ key: 'c88ef020', name: 'Barley (Cover Crop)' })
  })

  it('keeps a two-variety seeding apart', () => {
    const two = { Varieties: { '1': { ProductUseHash: 'aaa' }, '2': { ProductUseHash: 'bbb' } } }
    const resolve = productLookup(two, seedShape)
    expect(resolve({ VARIETY: '1' }).key).toBe('aaa')
    expect(resolve({ VARIETY: '2' }).key).toBe('bbb')
  })

  it('still prefers PRODUCT where a pass carries both', () => {
    const both = { Products: { '1': { ProductUseHash: 'spray' } }, Varieties: { '1': { ProductUseHash: 'seed' } } }
    const shape = { ...seedShape, product: 'PRODUCT' }
    expect(productLookup(both, shape)({ PRODUCT: '1', VARIETY: '1' }).key).toBe('spray')
  })
})

describe('soleOperationProduct', () => {
  // The real record for the 25 Jun 2026 seeding of 11 SE 16-1. Its productId
  // is byte for byte the hash the old export's PRODUCTHASH column held.
  const seeding = { varieties: [{ name: 'Barley (Cover Crop)', brand: '---', productId: 'c88ef020', productType: 'SEED' }] }

  it('reads a seeding’s one variety, hash and all', () => {
    expect(soleOperationProduct(seeding)).toEqual({ hash: 'c88ef020', name: 'Barley (Cover Crop)' })
  })

  it('reads an application’s one product, and --- is not a name', () => {
    const spray = { products: [{ name: '---', productId: '3e2d9c87', productType: 'CHEMICAL' }] }
    expect(soleOperationProduct(spray)).toEqual({ hash: '3e2d9c87', name: null })
  })

  it('will not guess for a tank mix, or where there is nothing to read', () => {
    expect(soleOperationProduct({ products: [{ productId: 'a' }, { productId: 'b' }] })).toBeNull()
    expect(soleOperationProduct({ varieties: [], products: [] })).toBeNull()
    expect(soleOperationProduct({ products: [{ name: 'No id' }] })).toBeNull()
    expect(soleOperationProduct(null)).toBeNull()
    expect(soleOperationProduct('not an object')).toBeNull()
  })
})

describe('isRealHash', () => {
  it('tells a Deere product id from a position in one export', () => {
    // Real ids, including the short form and one that is all digits.
    for (const k of ['c88ef020', '3e2d9c87', '6787cc440e0b118bc6e472d0ff8f3bd3', '40293847']) {
      expect(isRealHash(k)).toBe(true)
    }
    // A PRODUCT index means nothing outside the file it came from.
    for (const k of ['1', '2', '12', '999', '', null, undefined]) expect(isRealHash(k)).toBe(false)
  })
})

describe('gridExport', () => {
  // Two points in one cell, one in the next, all from the same planter.
  const [lon, lat] = centreOf(-20000, 30000)
  const pts: [number, number][] = [
    [lon, lat],
    [lon + DLON * 0.2, lat],
    [lon + DLON, lat],
  ]
  const names = ['AppliedRate', 'SWATHWIDTH', 'DISTANCE', 'PRODUCTHASH']

  it('area-weights the rate and reports coverage against the cell', async () => {
    const rows = [
      ['100', '10', '10', 'seed'],
      ['200', '10', '30', 'seed'],
      ['150', '10', '10', 'seed'],
    ]
    const res = await gridExport({
      operationType: 'seeding',
      points: shpPoints(chunked(shp(pts)))[Symbol.asyncIterator](),
      records: (choose) => dbfRecords(chunked(dbf(names, rows)), choose)[Symbol.asyncIterator](),
      meta: { Products: [{ ProductName: 'Pinto seed', ProductUseHash: 'seed' }], DataAttributes: [{ Name: 'AppliedRate', Unit: 'lb1ac-1' }] },
    })
    expect(res.layers).toHaveLength(1)
    const layer = res.layers[0]
    expect(layer).toMatchObject({ kind: 'input', product_name: 'Pinto seed', rate_unit: 'lb1ac-1', point_count: 3 })

    const first = layer.cells.find(([gx, gy]) => gx === -20000 && gy === 30000)!
    const a1 = 10 * FT * 10 * FT
    const a2 = 10 * FT * 30 * FT
    // (100·a1 + 200·a2) / (a1 + a2) = 175 when a2 = 3·a1.
    expect(first[2]).toBeCloseTo(175, 3)
    expect(first[3]).toBeCloseTo((a1 + a2) / CELL_M2, 3)
    expect(cellOf(...pts[2])).toEqual([-19999, 30000])
  })

  /*
   * The unit the UOM header moves that nothing else would catch. Asked for in
   * METRIC, SWATHWIDTH and DISTANCE arrive in metres; multiplied by FT anyway,
   * the 25 Jun seeding covered 5.9 acres where it had covered about sixty,
   * with the same point count, the same rate and a map that still drew.
   */
  it('reads the lengths in the unit they were asked for', async () => {
    const rows = [['100', '10', '10', 'seed']]
    const run = (lengthToM?: number) =>
      gridExport({
        operationType: 'seeding',
        points: shpPoints(chunked(shp([pts[0]])))[Symbol.asyncIterator](),
        records: (choose) => dbfRecords(chunked(dbf(names, rows)), choose)[Symbol.asyncIterator](),
        meta: null,
        lengthToM,
      })

    const feet = await run()
    const metres = await run(1)
    const coveredOf = (r: Awaited<ReturnType<typeof run>>) => r.layers[0].cells[0][3]

    // Packed cells carry a rounded fraction, so these are compared loosely.
    expect(coveredOf(feet)).toBeCloseTo((10 * FT * 10 * FT) / CELL_M2, 3)
    expect(coveredOf(metres)).toBeCloseTo((10 * 10) / CELL_M2, 3)
    // Not a rounding difference: an order of magnitude of covered ground.
    expect(coveredOf(metres) / coveredOf(feet)).toBeCloseTo(1 / (FT * FT), 1)
  })

  it('believes the export over the caller about its own lengths', async () => {
    // The caller says feet; the file says metres. The file wins, because a zip
    // on disk carries no memory of which system it was asked for.
    const rows = [['100', '10', '10', 'seed']]
    const res = await gridExport({
      operationType: 'seeding',
      points: shpPoints(chunked(shp([pts[0]])))[Symbol.asyncIterator](),
      records: (choose) => dbfRecords(chunked(dbf(names, rows)), choose)[Symbol.asyncIterator](),
      meta: { DataAttributes: [{ Name: 'SWATHWIDTH', Unit: 'm' }, { Name: 'DISTANCE', Unit: 'm' }] },
      lengthToM: FT,
    })
    expect(res.layers[0].cells[0][3]).toBeCloseTo((10 * 10) / CELL_M2, 3)
  })

  it('keeps the products of a tank mix apart', async () => {
    const rows = [
      ['1', '10', '10', 'a'],
      ['2', '10', '10', 'b'],
      ['1', '10', '10', 'a'],
    ]
    const res = await gridExport({
      operationType: 'application',
      points: shpPoints(chunked(shp(pts)))[Symbol.asyncIterator](),
      records: (choose) => dbfRecords(chunked(dbf(names, rows)), choose)[Symbol.asyncIterator](),
      meta: null,
    })
    expect(res.layers.map((l) => l.product_hash).sort()).toEqual(['a', 'b'])
  })

  it('keeps a tank mix apart and names it from a NEW-format export', async () => {
    // PRODUCTHASH is gone; PRODUCT holds a 1-based index into a Products map.
    const cols = ['APPLIEDRATE', 'SWATHWIDTH', 'DISTANCE', 'PRODUCT']
    const rows = [
      ['1', '10', '10', '1'],
      ['2', '10', '10', '2'],
      ['1', '10', '10', '1'],
    ]
    const res = await gridExport({
      operationType: 'application',
      points: shpPoints(chunked(shp(pts)))[Symbol.asyncIterator](),
      records: (choose) => dbfRecords(chunked(dbf(cols, rows)), choose)[Symbol.asyncIterator](),
      // Shapes and values taken from a real export of the 5 Oct 2026 spray
      // on 5 SW 27-11, asked for with Accept-UOM-System: METRIC. Note
      // DataAttributes arrives as a map too, so reading it with .find()
      // would not degrade — it would throw.
      meta: {
        Products: {
          '1': { ProductName: 'round up(0.9L)/LI700 0.25%', ProductUseHash: '6787cc440e0b118bc6e472d0ff8f3bd3' },
          '2': { ProductName: 'LI700 0.25%', ProductUseHash: 'b6dfadf30119a1e4c0d2ab3f55e7719c' },
        },
        DataAttributes: { '1': { Name: 'APPLIEDRATE', Unit: 'l1ha-1' } },
      },
    })
    expect(res.layers.map((l) => [l.product_hash, l.product_name, l.point_count]).sort()).toEqual([
      ['6787cc440e0b118bc6e472d0ff8f3bd3', 'round up(0.9L)/LI700 0.25%', 2],
      ['b6dfadf30119a1e4c0d2ab3f55e7719c', 'LI700 0.25%', 1],
    ])
    // The unit still resolves, though DataAttributes arrived as a map.
    expect(res.layers[0].rate_unit).toBe('l1ha-1')
  })

  it('makes a coverage layer, and no yield layer, from a harvest without a yield column', async () => {
    const rows = [
      ['10', '10'],
      ['10', '0'], // standing still: no ground covered
      ['10', '10'],
    ]
    const res = await gridExport({
      operationType: 'harvest',
      points: shpPoints(chunked(shp(pts)))[Symbol.asyncIterator](),
      records: (choose) => dbfRecords(chunked(dbf(['SWATHWIDTH', 'DISTANCE'], rows)), choose)[Symbol.asyncIterator](),
      meta: null,
    })
    expect(res.layers.map((l) => l.kind)).toEqual(['coverage'])
    expect(res.skipped).toBe(1)
    expect(res.layers[0].cells).toHaveLength(2)
  })

  it('grids yield where the harvest logged it', async () => {
    const rows = [
      ['10', '10', '50'],
      ['10', '10', '70'],
      ['10', '10', '60'],
    ]
    const res = await gridExport({
      operationType: 'harvest',
      points: shpPoints(chunked(shp(pts)))[Symbol.asyncIterator](),
      records: (choose) =>
        dbfRecords(chunked(dbf(['SWATHWIDTH', 'DISTANCE', 'DryYield'], rows)), choose)[Symbol.asyncIterator](),
      meta: { DataAttributes: [{ Name: 'DryYield', Unit: 'bu1ac-1' }] },
    })
    const y = res.layers.find((l) => l.kind === 'yield')!
    expect(y.rate_unit).toBe('bu1ac-1')
    expect(y.cells.find(([gx]) => gx === -20000)![2]).toBeCloseTo(60, 5)
  })
})

describe('grid', () => {
  it('puts a cell centre back in the same cell', () => {
    const [gx, gy] = cellOf(-113.41234, 52.37654)
    expect(cellOf(...centreOf(gx, gy))).toEqual([gx, gy])
  })
  it('is about 5 m on a side on this farm', () => {
    expect(DLAT * 111_132).toBeCloseTo(5, 6)
  })
})

describe('addSwath', () => {
  const [lon, lat] = centreOf(-20000, 30000)

  it('lays a wide swath across the direction of travel, conserving area and product', () => {
    const acc = new GridAccumulator()
    // Heading north, 27 m wide: the swath runs east-west.
    acc.addSwath(lon, lat, 35, 27, 4, 0)
    const cells = acc.packed()
    expect(new Set(cells.map((c) => c[1])).size).toBe(1)
    expect(cells.length).toBeGreaterThanOrEqual(5)
    const area = cells.reduce((s, c) => s + c[3] * CELL_M2, 0)
    // Coverage is stored to three decimals of a cell, so within a few hundredths of a m².
    expect(Math.abs(area - 27 * 4)).toBeLessThan(0.1)
    for (const c of cells) expect(c[2]).toBe(35)
    expect(acc.points).toBe(1)
  })

  it('runs north-south when travelling east', () => {
    const acc = new GridAccumulator()
    acc.addSwath(lon, lat, 1, 27, 4, 90)
    expect(new Set(acc.packed().map((c) => c[0])).size).toBe(1)
  })

  it('keeps a narrow section in one cell', () => {
    const acc = new GridAccumulator()
    acc.addSwath(lon, lat, 1, 3, 4, 0)
    expect(acc.packed()).toHaveLength(1)
  })
})

describe('harvester sections', () => {
  it('gathers the sections logged at one position into the full header width', async () => {
    // A 22 ft header logged as three sections at the same spot, twice, heading north,
    // 2 m east of a cell centre as a real pass would be.
    const [c0, lat] = centreOf(-20000, 30000)
    const lon = c0 + 2 / (111_320 * Math.cos((52.35 * Math.PI) / 180))
    const at: [number, number][] = [
      [lon, lat],
      [lon, lat],
      [lon, lat],
      [lon, lat + 3 / 111_132],
      [lon, lat + 3 / 111_132],
      [lon, lat + 3 / 111_132],
    ]
    const rows = at.map(() => ['7.33', '10', '0'])
    const res = await gridExport({
      operationType: 'harvest',
      points: shpPoints(chunked(shp(at)))[Symbol.asyncIterator](),
      records: (choose) => dbfRecords(chunked(dbf(['SWATHWIDTH', 'DISTANCE', 'Heading'], rows)), choose)[Symbol.asyncIterator](),
      meta: null,
    })
    const cov = res.layers.find((l) => l.kind === 'coverage')!
    // 22 ft is 6.7 m: laid east-west across the pass it spans two cell columns, not one.
    expect(new Set(cov.cells.map((c) => c[0])).size).toBeGreaterThanOrEqual(2)
    const area = cov.cells.reduce((s, c) => s + c[3] * 25, 0)
    expect(Math.abs(area - 2 * 22 * 0.3048 * 10 * 0.3048)).toBeLessThan(0.2)
  })
})
