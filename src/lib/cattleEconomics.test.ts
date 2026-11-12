import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CULL_PCT,
  breakEven,
  compareStrategies,
  lockInSignals,
  valueOfGain,
  COST_LINE_KEYS,
  COW_CALF_BENCHMARK_COSTS,
  abCowCashCostPerYear,
  abCowCostLines,
  abCowCostPerYear,
  benchmarkTotalPerCow,
  ownGrass,
  type CattleCosts,
} from './cattleEconomics'

const costs = (over: Partial<CattleCosts> = {}): CattleCosts => ({
  id: 'x',
  ranch: 'Home Ranch',
  crop_year: 2026,
  cow_cost_per_head: 400,
  feed_cost_per_head: 500,
  pasture_cost_per_head: 300,
  vet_cost_per_head: 60,
  other_cost_per_head: 40,
  death_loss_pct: 2,
  weaning_rate_pct: 92,
  cost_of_gain_per_lb: 1.4,
  notes: null,
  ...over,
})

describe('breakEven', () => {
  it('divides by the calves actually weaned, not by the cows', () => {
    // A 92% weaning rate means about nine calves carry the cost of ten cows.
    // Weaning % is calves weaned ÷ cows exposed, so the 2% death loss is
    // already in it — it is not taken off a second time.
    const b = breakEven(costs(), 450)!
    expect(b.costPerCow).toBe(1300)
    expect(b.calvesPerCow).toBeCloseTo(0.92, 6)
    expect(b.costPerCalf).toBeCloseTo(1300 / 0.92, 4)
    expect(b.costPerCalf).toBeGreaterThan(b.costPerCow)
    expect(b.cullCreditPerCow).toBeNull()
  })

  it('takes the cull cows’ cheque off before the calves pay', () => {
    // 12% culled at a $2,800 cheque is $336 a cow wintered.
    const b = breakEven(costs(), 450, { cullCheque: 2800 })!
    expect(b.cullPct).toBe(DEFAULT_CULL_PCT)
    expect(b.cullCreditPerCow).toBeCloseTo(336, 6)
    expect(b.costPerCalf).toBeCloseTo((1300 - 336) / 0.92, 6)
    expect(b.perLb).toBeCloseTo((1300 - 336) / 0.92 / 450, 6)
    expect(b.perCwt).toBeCloseTo(b.perLb! * 100, 6)
    // The ranch's own cull % and other revenue.
    const own = breakEven(costs({ cull_pct: 15 }), 450, { cullCheque: 2800, otherRevenuePerCow: 50 })!
    expect(own.costPerCalf).toBeCloseTo((1300 - 420 - 50) / 0.92, 6)
  })

  it('falls back on calf loss when no weaning rate is entered', () => {
    const b = breakEven(costs({ weaning_rate_pct: null, calf_loss_pct: 5 }), 450)!
    expect(b.calvesPerCow).toBeCloseTo(0.95, 6)
  })

  it('gives the price a calf has to fetch', () => {
    const b = breakEven(costs(), 450)!
    expect(b.perLb).toBeCloseTo(b.costPerCalf / 450, 6)
    // Sanity: around $3.20/lb on these numbers, well under 2025's $6.46.
    expect(b.perLb!).toBeGreaterThan(2.5)
    expect(b.perLb!).toBeLessThan(4)
  })

  it('names the cost lines that were left blank instead of assuming zero', () => {
    // A break-even that quietly leaves out feed reads as good news.
    const b = breakEven(costs({ feed_cost_per_head: null, vet_cost_per_head: null }), 450)!
    expect(b.missing).toEqual(['feed', 'vet'])
  })

  it('says nothing at all without costs or with nothing entered', () => {
    expect(breakEven(null, 450)).toBeNull()
    expect(
      breakEven(
        costs({
          cow_cost_per_head: null,
          feed_cost_per_head: null,
          pasture_cost_per_head: null,
          vet_cost_per_head: null,
          other_cost_per_head: null,
        }),
        450,
      ),
    ).toBeNull()
  })

  it('withholds the per-pound figure when the weight is unknown', () => {
    expect(breakEven(costs(), null)!.perLb).toBeNull()
  })
})

describe('valueOfGain', () => {
  it('is the whole cheque difference, not 100 lb at today’s price', () => {
    // The trap: a heavier calf sells for LESS per pound. 450 lb at $6.50 is
    // $2,925; 550 lb at $6.00 is $3,300. The extra 100 lb is worth $375, not
    // the $650 a naive reading gives.
    const v = valueOfGain(450, 6.5, 550, 6.0, null)!
    expect(v.extraRevenue).toBeCloseTo(375, 6)
    expect(v.valuePerLb).toBeCloseTo(3.75, 6)
    expect(v.valuePerLb).toBeLessThan(6.5)
  })

  it('nets off what those pounds cost to put on', () => {
    const v = valueOfGain(450, 6.5, 550, 6.0, 1.4)!
    expect(v.extraCost).toBeCloseTo(140, 6)
    expect(v.marginPerHead).toBeCloseTo(235, 6)
  })

  it('leaves the margin unknown when the cost of gain is', () => {
    expect(valueOfGain(450, 6.5, 550, 6.0, null)!.marginPerHead).toBeNull()
  })

  it('refuses to run backwards', () => {
    expect(valueOfGain(550, 6, 450, 6.5, 1.4)).toBeNull()
  })
})

describe('compareStrategies', () => {
  const base = {
    weanLb: 450,
    weanPricePerLb: 6.5,
    backgroundToLb: 550,
    backgroundPricePerLb: 6.0,
    costOfGainPerLb: 1.4,
    forwardPricePerLb: 6.46,
  }

  it('puts three real numbers side by side', () => {
    const s = compareStrategies(base)
    expect(s[0].netPerHead).toBeCloseTo(2925, 4)
    expect(s[1].netPerHead).toBeCloseTo(2925 + 235, 4)
    expect(s[2].netPerHead).toBeCloseTo(450 * 6.46, 4)
  })

  it('leaves an option blank rather than guessing an input', () => {
    // Three options where one is quietly filled in is not a comparison, it is
    // a recommendation in disguise.
    const s = compareStrategies({ ...base, forwardPricePerLb: null })
    expect(s[2].netPerHead).toBeNull()
    expect(s[2].detail).toMatch(/needs a forward bid/)
  })

  it('always states what each option exposes you to', () => {
    for (const s of compareStrategies(base)) expect(s.risk.length).toBeGreaterThan(10)
  })
})

describe('lockInSignals', () => {
  const base = {
    forwardPricePerLb: 6.46,
    historyPricesPerLb: [2.07, 2.16, 2.14, 2.46, 4.0, 5.3],
    basis: -20,
    basisHistory: [-60, -55, -50, -45, -40, -35, -30, -25],
    curveSlope: -8,
    breakEvenPerLb: 3.2,
  }

  it('reads each input separately rather than blending them into a score', () => {
    const s = lockInSignals(base)
    expect(s).toHaveLength(4)
    expect(s.map((x) => x.label)).toContain('Basis')
    // Every signal explains itself; none of them says "sell".
    for (const x of s) expect(x.why.length).toBeGreaterThan(10)
  })

  it('leans toward locking in when the bid is high against our own record', () => {
    const h = lockInSignals(base).find((s) => s.label === 'Against our own history')!
    expect(h.lean).toBe('lock')
    expect(h.reading).toBe('Highest price in 6 years')
  })

  it('leans toward waiting when a curve slopes up', () => {
    const s = lockInSignals({ ...base, curveSlope: 12 })
    const curve = s.find((x) => x.label === 'Later months on the futures board')!
    expect(curve.lean).toBe('wait')
    expect(curve.reading).toBe('Later months bid US$12.00/cwt higher')
  })

  it('names the price it compares with break-even, and quotes today’s beside a forward bid', () => {
    // Home Ranch, 3 Nov 2026: December bid $6.66, today $7.37, break-even $3.87.
    const s = lockInSignals({ ...base, forwardPricePerLb: 6.66, breakEvenPerLb: 3.87, forwardMonth: 'December', todayPricePerLb: 7.37 })
    const be = s.find((x) => x.label.endsWith('vs break-even'))!
    expect(be.label).toBe('December bid vs break-even')
    expect(be.reading).toBe('+$2.79/lb')
    expect(be.why).toContain('$7.37')
    expect(be.why).toContain('+$3.50/lb')
    const today = lockInSignals({ ...base, priceKind: 'today', forwardPricePerLb: 7.37, breakEvenPerLb: 3.87 })
    expect(today.find((x) => x.label.endsWith('vs break-even'))!.label).toBe("Today's price vs break-even")
  })

  it('omits a signal it has too little history for', () => {
    const s = lockInSignals({ ...base, basisHistory: [-40, -35], historyPricesPerLb: [5] })
    expect(s.map((x) => x.label)).not.toContain('Basis')
    expect(s.map((x) => x.label)).not.toContain('Against our own history')
  })
})

describe('what a cow costs for a year in Alberta', () => {
  it('is the published 2024 benchmark in its own year', () => {
    // Canfax, October 2025: $1,059 cash + $257 depreciation + $422 opportunity.
    expect(abCowCostPerYear(2024)).toBe(1738)
    expect(abCowCashCostPerYear(2024)).toBe(1059)
  })

  it('carries forward at the rise the Network itself measures', () => {
    expect(abCowCostPerYear(2026)).toBe(1738 + 2 * 110)
    expect(abCowCashCostPerYear(2026)).toBe(1059 + 2 * 70)
  })

  it('never indexes backwards', () => {
    expect(abCowCostPerYear(2019)).toBe(1738)
  })

  it('splits into five lines that add to the total', () => {
    const lines = abCowCostLines(2026)
    const total = COST_LINE_KEYS.reduce((a, k) => a + lines[k], 0)
    expect(total).toBe(abCowCostPerYear(2026))
    // Manitoba's shape at Alberta's size: feed is still the biggest single line.
    expect(lines.feed_cost_per_head).toBeGreaterThan(lines.cow_cost_per_head)
    expect(lines.vet_cost_per_head).toBeLessThan(lines.pasture_cost_per_head)
    // The pasture line keeps the grass's worth; it is not the rent-stripped one.
    expect(lines.pasture_cost_per_head).toBeGreaterThan(ownGrass(COW_CALF_BENCHMARK_COSTS.pasture_cost_per_head))
  })

  it('adds up at every year it could be asked for', () => {
    for (const y of [2024, 2025, 2026, 2030, 2040]) {
      const lines = abCowCostLines(y)
      expect(COST_LINE_KEYS.reduce((a, k) => a + lines[k], 0)).toBe(abCowCostPerYear(y))
    }
  })

  it('stays in the range a Prairie cow-calf budget would recognise', () => {
    // A sanity rail: if indexing ever runs away, this is what catches it.
    expect(abCowCostPerYear(new Date().getFullYear())).toBeGreaterThan(1200)
    expect(abCowCostPerYear(new Date().getFullYear())).toBeLessThan(2600)
  })
})

describe('the benchmark starting point', () => {
  it('adds up to something a Prairie cow-calf budget would recognise', () => {
    // Manitoba's September 2025 budget, mapped onto our five lines.
    expect(benchmarkTotalPerCow).toBe(1811)
    expect(benchmarkTotalPerCow).toBeGreaterThan(1200)
    expect(benchmarkTotalPerCow).toBeLessThan(2600)
  })

  it('produces a break-even in the range that budget itself reports', () => {
    // That budget puts the break-even over total costs at $356/cwt on a weaned
    // calf — $3.56/lb. Ours should land near it at a similar weaning weight.
    const b = breakEven(
      { ...COW_CALF_BENCHMARK_COSTS, id: 'x', ranch: 'r', crop_year: 2026, notes: null } as CattleCosts,
      500,
    )!
    expect(b.perLb!).toBeGreaterThan(3.0)
    expect(b.perLb!).toBeLessThan(4.5)
  })

  it('leaves death loss out of the cost lines', () => {
    // The source budget carries a $62.50 death-loss cost. We model it as a
    // percentage instead, and charging both would bill for it twice.
    expect(COW_CALF_BENCHMARK_COSTS.death_loss_pct).toBe(2)
    const total =
      COW_CALF_BENCHMARK_COSTS.cow_cost_per_head +
      COW_CALF_BENCHMARK_COSTS.feed_cost_per_head +
      COW_CALF_BENCHMARK_COSTS.pasture_cost_per_head +
      COW_CALF_BENCHMARK_COSTS.vet_cost_per_head +
      COW_CALF_BENCHMARK_COSTS.other_cost_per_head
    expect(total).toBe(benchmarkTotalPerCow)
  })
})
