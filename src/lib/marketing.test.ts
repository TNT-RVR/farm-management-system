import { describe, expect, it } from 'vitest'
import {
  basis,
  basisPercentile,
  breakeven,
  cashFlow,
  evaluateTarget,
  isMarketable,
  marginPerUnit,
  monthsBetween,
  summarise,
  totalCostPerAcre,
  type ContractForFlow,
  type Position,
  type Target,
} from './marketing'

const pos = (over: Partial<Position> = {}): Position => ({
  cropId: 'c1',
  cropName: 'Canola',
  cropYear: 2026,
  unit: 'bu',
  category: 'commercial',
  acres: 322,
  expected: 22553,
  contracted: 0,
  contractedValue: 0,
  delivered: 0,
  onhand: 0,
  cleanAcres: 0,
  preCleanAcres: 0,
  ...over,
})

describe('summarise', () => {
  it('reports everything open when nothing is contracted', () => {
    const s = summarise(pos())
    expect(s.open).toBe(22553)
    expect(s.pricedFraction).toBe(0)
    expect(s.avgContractPrice).toBeNull()
  })

  it('averages the contract price over contracted quantity, not over expected', () => {
    const s = summarise(pos({ contracted: 10000, contractedValue: 141000 }))
    expect(s.avgContractPrice).toBeCloseTo(14.1)
    expect(s.open).toBe(12553)
  })

  it('never reports a negative open position, and names the oversold instead', () => {
    const s = summarise(pos({ expected: 10000, contracted: 12000 }))
    expect(s.open).toBe(0)
    expect(s.oversold).toBe(2000)
    expect(s.pricedFraction).toBe(1)
  })

  it('values the open position at a given price', () => {
    const s = summarise(pos({ expected: 1000, contracted: 400 }))
    expect(s.openValueAt(15)).toBe(9000)
    expect(s.openValueAt(null)).toBeNull()
  })

  it('has no fraction to report when nothing is expected', () => {
    expect(summarise(pos({ expected: 0 })).pricedFraction).toBeNull()
  })
})

describe('isMarketable', () => {
  it('leaves out what is never sold', () => {
    expect(isMarketable({ category: 'own_use', unit: 'lbs' })).toBe(false)
    expect(isMarketable({ category: 'own_use', unit: 'ac' })).toBe(false)
    expect(isMarketable({ category: 'commercial', unit: 'bu' })).toBe(true)
    expect(isMarketable({ category: 'seed', unit: 'lbs' })).toBe(true)
  })
})

describe('breakeven', () => {
  it('divides cost per acre by yield per acre', () => {
    expect(breakeven(700, 70)).toBe(10)
  })

  it('refuses a zero or unknown yield rather than returning infinity', () => {
    expect(breakeven(700, 0)).toBeNull()
    expect(breakeven(700, -5)).toBeNull()
    expect(breakeven(Number.NaN, 70)).toBeNull()
  })

  it('adds up cost lines, ignoring any that are not numbers', () => {
    expect(
      totalCostPerAcre([
        { category: 'seed', costPerAcre: 90 },
        { category: 'fert', costPerAcre: 210 },
        { category: 'chem', costPerAcre: Number.NaN },
      ]),
    ).toBe(300)
  })

  it('gives a margin only when both halves are known', () => {
    expect(marginPerUnit(15, 10)).toBe(5)
    expect(marginPerUnit(null, 10)).toBeNull()
    expect(marginPerUnit(15, null)).toBeNull()
  })
})

describe('basis', () => {
  it('keeps the sign, because inland basis is normally negative', () => {
    expect(basis(13.5, 14.2)).toBeCloseTo(-0.7)
    expect(basis(14.6, 14.2)).toBeCloseTo(0.4)
  })

  it('is unknown when either side is', () => {
    expect(basis(null, 14.2)).toBeNull()
    expect(basis(13.5, null)).toBeNull()
  })

  it('places a basis in its own history', () => {
    const history = [
      { on: '2026-01-01', basis: -1.0 },
      { on: '2026-02-01', basis: -0.8 },
      { on: '2026-03-01', basis: -0.4 },
      { on: '2026-04-01', basis: -0.2 },
    ]
    // Three of the four are below -0.30, so it sits at the 75th percentile:
    // a better basis than three quarters of what has been seen.
    expect(basisPercentile(history, -0.3)).toBe(0.75)
    expect(basisPercentile(history, -0.9)).toBe(0.25)
    expect(basisPercentile(history, -2)).toBe(0)
  })

  it('says nothing from too little history', () => {
    expect(basisPercentile([{ on: '2026-01-01', basis: -1 }], -0.5)).toBeNull()
  })
})

describe('monthsBetween', () => {
  it('spans a year boundary', () => {
    expect(monthsBetween('2026-11', '2027-02')).toEqual([
      '2026-11',
      '2026-12',
      '2027-01',
      '2027-02',
    ])
  })

  it('returns the single month when start and end match', () => {
    expect(monthsBetween('2026-11', '2026-11')).toEqual(['2026-11'])
  })

  it('does not spin on a reversed range', () => {
    expect(monthsBetween('2027-02', '2026-11')).toEqual(['2027-02'])
  })
})

describe('cashFlow', () => {
  const c = (over: Partial<ContractForFlow>): ContractForFlow => ({
    id: 'k1',
    cropName: 'Canola',
    bushels: 1000,
    pricePerUnit: 14,
    deliveryStart: '2026-11-01',
    deliveryEnd: '2026-11-30',
    deliveredBu: 0,
    ...over,
  })

  it('puts a single-month contract in its month', () => {
    const { months } = cashFlow([c({})])
    expect(months).toEqual([{ month: '2026-11', revenue: 14000, contracts: ['Canola'] }])
  })

  it('spreads a window evenly across the months it spans', () => {
    const { months } = cashFlow([c({ deliveryEnd: '2027-01-31' })])
    expect(months.map((m) => m.month)).toEqual(['2026-11', '2026-12', '2027-01'])
    expect(months.every((m) => Math.abs(m.revenue - 14000 / 3) < 0.01)).toBe(true)
  })

  it('sets aside contracts with no delivery window rather than guessing one', () => {
    const { months, undated } = cashFlow([c({ deliveryStart: null, deliveryEnd: null })])
    expect(months).toEqual([])
    expect(undated).toHaveLength(1)
  })

  it('ignores a contract with no value at all', () => {
    const { months, undated } = cashFlow([c({ bushels: null, pricePerUnit: null })])
    expect(months).toEqual([])
    expect(undated).toEqual([])
  })

  it('names each crop once in a month several contracts share', () => {
    const { months } = cashFlow([c({ id: 'a' }), c({ id: 'b' })])
    expect(months[0].contracts).toEqual(['Canola'])
    expect(months[0].revenue).toBe(28000)
  })
})

describe('evaluateTarget', () => {
  const t = (over: Partial<Target>): Target => ({
    id: 't1',
    cropId: 'c1',
    cropYear: 2026,
    mode: 'absolute',
    value: 15,
    quantity: null,
    note: null,
    active: true,
    ...over,
  })

  it('reads an absolute target straight off', () => {
    const s = evaluateTarget(t({}), null, 14.5)
    expect(s.threshold).toBe(15)
    expect(s.hit).toBe(false)
    expect(s.distance).toBeCloseTo(-0.5)
  })

  it('fires when the market reaches it', () => {
    expect(evaluateTarget(t({}), null, 15).hit).toBe(true)
  })

  it('moves a margin target with the cost of production', () => {
    const target = t({ mode: 'over_breakeven', value: 2 })
    expect(evaluateTarget(target, 11, 14).threshold).toBe(13)
    expect(evaluateTarget(target, 11, 14).hit).toBe(true)
    // Costs rise, the target rises with them, and the same price no longer clears.
    expect(evaluateTarget(target, 12.5, 14).hit).toBe(false)
  })

  it('refuses to resolve a margin target with no breakeven', () => {
    const s = evaluateTarget(t({ mode: 'over_breakeven', value: 2 }), null, 14)
    expect(s.threshold).toBeNull()
    expect(s.hit).toBe(false)
  })
})
