import { describe, expect, it } from 'vitest'
import {
  heiferOverridesKey,
  loadHeiferOverrides,
  parseHeiferOverrides,
  planHeifers,
  priceSaleOptions,
  saveHeiferOverrides,
  type HeiferInputs,
} from './replacementHeifers'

const sale = priceSaleOptions(
  [
    { key: 'weaning', label: 'At weaning', when: 'Dec', weightLb: 430, pricePerLb: 5.3, costPerHead: 0 },
    { key: 'wintered', label: 'Wintered', when: 'Apr', weightLb: 550, pricePerLb: 4.6, costPerHead: 120 * 1.4 },
    { key: 'yearling', label: 'Yearling', when: 'Sep', weightLb: 850, pricePerLb: 3.6, costPerHead: 170 * 1.4 + 150 },
  ],
  2,
)

const base: HeiferInputs = {
  cows: 320,
  heiferCalves: 140,
  cullPct: 12,
  deathPct: 2,
  pregPct: 88,
  weaningPct: 92,
  capacityCows: 360,
  growthYears: 3,
  annualCowCost: 1800,
  devCostPerHeifer: 900,
  calfValue: 2600,
  cullCowValue: 2400,
  productiveYears: 6,
  discountPct: 6,
  overstockCostPerCow: 500,
  sale,
}

describe('replacement heifers', () => {
  it('prices each sale option net of gain cost and holding death loss', () => {
    expect(sale[0].netPerHead).toBeCloseTo(430 * 5.3, 6)
    expect(sale[1].netPerHead).toBeCloseTo(550 * 4.6 * 0.98 - 168, 6)
    expect(sale[2].netPerHead).toBeCloseTo(850 * 3.6 * 0.98 * 0.98 - 388, 6)
  })
  it('replaces culls and deaths, and grows into spare grass when keeping pays', () => {
    const p = planHeifers(base)
    // 14% of 320 cows = 44.8 leave; 88% bred → 51 to hold steady.
    expect(p.maintain).toBe(51)
    expect(p.gainPerHeiferKept).toBeGreaterThan(0)
    // +40 cows of room over 3 years.
    expect(p.recommended).toBe(Math.ceil((44.8 + 40 / 3) / 0.88))
    const at = p.rows.find((r) => r.keep === p.recommended)!
    expect(at.netVsSellAll).toBeGreaterThan(0)
  })
  it('keeps fewer when the herd is over what the grass carries', () => {
    const p = planHeifers({ ...base, capacityCows: 290 })
    expect(p.recommended).toBeLessThan(p.maintain)
    expect(p.reason).toMatch(/over what the grass carries/)
  })
  it('holds steady rather than grow when a sold heifer is worth more', () => {
    const p = planHeifers({ ...base, calfValue: 1500 })
    expect(p.gainPerHeiferKept).toBeLessThan(0)
    expect(p.recommended).toBe(p.maintain)
  })
})

describe('stored assumptions', () => {
  it('keeps numbers and cleared fields, drops junk', () => {
    expect(parseHeiferOverrides('{"cullValue":1650,"capacity":null,"x":"7","y":true}')).toEqual({ cullValue: 1650, capacity: null })
    expect(parseHeiferOverrides(null)).toEqual({})
    expect(parseHeiferOverrides('not json')).toEqual({})
    expect(parseHeiferOverrides('[1,2]')).toEqual({})
  })
  it('keys by ranch and never throws without storage', () => {
    expect(heiferOverridesKey('abc')).toBe('rvr.replacementHeifers.abc')
    expect(() => loadHeiferOverrides('abc')).not.toThrow()
    expect(() => saveHeiferOverrides('abc', { cull: 10 })).not.toThrow()
  })
})
