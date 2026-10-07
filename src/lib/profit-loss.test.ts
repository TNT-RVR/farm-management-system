import { describe, expect, it } from 'vitest'
import { CELL_ACRES, cellKey, type PackedCell } from './pl-grid'
import { fillHoles, harvestedCells, losingShare, profitCells, spreadPassCost, type GridRow, type PlInputs } from './profit-loss'

const row = (over: Partial<GridRow> & Pick<GridRow, 'kind' | 'cells'>): GridRow => ({
  operation_id: null,
  operation_type: over.kind === 'input' ? 'application' : 'harvest',
  product_hash: '',
  product_name: null,
  rate_unit: null,
  point_count: over.cells.length,
  ...over,
})

// Four cells harvested; the sprayer overlapped on the last one.
const harvest = row({ kind: 'coverage', cells: [[0, 0, 1, 1], [1, 0, 1, 1], [2, 0, 1, 1], [3, 0, 1, 1]] })
const spray = row({
  kind: 'input',
  operation_id: 'spray',
  cells: [[0, 0, 20, 1], [1, 0, 20, 1], [2, 0, 20, 1], [3, 0, 20, 2]],
})

const base: PlInputs = {
  grids: [harvest, spray],
  placed: new Map([['spray', 100]]),
  mode: 'even',
  scaleYieldPerAcre: 3000,
  price: 0.5,
  flatPerAcre: 800,
}

describe('spreadPassCost', () => {
  it('conserves the pass total and charges the overlap double', () => {
    const per = spreadPassCost([spray], 100)
    const dollars = [...per.values()].reduce((s, v) => s + v * CELL_ACRES, 0)
    expect(dollars).toBeCloseTo(100, 9)
    expect(per.get(cellKey(3, 0))!).toBeCloseTo(2 * per.get(cellKey(0, 0))!, 9)
  })
  it('costs nothing for an unpriced pass', () => {
    expect(spreadPassCost([spray], 0).size).toBe(0)
  })
})

describe('harvestedCells', () => {
  it('drops cells the harvester only clipped', () => {
    const clipped = row({ kind: 'coverage', cells: [[0, 0, 1, 1], [9, 9, 1, 0.1]] })
    expect(harvestedCells([clipped]).map((c) => c[0])).toEqual([0])
  })
  it('falls back to where inputs went when nothing was harvested', () => {
    expect(harvestedCells([spray])).toHaveLength(4)
  })
})

describe('profitCells', () => {
  it('is yield × price − mapped − flat in every square', () => {
    const cells = profitCells(base)
    const plain = cells.find((c) => c.gx === 0)!
    expect(plain.revenue).toBe(1500)
    expect(plain.profit).toBeCloseTo(1500 - plain.mapped - 800, 9)
    // The overlapped square cost more, so made less.
    expect(cells.find((c) => c.gx === 3)!.profit).toBeLessThan(plain.profit)
  })

  it('spreads the scale total by vigour without changing the average', () => {
    const vigour = new Map([
      [cellKey(0, 0), 0.6],
      [cellKey(1, 0), 0.8],
      [cellKey(2, 0), 0.8],
      [cellKey(3, 0), 0.6],
    ])
    const cells = profitCells({ ...base, mode: 'vigour', vigour })
    const mean = cells.reduce((s, c) => s + c.yield, 0) / cells.length
    expect(mean).toBeCloseTo(3000, 9)
    expect(cells.find((c) => c.gx === 1)!.yield).toBeGreaterThan(cells.find((c) => c.gx === 0)!.yield)
  })

  it('gives a cloud-covered square the average, not nothing', () => {
    const vigour = new Map([[cellKey(0, 0), 0.7]])
    const cells = profitCells({ ...base, mode: 'vigour', vigour })
    expect(cells.find((c) => c.gx === 2)!.yield).toBe(3000)
  })

  it('keeps a yield monitor’s pattern but calibrates it to the scale', () => {
    const monitor = row({ kind: 'yield', cells: [[0, 0, 40, 1], [1, 0, 60, 1], [2, 0, 40, 1], [3, 0, 60, 1]] as PackedCell[] })
    const cells = profitCells({ ...base, grids: [monitor, spray], mode: 'file', scaleYieldPerAcre: 55 })
    expect(cells.find((c) => c.gx === 0)!.yield).toBeCloseTo(44, 9)
    expect(cells.find((c) => c.gx === 1)!.yield).toBeCloseTo(66, 9)
  })
})

describe('losingShare', () => {
  it('counts the squares below break-even', () => {
    // Four squares cover 0.025 ac, so a $100 pass is ~$4,000/ac here: every square loses money.
    expect(losingShare(profitCells(base))).toBe(1)
    expect(losingShare(profitCells({ ...base, placed: new Map(), flatPerAcre: 0 }))).toBe(0)
  })
})

describe('other revenue', () => {
  it('adds a second output evenly to every square', () => {
    const cells = profitCells({ ...base, otherRevenuePerAcre: 40 })
    expect(cells[0].revenue).toBe(1540)
  })
})

describe('fillHoles', () => {
  const block = (skip: (x: number, y: number) => boolean): PackedCell[] => {
    const out: PackedCell[] = []
    for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) if (!skip(x, y)) out.push([x, y, 1, 1])
    return out
  }

  it('closes a diagonal chain of missed squares through harvested ground', () => {
    const cells = fillHoles(block((x, y) => x === y && x > 1 && x < 8))
    expect(cells).toHaveLength(100)
  })

  it('closes a gap two squares wide', () => {
    expect(fillHoles(block((x, y) => y === 5 && (x === 4 || x === 5)))).toHaveLength(100)
  })

  it('closes a seam four squares wide running the length of the field', () => {
    expect(fillHoles(block((x) => x >= 3 && x <= 6))).toHaveLength(100)
  })

  it('leaves a notch wider than the closing alone', () => {
    // An unharvested corner six squares across, open to the edge.
    const cells = fillHoles(block((x, y) => x >= 4 && y >= 4))
    expect(cells).toHaveLength(100 - 36)
  })

  it('leaves the ground around the field alone', () => {
    const cells = fillHoles(block(() => false))
    expect(cells).toHaveLength(100)
    expect(cells.every(([x, y]) => x >= 0 && x < 10 && y >= 0 && y < 10)).toBe(true)
  })
})

describe('estimated squares', () => {
  it('marks footprint squares a yield file never read', () => {
    const monitor = row({ kind: 'yield', cells: [[0, 0, 40, 1], [1, 0, 60, 0]] as PackedCell[] })
    const cells = profitCells({ ...base, grids: [harvest, monitor, spray], mode: 'file' })
    expect(cells.filter((c) => c.estimated).map((c) => c.gx).sort()).toEqual([2, 3])
  })

  it('marks nothing when there is no yield file', () => {
    expect(profitCells(base).some((c) => c.estimated)).toBe(false)
  })
})
