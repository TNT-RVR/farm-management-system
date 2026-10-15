import { describe, expect, it } from 'vitest'
import { dbf, shp, storedZip } from './__fixtures__/shapefile'
import { centreOf } from './pl-grid'
import { gridYieldFile, guessYieldColumn, openShapefile, previewColumns } from './yield-import'

const [lon, lat] = centreOf(-20000, 30000)
const names = ['Moisture', 'WetYield', 'DryYield', 'Speed']
const rows = [
  ['14.1', '52', '50', '5'],
  ['14.3', '62', '60', '5'],
  ['13.9', '0', '0', '0'], // header up at the end of a pass
]
const points: [number, number][] = [
  [lon, lat],
  [lon, lat],
  [lon, lat],
]

const file = (name: string, bytes: Uint8Array) => new File([bytes as BlobPart], name)

describe('openShapefile', () => {
  it('takes the .shp and .dbf picked together', async () => {
    const f = await openShapefile([file('cook.shp', shp(points)), file('cook.dbf', dbf(names, rows))])
    expect(f.name).toBe('cook.shp')
    expect(f.shp.length).toBeGreaterThan(100)
  })

  it('takes a zipped export', async () => {
    const zip = storedZip({ 'export/cook.shp': shp(points), 'export/cook.dbf': dbf(names, rows) })
    const f = await openShapefile([file('cook.zip', zip)])
    expect(f.dbf.length).toBeGreaterThan(0)
  })

  it('says which file is missing when the .dbf was not picked', async () => {
    await expect(openShapefile([file('cook.shp', shp(points))])).rejects.toThrow(/\.dbf/)
  })
})

describe('guessYieldColumn', () => {
  it('prefers dry yield and never picks moisture', async () => {
    const f = await openShapefile([file('c.shp', shp(points)), file('c.dbf', dbf(names, rows))])
    const cols = await previewColumns(f)
    expect(cols.map((c) => c.name)).toEqual(names)
    expect(cols.find((c) => c.name === 'DryYield')!.samples).toContain('50')
    expect(guessYieldColumn(cols)).toBe('DryYield')
  })

  it('finds nothing rather than guessing wrong', () => {
    expect(guessYieldColumn([{ name: 'Moisture', samples: ['14'], numeric: true }])).toBeNull()
  })
})

describe('gridYieldFile', () => {
  it('drops the zeros from yield but keeps them in the footprint', async () => {
    const f = await openShapefile([file('c.shp', shp(points)), file('c.dbf', dbf(names, rows))])
    const g = await gridYieldFile(f, 'DryYield')
    expect(g.points).toBe(3)
    expect(g.unread).toBe(1)
    expect(g.cells).toEqual([[-20000, 30000, 55, 1]])
    expect(g.footprint).toHaveLength(1)
  })

  // Four north-south passes 11 m apart, a point every 3 m, an 11.12 m header,
  // with the yield sensor dead on the second and third passes.
  const passes = [0, 1, 2, 3]
  const pts: [number, number][] = []
  const recs: string[][] = []
  let clock = 0
  for (const p of passes) {
    for (let k = 0; k < 20; k++) {
      pts.push([lon + (p * 11.12) / (111_320 * Math.cos((52.35 * Math.PI) / 180)), lat + (k * 3) / 111_132])
      recs.push([p === 1 || p === 2 ? '0' : '60', '11.12', String((clock += 2))])
    }
    clock += 60 // turning at the headland
  }
  const load = () => openShapefile([file('s.shp', shp(pts)), file('s.dbf', dbf(['yldbu_ac', 'headerw_m', 'timestamp'], recs))])

  it('lays each point across the full header, so the passes meet', async () => {
    const g = await gridYieldFile(await load(), 'yldbu_ac')
    expect(g.headerM).toBeCloseTo(11.12, 6)
    const xs = new Set(g.footprint.map((c) => c[0]))
    // Four 11 m passes side by side cover about 44 m: nine or ten 5 m columns, no gaps.
    const sorted = [...xs].sort((a, b) => a - b)
    expect(sorted.length).toBeGreaterThanOrEqual(9)
    expect(sorted[sorted.length - 1] - sorted[0] + 1).toBe(sorted.length)
  })

  it('treats a dead sensor as no reading, and fills from good passes nearby', async () => {
    const g = await gridYieldFile(await load(), 'yldbu_ac')
    expect(g.unread).toBe(40)
    expect(g.measuredShare).toBeLessThan(0.7)
    expect(g.filledShare).toBe(1)
    // Filled cells carry the neighbours' yield, never zero.
    for (const c of g.cells) expect(c[2]).toBeCloseTo(60, 6)
    expect(g.cells.some((c) => c[3] === 0)).toBe(true)
  })

  it('refuses a file in projected coordinates instead of drawing it in the wrong place', async () => {
    const f = await openShapefile([file('c.shp', shp([[380000, 5530000]])), file('c.dbf', dbf(names, rows.slice(0, 1)))])
    await expect(gridYieldFile(f, 'DryYield')).rejects.toThrow(/lat-long/)
  })
})
