import { describe, expect, it } from 'vitest'
import { chooseColumns, gridExport } from './pl-export'
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
    const pts = await collect(shpPoints(chunked(shp([[-108.5, 52.4], null, [-108.4, 52.3]]))))
    expect(pts).toEqual([[-108.5, 52.4], null, [-108.4, 52.3]])
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
    expect(c).toEqual({ rate: 'AppliedRate', yield: null, width: 'SWATHWIDTH', distance: 'DISTANCE', heading: null, hash: 'PRODUCTHASH' })
  })
  it('prefers a dry yield over a wet one', () => {
    expect(chooseColumns(['WetYield', 'DryYield']).yield).toBe('DryYield')
  })
  it('finds no yield in a bean harvest export', () => {
    const beans = ['DISTANCE', 'SWATHWIDTH', 'SECTIONID', 'Crop', 'Time', 'Heading', 'Elevation', 'FUEL', 'VEHICLSPEED', 'DRYMATTER']
    expect(chooseColumns(beans).yield).toBeNull()
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
    const [gx, gy] = cellOf(-108.61234, 52.37654)
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
