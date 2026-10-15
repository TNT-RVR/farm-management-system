import { describe, expect, it } from 'vitest'
import {
  breakEven,
  compareStrategies,
  lockInSignals,
  valueOfGain,
  COW_CALF_BENCHMARK_COSTS,
  benchmarkTotalPerCow,
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
  it('divides by the calves actually sold, not by the cows', () => {
    // 92% weaning and 2% death loss means about nine calves carry the cost of
    // ten cows. Dividing by cows understates the break-even by a tenth.
    const b = breakEven(costs(), 450)!
    expect(b.costPerCow).toBe(1300)
    expect(b.calvesPerCow).toBeCloseTo(0.92 * 0.98, 6)
    expect(b.costPerCalf).toBeCloseTo(1300 / (0.92 * 0.98), 4)
    expect(b.costPerCalf).toBeGreaterThan(b.costPerCow)
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
  it('is the whole cheque difference, not 100 lb at todayâ€™s price', () => {
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
    expect(lockInSignals(base).find((s) => s.label === 'Against our own history')!.lean).toBe('lock')
  })

  it('leans toward waiting when a curve slopes up', () => {
    const s = lockInSignals({ ...base, curveSlope: 12 })
    expect(s.find((x) => x.label === 'Forward curve')!.lean).toBe('wait')
  })

  it('omits a signal it has too little history for', () => {
    const s = lockInSignals({ ...base, basisHistory: [-40, -35], historyPricesPerLb: [5] })
    expect(s.map((x) => x.label)).not.toContain('Basis')
    expect(s.map((x) => x.label)).not.toContain('Against our own history')
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
    // calf â€” $3.56/lb. Ours should land near it at a similar weaning weight.
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
