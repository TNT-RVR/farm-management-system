import { describe, expect, it } from 'vitest'
import {
  buildRequirement,
  canonicalProduct,
  microTotals,
  productRate,
  toTonnes,
  totalsByNutrient,
  totalsByProduct,
  type RecItem,
} from './fertilizer-plan'

const rec = (o: Partial<RecItem>): RecItem => ({ nutrient: 'N', product: '46-0-0 urea', lb_per_ac: 100, ...o })

describe('productRate', () => {
  it('uses the stated product rate when the recommendation gave one', () => {
    expect(productRate(rec({ lb_per_ac: 100, product_lb_per_ac: 217 }))).toBe(217)
  })

  it('derives it from the analysis in the product name', () => {
    // 100 lb/ac of N from 46-0-0 is 100 / 0.46 = 217.4 lb of urea.
    expect(productRate(rec({ nutrient: 'N', product: '46-0-0 urea', lb_per_ac: 100 }))).toBeCloseTo(217.4, 1)
    // 70 lb/ac of P2O5 from 11-52-0 is 70 / 0.52 = 134.6 lb of MAP.
    expect(productRate(rec({ nutrient: 'P2O5', product: '11-52-0 MAP', lb_per_ac: 70 }))).toBeCloseTo(134.6, 1)
    // 50 lb/ac of K2O from 0-0-60 is 83.3 lb of potash.
    expect(productRate(rec({ nutrient: 'K2O', product: '0-0-60 potash', lb_per_ac: 50 }))).toBeCloseTo(83.3, 1)
  })

  it('reads the fourth number as sulphur', () => {
    // 15 lb/ac of S from 21-0-0-24 AMS is 15 / 0.24 = 62.5 lb.
    expect(productRate(rec({ nutrient: 'S', product: '21-0-0-24 AMS', lb_per_ac: 15 }))).toBeCloseTo(62.5, 1)
  })

  it('returns null rather than guessing when the name carries no analysis', () => {
    // An invented tonnage is worse than a blank on an order sheet.
    expect(productRate(rec({ nutrient: 'Zn', product: '10% Zn-EDTA', lb_per_ac: 1.5 }))).toBeNull()
    expect(productRate(rec({ product: 'urea', lb_per_ac: 100 }))).toBeNull()
  })

  it('returns null when the nutrient is not in the analysis at all', () => {
    // Asking 0-0-60 for nitrogen is a mistake, not a zero.
    expect(productRate(rec({ nutrient: 'N', product: '0-0-60 potash', lb_per_ac: 40 }))).toBeNull()
  })

  it('returns null for a missing or zero rate', () => {
    expect(productRate(rec({ lb_per_ac: undefined }))).toBeNull()
    expect(productRate(rec({ lb_per_ac: 0 }))).toBeNull()
  })
})

describe('buildRequirement', () => {
  it('multiplies the product rate by the acres', () => {
    const r = buildRequirement('f1', 'Field 1', 'Corn', 130, [
      rec({ nutrient: 'N', product: '46-0-0 urea', lb_per_ac: 100 }),
    ])
    expect(r.lines![0].productLbPerAc).toBeCloseTo(217.4, 1)
    expect(r.lines![0].productLbTotal).toBe(Math.round(217.4 * 130))
  })

  it('keeps the line but leaves the total blank when acres are unknown', () => {
    const r = buildRequirement('f1', 'Field 1', 'Corn', null, [rec({})])
    expect(r.lines).toHaveLength(1)
    expect(r.lines![0].productLbTotal).toBeNull()
  })

  it('distinguishes "no assessment" from "nothing needed"', () => {
    // null lines = never written up; an empty array = written up and found
    // nothing to apply. Collapsing the two would hide unfinished work.
    expect(buildRequirement('f1', 'F', null, 10, null).lines).toBeNull()
    expect(buildRequirement('f1', 'F', null, 10, []).lines).toEqual([])
  })

  it('skips a line with no product or no rate', () => {
    const r = buildRequirement('f1', 'F', null, 10, [
      { nutrient: 'N', lb_per_ac: 50 },
      { nutrient: 'N', product: '46-0-0', lb_per_ac: undefined },
    ])
    expect(r.lines).toEqual([])
  })
})

describe('canonicalProduct', () => {
  it('groups the same analysis however it is worded', () => {
    // The real spread from one generation run, which split potash four ways.
    const names = ['0-0-60 potash', '0-0-60 potash (KCl)', '0-0-60 KCl', '0-0-60 potash (Zone 4 only)']
    const keys = new Set(names.map((n) => canonicalProduct(n)!.key))
    expect(keys.size).toBe(1)
    expect([...keys][0]).toBe('0-0-60')
  })

  it('does not merge different analyses', () => {
    expect(canonicalProduct('11-52-0 MAP')!.key).not.toBe(canonicalProduct('10-34-0 APP')!.key)
    expect(canonicalProduct('32-0-0 UAN')!.key).not.toBe(canonicalProduct('28-0-0 UAN')!.key)
  })

  it('labels a known analysis with its trade name', () => {
    expect(canonicalProduct('0-0-60 KCl')!.label).toBe('0-0-60 potash')
    expect(canonicalProduct('11-52-0 (MAP)')!.label).toBe('11-52-0 MAP')
  })

  it('rejects the non-products the generator writes into the field', () => {
    for (const junk of ['none', 'none (rely on inoculant)', 'included in MAP', 'Incidental from other sources', 'N/A']) {
      expect(canonicalProduct(junk), junk).toBeNull()
    }
  })

  it('returns null for micronutrients, which are not interchangeable by weight', () => {
    expect(canonicalProduct('10% Zn-EDTA')).toBeNull()
    expect(canonicalProduct('36% zinc sulphate')).toBeNull()
  })
})

describe('totalsByProduct', () => {
  const reqs = [
    buildRequirement('a', 'Field A', 'Corn', 100, [
      rec({ nutrient: 'N', product: '46-0-0 urea', lb_per_ac: 46 }),
    ]),
    buildRequirement('b', 'Field B', 'Wheat', 50, [
      rec({ nutrient: 'N', product: '46-0-0 Urea', lb_per_ac: 46 }),
    ]),
  ]

  it('totals the same product across fields regardless of wording', () => {
    const t = totalsByProduct(reqs)
    expect(t).toHaveLength(1)
    expect(t[0].fields).toBe(2)
    // 46 lb N/ac from 46-0-0 is exactly 100 lb of product per acre.
    expect(t[0].totalLb).toBe(100 * 100 + 100 * 50)
  })

  it('merges the potash spellings into one order line', () => {
    const spread = [
      buildRequirement('a', 'A', null, 100, [rec({ nutrient: 'K2O', product: '0-0-60 potash', lb_per_ac: 60 })]),
      buildRequirement('b', 'B', null, 100, [rec({ nutrient: 'K2O', product: '0-0-60 KCl', lb_per_ac: 60 })]),
      buildRequirement('c', 'C', null, 100, [rec({ nutrient: 'K2O', product: '0-0-60 potash (Zone 4 only)', lb_per_ac: 60 })]),
    ]
    const t = totalsByProduct(spread)
    expect(t).toHaveLength(1)
    expect(t[0].fields).toBe(3)
    expect(t[0].totalLb).toBe(300 * 100)
  })

  it('keeps micronutrients and junk off the order sheet', () => {
    const mixed = [
      buildRequirement('a', 'A', null, 100, [
        rec({ nutrient: 'N', product: '46-0-0 urea', lb_per_ac: 46 }),
        rec({ nutrient: 'Zn', product: '10% Zn-EDTA', lb_per_ac: 1.5 }),
        rec({ nutrient: 'B', product: 'none', lb_per_ac: 0.5 }),
      ]),
    ]
    const t = totalsByProduct(mixed)
    expect(t.map((x) => x.product)).toEqual(['46-0-0 urea'])
  })

  it('converts to tonnes for ordering', () => {
    expect(totalsByProduct(reqs)[0].totalTonnes).toBeCloseTo(toTonnes(15000), 2)
  })

  it('names the fields it had to leave out rather than dropping them quietly', () => {
    // A total that silently omits two fields is the one that gets ordered from.
    const withGaps = [
      ...reqs,
      buildRequirement('c', 'Field C', null, null, [rec({ lb_per_ac: 46 })]),
      buildRequirement('d', 'Field D', null, 60, [
        rec({ nutrient: 'Zn', product: 'chelated zinc', lb_per_ac: 2 }),
      ]),
    ]
    const totals = totalsByProduct(withGaps)
    const urea = totals.find((t) => /urea/i.test(t.product))!
    expect(urea.missingAcres).toEqual(['Field C'])
    // The zinc line has no analysis, so it is not on the order sheet at all —
    // it is counted as actual nutrient instead.
    expect(totals.find((t) => /zinc/i.test(t.product))).toBeUndefined()
  })

  it('ignores fields with no assessment', () => {
    expect(totalsByProduct([buildRequirement('x', 'X', null, 10, null)])).toEqual([])
  })
})

describe('microTotals', () => {
  it('totals micronutrients as actual nutrient, not product weight', () => {
    // 10% chelate and 36% sulphate are not one order line; adding their product
    // weights would produce a tonnage of nothing you could buy.
    const reqs = [
      buildRequirement('a', 'A', null, 100, [rec({ nutrient: 'Zn', product: '10% Zn-EDTA', lb_per_ac: 1.5 })]),
      buildRequirement('b', 'B', null, 200, [rec({ nutrient: 'Zn', product: '36% zinc sulphate', lb_per_ac: 2 })]),
    ]
    const t = microTotals(reqs)
    expect(t).toHaveLength(1)
    expect(t[0]).toMatchObject({ nutrient: 'Zn', totalLb: 1.5 * 100 + 2 * 200 })
    expect(t[0].products).toHaveLength(2)
  })

  it('excludes anything that already has an analysis', () => {
    const reqs = [buildRequirement('a', 'A', null, 100, [rec({ nutrient: 'N', product: '46-0-0 urea', lb_per_ac: 46 })])]
    expect(microTotals(reqs)).toEqual([])
  })

  it('excludes the non-products too', () => {
    const reqs = [buildRequirement('a', 'A', null, 100, [rec({ nutrient: 'B', product: 'none', lb_per_ac: 1 })])]
    expect(microTotals(reqs)).toEqual([])
  })
})

describe('totalsByNutrient', () => {
  it('totals actual nutrient across the farm', () => {
    const t = totalsByNutrient([
      buildRequirement('a', 'A', null, 100, [rec({ nutrient: 'N', lb_per_ac: 50 })]),
      buildRequirement('b', 'B', null, 200, [rec({ nutrient: 'N', lb_per_ac: 50 })]),
    ])
    expect(t[0]).toMatchObject({ nutrient: 'N', totalLb: 15000, fields: 2 })
  })

  it('leaves out fields with unknown acres, since the total would be wrong', () => {
    const t = totalsByNutrient([
      buildRequirement('a', 'A', null, null, [rec({ nutrient: 'N', lb_per_ac: 50 })]),
    ])
    expect(t).toEqual([])
  })

  it('sorts heaviest first', () => {
    const t = totalsByNutrient([
      buildRequirement('a', 'A', null, 100, [
        rec({ nutrient: 'N', lb_per_ac: 100 }),
        rec({ nutrient: 'S', lb_per_ac: 10 }),
        rec({ nutrient: 'P2O5', lb_per_ac: 40 }),
      ]),
    ])
    expect(t.map((x) => x.nutrient)).toEqual(['N', 'P2O5', 'S'])
  })
})
