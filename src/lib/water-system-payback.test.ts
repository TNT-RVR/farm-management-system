import { describe, expect, it } from 'vitest'
import {
  LARDNER,
  DEFAULT_SYSTEMS,
  herdBenefit,
  herdProblems,
  netAfter,
  purchasesWithin,
  seasonGainLb,
  waterSystemPayback,
  type WaterHerd,
  type WaterSystem,
} from './water-system-payback'

const pairs: WaterHerd = { kind: 'cow_calf', head: 100, salePricePerLb: 3.75, cullShare: 0.12, cullPricePerLb: 1.55 }
const yearlings: WaterHerd = { kind: 'yearling', head: 100, salePricePerLb: 3.3 }

const system = (over: Partial<WaterSystem> = {}): WaterSystem => ({
  key: 's',
  label: 'Solar pump',
  capital: 10000,
  funding: 0,
  powerPerYear: 0,
  maintenancePerYear: 100,
  lifeYears: 15,
  ...over,
})

describe('seasonGainLb', () => {
  it('adds each period at its own daily gain', () => {
    expect(LARDNER.periods.map((p) => p.days)).toEqual([69, 61])
    // The calf row: 0.154322 for 69 days, then 0.088184 for 61.
    expect(seasonGainLb(LARDNER.gain.calf)).toBeCloseTo(69 * 0.154322 + 61 * 0.088184, 6)
    expect(seasonGainLb(LARDNER.gain.calf)).toBeCloseTo(16.03, 2)
    expect(seasonGainLb(LARDNER.gain.cow)).toBeCloseTo(49.61, 2)
    expect(seasonGainLb(LARDNER.gain.yearling)).toBeCloseTo(10.32, 2)
    expect(seasonGainLb(LARDNER.gain.yearlingAerated)).toBeCloseTo(22.21, 2)
  })
  it('prints daily gains, at 3 decimals, that multiply out to the printed season total', () => {
    // The page prints these rates to 3 places and the season to 1.
    for (const rates of [LARDNER.gain.calf, LARDNER.gain.yearling, LARDNER.gain.yearlingAerated]) {
      const printed = rates.map((r) => Number(r.toFixed(3)))
      expect(seasonGainLb(printed).toFixed(1)).toBe(seasonGainLb(rates).toFixed(1))
    }
  })
  it('treats a missing period as no gain rather than NaN', () => {
    expect(seasonGainLb([0.1])).toBeCloseTo(69 * 0.1, 6)
    expect(seasonGainLb([])).toBe(0)
  })
})

describe('herdBenefit', () => {
  it('banks the calf gain in full', () => {
    const b = herdBenefit(pairs)
    expect(b.salableGainLb).toBeCloseTo(16.03, 2)
    expect(b.salableValue).toBeCloseTo(16.0275 * 3.75, 3)
  })

  it('banks the cow gain only on the cows that leave this year', () => {
    /*
     * The BCRC works the cow gain out and never reads it again. Fifty pounds
     * on a cow is real but it is condition, not a cheque -- she is not sold.
     * Here it is money only on the culls.
     */
    const b = herdBenefit(pairs)
    expect(b.cowGainLb).toBeCloseTo(49.61, 2)
    expect(b.cullValue).toBeCloseTo(49.61 * 0.12 * 1.55, 2)
    // Far smaller than counting all 50 lb on every cow would be.
    expect(b.cullValue).toBeLessThan(b.cowGainLb * 1.55 * 0.5)
    expect(b.perHeadPerYear).toBeCloseTo(b.salableValue + b.cullValue, 6)
  })

  it('banks nothing for the cows when none are sold', () => {
    const b = herdBenefit({ ...pairs, cullShare: 0 })
    expect(b.cowGainLb).toBeCloseTo(49.61, 2)
    expect(b.cullValue).toBe(0)
    expect(b.perHeadPerYear).toBeCloseTo(b.salableValue, 6)
  })

  it('has no cow gain to report for yearlings, and pays more for aerated water', () => {
    const plain = herdBenefit(yearlings)
    const aerated = herdBenefit({ ...yearlings, aerated: true })
    expect(plain.cowGainLb).toBe(0)
    expect(plain.cullValue).toBe(0)
    expect(plain.perHeadPerYear).toBeCloseTo(10.32 * 3.3, 1)
    expect(aerated.perHeadPerYear).toBeGreaterThan(plain.perHeadPerYear)
  })
})

describe('waterSystemPayback', () => {
  it('pays the capital back out of the benefit LESS the running costs', () => {
    const r = waterSystemPayback(pairs, [system()])
    const s = r.systems[0]
    expect(s.capitalPerHead).toBe(100)
    expect(s.runningPerHead).toBe(1)
    expect(s.netPerHeadPerYear).toBeCloseTo(r.benefit.perHeadPerYear - 1, 6)
    expect(s.paybackYears).toBeCloseTo(100 / s.netPerHeadPerYear, 6)
    // Their figure leaves the running costs out, so it is always the shorter.
    expect(s.paybackYearsTheirWay!).toBeLessThan(s.paybackYears!)
  })

  it('takes the grant off the capital before paying it back', () => {
    const withGrant = waterSystemPayback(pairs, [system({ funding: 4000 })]).systems[0]
    expect(withGrant.fundingPerHead).toBe(40)
    expect(withGrant.netCapitalPerHead).toBe(60)
    expect(withGrant.paybackYears).toBeCloseTo(60 / withGrant.netPerHeadPerYear, 6)
  })

  it('says NEVER rather than a tidy number when the upkeep eats the benefit', () => {
    /*
     * The failure their formula hides. A system costing more to run than the
     * water earns still gets a finite payback out of (capital - funding) /
     * benefit, because that line never looks at the upkeep.
     */
    const r = waterSystemPayback(pairs, [system({ maintenancePerYear: 100_000 })]).systems[0]
    expect(r.netPerHeadPerYear).toBeLessThan(0)
    expect(r.paybackYears).toBeNull()
    expect(r.paysWithinLife).toBe(false)
    // Theirs still answers, cheerfully.
    expect(r.paybackYearsTheirWay).toBeGreaterThan(0)
  })

  it('knows the difference between paying back and wearing out', () => {
    const quick = waterSystemPayback(pairs, [system({ capital: 5000, lifeYears: 15 })]).systems[0]
    const slow = waterSystemPayback(pairs, [system({ capital: 150_000, lifeYears: 15 })]).systems[0]
    expect(quick.paysWithinLife).toBe(true)
    expect(slow.paybackYears).toBeGreaterThan(15)
    expect(slow.paysWithinLife).toBe(false)
  })

  it('sorts soonest payback first and puts the hopeless ones last', () => {
    const r = waterSystemPayback(pairs, [
      system({ key: 'dear', capital: 40_000 }),
      system({ key: 'never', maintenancePerYear: 100_000 }),
      system({ key: 'cheap', capital: 4000 }),
    ])
    expect(r.systems.map((s) => s.key)).toEqual(['cheap', 'dear', 'never'])
  })

  it('counts the capital once and the running costs every year', () => {
    const s = waterSystemPayback(pairs, [system()]).systems[0]
    expect(netAfter(s, 0)).toBeCloseTo(-s.netCapitalPerHead, 6)
    expect(netAfter(s, 5)).toBeCloseTo(s.netPerHeadPerYear * 5 - s.netCapitalPerHead, 6)
    // At its own payback year the net is nil, which is what payback means.
    expect(netAfter(s, s.paybackYears!)).toBeCloseTo(0, 6)
  })

  it('buys the system again each time it wears out inside the look-ahead', () => {
    // A 10-year pipeline over 40 years is bought at 0, 10, 20 and 30.
    expect(purchasesWithin(10, 40)).toBe(4)
    expect(purchasesWithin(10, 10)).toBe(1)
    expect(purchasesWithin(10, 10.5)).toBe(2)
    expect(purchasesWithin(10, 0)).toBe(1)
    expect(purchasesWithin(0, 40)).toBe(1)
    const s = waterSystemPayback(pairs, [system({ lifeYears: 10, funding: 4000 })]).systems[0]
    // Inside its life, capital once (after the grant).
    expect(netAfter(s, 10)).toBeCloseTo(s.netPerHeadPerYear * 10 - s.netCapitalPerHead, 6)
    // Over 40 years, three more at full price: the grant was a one-off.
    expect(netAfter(s, 40)).toBeCloseTo(s.netPerHeadPerYear * 40 - s.netCapitalPerHead - 3 * s.capitalPerHead, 6)
  })

  it('refuses a herd it cannot cost', () => {
    expect(herdProblems(pairs)).toEqual({})
    expect(herdProblems({ ...pairs, head: 0 }).head).toMatch(/head count/)
    expect(herdProblems({ ...pairs, head: -40 }).head).toMatch(/head count/)
    expect(herdProblems({ ...pairs, salePricePerLb: -3 }).salePricePerLb).toBeTruthy()
    expect(herdProblems({ ...pairs, cullShare: 2.5 }).cullShare).toBeTruthy()
    expect(herdProblems({ ...pairs, cullShare: 1 })).toEqual({})
    expect(herdProblems({ ...pairs, cullPricePerLb: -1 }).cullPricePerLb).toBeTruthy()
    // Yearlings have no culls to check.
    expect(herdProblems({ ...yearlings, cullShare: 9 })).toEqual({})
  })

  it('does not divide by a herd of nothing', () => {
    const r = waterSystemPayback({ ...pairs, head: 0 }, [system()])
    expect(r.systems[0].capitalPerHead).toBe(0)
    expect(Number.isFinite(r.systems[0].netPerHeadPerYear)).toBe(true)
  })

  it('prices the four systems the BCRC lists', () => {
    const r = waterSystemPayback(pairs, DEFAULT_SYSTEMS)
    expect(r.systems).toHaveLength(4)
    expect(r.systems.every((s) => Number.isFinite(s.capitalPerHead))).toBe(true)
    // The cheapest to put in should be first on this herd.
    expect(r.systems[0].key).toBe('solar')
  })
})
