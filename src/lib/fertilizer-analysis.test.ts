import { describe, expect, it } from 'vitest'
import { nutrientsApplied, parseAnalysis, sumNutrients } from './fertilizer-analysis'

/**
 * Every string here is a real product name out of this farm's Deere records or
 * off the retailer's prescription, because the whole exercise is reading names
 * people actually typed rather than names a format would allow.
 */
describe('parseAnalysis', () => {
  it('reads a plain three-number blend', () => {
    expect(parseAnalysis('46-0-0')).toEqual({ n: 46, p2o5: 0, k2o: 0, s: 0, micro: {} })
    expect(parseAnalysis('0-0-60 KCL')).toEqual({ n: 0, p2o5: 0, k2o: 60, s: 0, micro: {} })
  })

  it('finds the analysis inside a name that carries a trade name too', () => {
    expect(parseAnalysis('ESN 44-0-0')).toMatchObject({ n: 44, p2o5: 0, k2o: 0 })
    expect(parseAnalysis('11-52-0 MAP')).toMatchObject({ n: 11, p2o5: 52, k2o: 0 })
    expect(parseAnalysis('28-0-0-UAN')).toMatchObject({ n: 28, p2o5: 0, k2o: 0, s: 0 })
    expect(parseAnalysis('SULF4R 0-0-0-17-21')).toMatchObject({ n: 0, p2o5: 0, k2o: 0, s: 17 })
  })

  it('reads the retailer blends off the prescription', () => {
    expect(parseAnalysis('19.5-15.6-15.6-3.9')).toEqual({
      n: 19.5,
      p2o5: 15.6,
      k2o: 15.6,
      s: 3.9,
      micro: {},
    })
    expect(parseAnalysis('32.2-16.4-0-2.7')).toMatchObject({ n: 32.2, p2o5: 16.4, s: 2.7 })
  })

  it('keeps a micronutrient with its symbol', () => {
    expect(parseAnalysis('28.4-9.7-13.6-0.2-0.28Zn')).toEqual({
      n: 28.4,
      p2o5: 9.7,
      k2o: 13.6,
      s: 0.2,
      micro: { Zn: 0.28 },
    })
  })

  it('refuses a name whose numbers cannot fit in a bag', () => {
    // "80N - 50P - 30K - 20S - 23.77Ca - 5Zn" is a Deere product name, and it
    // is pounds per acre of nutrient, not an analysis. Believing it would
    // report a 208% fertiliser and multiply every figure downstream by four.
    expect(parseAnalysis('80N - 50P - 30K - 20S - 23.77Ca - 5Zn')).toBeNull()
  })

  it('refuses names with nothing to read', () => {
    expect(parseAnalysis('Fertilizer (Dry)')).toBeNull()
    expect(parseAnalysis('Roundup')).toBeNull()
    expect(parseAnalysis(null)).toBeNull()
    expect(parseAnalysis('')).toBeNull()
  })
})

describe('nutrientsApplied', () => {
  it('turns pounds an acre of a blend into pounds an acre of nutrient', () => {
    // 585 lb/ac of 38.8-10.8-0-0, the corn rate on this farm in 2026.
    const r = nutrientsApplied('38.8-10.8-0-0', 585, 'lb1ac-1')
    expect(r).not.toBeNull()
    expect(r!.n).toBeCloseTo(226.98, 2)
    expect(r!.p2o5).toBeCloseTo(63.18, 2)
    expect(r!.k2o).toBe(0)
  })

  it('converts a metric rate before doing the arithmetic', () => {
    // The same nutrients, given in kilograms: 585 lb is 265.35 kg.
    const lb = nutrientsApplied('38.8-10.8-0-0', 585, 'lb1ac-1')
    const kg = nutrientsApplied('38.8-10.8-0-0', 585 * 0.45359237, 'kg1ac-1')
    expect(kg!.n).toBeCloseTo(lb!.n, 6)
  })

  it('scales a micronutrient the same way', () => {
    const r = nutrientsApplied('28.4-9.7-13.6-0.2-0.28Zn', 723, 'lb1ac-1')
    expect(r!.micro.Zn).toBeCloseTo(2.02, 2)
  })

  it('will not turn a volume into a weight', () => {
    // This farm's records carry "46-0-0" at 6 gal/ac. Urea is not a liquid, so
    // the entry is wrong rather than merely lacking a density — and a guessed
    // density would print an invented nitrogen figure next to a real
    // prescription with nothing to say it was invented.
    expect(nutrientsApplied('46-0-0', 6, 'gal1ac-1')).toBeNull()
    expect(nutrientsApplied('28-0-0-UAN', 1.5, 'l1ac-1')).toBeNull()
  })

  it('is null when the product says nothing about its analysis', () => {
    expect(nutrientsApplied('Fertilizer (Dry)', 500, 'lb1ac-1')).toBeNull()
    expect(nutrientsApplied('46-0-0', undefined, 'lb1ac-1')).toBeNull()
  })
})

describe('sumNutrients', () => {
  it('adds several passes', () => {
    const a = nutrientsApplied('46-0-0', 200, 'lb1ac-1')!
    const b = nutrientsApplied('11-52-0 MAP', 100, 'lb1ac-1')!
    const total = sumNutrients([a, b])
    expect(total.n).toBeCloseTo(92 + 11, 6)
    expect(total.p2o5).toBeCloseTo(52, 6)
  })

  it('is zero for nothing', () => {
    expect(sumNutrients([])).toEqual({ n: 0, p2o5: 0, k2o: 0, s: 0 })
  })
})
