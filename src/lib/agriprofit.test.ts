import { describe, expect, it } from 'vitest'
import {
  benchmarkFor,
  benchmarkLine,
  capitalLines,
  costLines,
  inBenchmarkUnit,
  unmatchedCrops,
} from './agriprofit'
import {
  BENCHMARK_CROP_LABELS,
  DRYLAND_BLACK_2024,
  IRRIGATED_2024,
  type AgriProfitRow,
} from './agriprofit-data'

// These numbers were parsed out of a PDF and will be used to argue about what a
// crop should cost. The publication states three identities between its own
// subtotals, so they are checked here on every row: an extraction that dropped
// a line or picked up the wrong column breaks at least one of them.

const all: [string, AgriProfitRow[]][] = [
  ['irrigated', IRRIGATED_2024],
  ['dryland black', DRYLAND_BLACK_2024],
]

describe('the parsed benchmark tables', () => {
  it('has the crops the two publications print', () => {
    expect(IRRIGATED_2024).toHaveLength(13)
    expect(DRYLAND_BLACK_2024).toHaveLength(10)
    expect(IRRIGATED_2024.map((r) => r.crop)).toContain('corn silage')
    expect(DRYLAND_BLACK_2024.map((r) => r.crop)).toContain('greenfeed')
  })

  it('adds variable and capital costs up to total production costs', () => {
    for (const [zone, rows] of all) {
      for (const r of rows) {
        expect(r.variableCosts, `${zone} ${r.crop}`).not.toBeNull()
        expect((r.variableCosts ?? 0) + (r.capitalCosts ?? 0), `${zone} ${r.crop}`).toBeCloseTo(
          r.totalCosts ?? 0,
          1,
        )
      }
    }
  })

  it('leaves gross return less total costs as the return to equity', () => {
    for (const [zone, rows] of all) {
      for (const r of rows) {
        expect((r.grossReturn ?? 0) - (r.totalCosts ?? 0), `${zone} ${r.crop}`).toBeCloseTo(
          r.returnToEquity ?? 0,
          1,
        )
      }
    }
  })

  it('leaves gross return less cash costs as the gross margin', () => {
    for (const [zone, rows] of all) {
      for (const r of rows) {
        expect((r.grossReturn ?? 0) - (r.cashCosts ?? 0), `${zone} ${r.crop}`).toBeCloseTo(
          r.grossMargin ?? 0,
          1,
        )
      }
    }
  })

  it('carries a yield and a unit for every crop', () => {
    for (const [zone, rows] of all) {
      for (const r of rows) {
        expect(r.yieldPerAcre, `${zone} ${r.crop}`).toBeGreaterThan(0)
        expect(r.unit, `${zone} ${r.crop}`).toBeTruthy()
      }
    }
  })

  it('charges the irrigated crops for irrigation power and the dryland ones nothing', () => {
    // A quiet way the two zones could get swapped.
    for (const r of IRRIGATED_2024) expect(r.irrigationPower ?? 0, r.crop).toBeGreaterThan(0)
    for (const r of DRYLAND_BLACK_2024) expect(r.irrigationPower ?? 0, r.crop).toBe(0)
  })

  it('points every label in the crop map at a crop that exists', () => {
    for (const [ours, theirs] of Object.entries(BENCHMARK_CROP_LABELS)) {
      const inEither =
        IRRIGATED_2024.some((r) => r.crop === theirs) ||
        DRYLAND_BLACK_2024.some((r) => r.crop === theirs)
      expect(inEither, `${ours} → ${theirs}`).toBe(true)
    }
  })
})

describe('matching one of our crops to a benchmark', () => {
  it('finds the crops we grow that have one', () => {
    expect(benchmarkFor('Wheat', 'irrigated')?.crop).toBe('spring wheat')
    expect(benchmarkFor('Malt Barley', 'irrigated')?.crop).toBe('malt barley')
    expect(benchmarkFor('Silage Corn', 'irrigated')?.crop).toBe('corn silage')
    expect(benchmarkFor('Alfalfa Hay', 'irrigated')?.crop).toBe('alfalfa hay')
  })

  it('returns nothing for the crops with no 2024 benchmark', () => {
    // Borrowing a cereal's costs for potatoes would be worse than a blank.
    expect(benchmarkFor('Potato', 'irrigated')).toBeNull()
    expect(benchmarkFor('Beans-Pinto', 'irrigated')).toBeNull()
    expect(benchmarkFor('Sugar Beet', 'irrigated')).toBeNull()
    expect(benchmarkFor('Spinach Seed', 'irrigated')).toBeNull()
    expect(benchmarkFor(null, 'irrigated')).toBeNull()
  })

  it('names the crops it could not match', () => {
    expect(unmatchedCrops(['Wheat', 'Potato', 'Potato', null], 'irrigated')).toEqual(['Potato'])
  })

  it('has no corn silage in the dryland set, so says so rather than reaching across zones', () => {
    expect(benchmarkFor('Silage Corn', 'black')).toBeNull()
  })
})

describe('lining a budget row up', () => {
  const ours = {
    cropName: 'Wheat',
    acres: 320,
    yieldPerAcre: 102,
    yieldUnit: 'bu',
    costPerAcre: 640,
    marginPerAcre: 180,
  }

  it('carries both sides through', () => {
    const line = benchmarkLine(ours, 'irrigated')
    expect(line.benchmark?.crop).toBe('spring wheat')
    expect(line.ourYield).toBe(102)
    expect(line.acres).toBe(320)
  })

  it('will not call bushels and tonnes the same unit', () => {
    const hay = benchmarkLine(
      { ...ours, cropName: 'Alfalfa Hay', yieldUnit: 'ton', yieldPerAcre: 5 },
      'irrigated',
    )
    // The benchmark quotes hay in tonnes; a ton is not one, and comparing them
    // would make a level crop look 10 per cent short.
    expect(hay.benchmark?.unit).toBe('tonne')
    expect(hay.sameUnit).toBe(false)
    const tonnes = benchmarkLine({ ...ours, cropName: 'Alfalfa Hay', yieldUnit: 'tonnes' }, 'irrigated')
    expect(tonnes.sameUnit).toBe(true)
  })

  it('matches the words that mean the same unit', () => {
    for (const yieldUnit of ['bushels', 'bushel', 'bu', 'BU']) {
      expect(benchmarkLine({ ...ours, yieldUnit }, 'irrigated').sameUnit, yieldUnit).toBe(true)
    }
    // MT is a tonne. Silage booked in MT against a benchmark in tonnes is the
    // same measurement, and flagging it would read as a mismatch that is not
    // there.
    for (const yieldUnit of ['MT', 'mt', 't', 'tonnes']) {
      const line = benchmarkLine(
        { ...ours, cropName: 'Silage Corn', yieldUnit, yieldPerAcre: 18 },
        'irrigated',
      )
      expect(line.sameUnit, yieldUnit).toBe(true)
    }
  })

  it('still refuses to call a ton a tonne', () => {
    // 2,000 lb against 2,205. Treating them as one unit would move every hay
    // and silage comparison by ten per cent in our favour.
    const line = benchmarkLine(
      { ...ours, cropName: 'Alfalfa Hay', yieldUnit: 'tons', yieldPerAcre: 5 },
      'irrigated',
    )
    expect(line.sameUnit).toBe(false)
  })
})

describe('the benchmark breakdown', () => {
  it('orders variable costs biggest first and drops the empty lines', () => {
    const row = IRRIGATED_2024.find((r) => r.crop === 'spring wheat')!
    const lines = costLines(row)
    expect(lines[0][1]).toBeGreaterThanOrEqual(lines[1][1])
    expect(lines.some(([l]) => l === 'Fertilizer')).toBe(true)
    for (const [, v] of lines) expect(v).toBeGreaterThan(0)
  })

  it('adds the printed lines up to the printed subtotal', () => {
    // Not every row survives this: the publication rounds each line to the cent
    // and the subtotal to the cent, so a few cents of drift is expected and a
    // missing line is not.
    for (const r of IRRIGATED_2024) {
      const sum = costLines(r).reduce((s, [, v]) => s + v, 0)
      expect(sum, r.crop).toBeCloseTo(r.variableCosts ?? 0, 1)
    }
  })

  it('adds the capital lines up to the capital subtotal', () => {
    for (const r of IRRIGATED_2024) {
      const sum = capitalLines(r).reduce((s, [, v]) => s + v, 0)
      expect(sum, r.crop).toBeCloseTo(r.capitalCosts ?? 0, 1)
    }
  })
})

describe('converting our yield into the benchmark unit', () => {
  it('converts pounds to tonnes exactly', () => {
    // 8,818 lb of hay is 4.0 tonnes, which is readable against their 4.5.
    expect(inBenchmarkUnit(8818, 'lbs', 'tonne')!).toBeCloseTo(4.0, 2)
    expect(inBenchmarkUnit(2204.62, 'lb', 'tonne')!).toBeCloseTo(1, 5)
  })

  it('converts short tons to tonnes, rather than calling them equal', () => {
    // 5 ton is 4.54 tonnes. The units stay distinct and the number moves.
    expect(inBenchmarkUnit(5, 'tons', 'tonne')!).toBeCloseTo(4.536, 3)
  })

  it('converts nothing when the units already match', () => {
    expect(inBenchmarkUnit(18, 'MT', 'tonne')).toBeNull()
    expect(inBenchmarkUnit(96, 'bu', 'bushel')).toBeNull()
  })

  it('refuses bushels against a mass', () => {
    // A bushel is not a mass without a test weight, and the weight differs by
    // crop. Converting on an assumed one would be inventing the comparison.
    expect(inBenchmarkUnit(96, 'bu', 'tonne')).toBeNull()
    expect(inBenchmarkUnit(4, 'tonne', 'bushel')).toBeNull()
  })
})
