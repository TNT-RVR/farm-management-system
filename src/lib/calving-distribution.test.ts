import { describe, expect, it } from 'vitest'
import {
  CYCLE_DAYS,
  INDUSTRY_TARGET,
  THREE_CYCLES,
  breakEvenOpenCows,
  cycleMidpointDays,
  cycleWeaningWeights,
  firstCalfAgeDays,
  lbPerCycleSlipped,
  sharesFromCounts,
  valueOfDistribution,
  type DistributionInputs,
  type Scenario,
} from './calving-distribution'

/** The BCRC sheet's own worked example. */
const farm: DistributionInputs = {
  firstCalfOn: '2026-02-15',
  weaningOn: '2026-11-15', // 273 days
  birthWeightLb: 85,
  adgLbPerDay: 1.85,
  born: [55, 20, 15, 10],
  calfDeathLoss: 2,
  salePricePerLb: 5.95,
}

const mine: Scenario = { key: 'mine', label: 'As it stands', shares: sharesFromCounts(farm.born)! }
const target: Scenario = { key: 'target', label: 'Industry target', shares: INDUSTRY_TARGET }

describe('the cycle arithmetic', () => {
  it('puts the average calf in the middle of its cycle, not at the edge', () => {
    /*
     * The BCRC offsets by 10, 31, 52 and 73 days. The middle of a 21-day
     * window is 10.5, so every weaning weight in their sheet is about a pound
     * light. The GAPS are right, which is why their comparison still works.
     */
    expect(cycleMidpointDays(0)).toBe(10.5)
    expect(cycleMidpointDays(1)).toBe(31.5)
    expect(cycleMidpointDays(2)).toBe(52.5)
    expect(cycleMidpointDays(3)).toBe(73.5)
    for (let k = 1; k < 4; k++) expect(cycleMidpointDays(k) - cycleMidpointDays(k - 1)).toBe(CYCLE_DAYS)
  })

  it('costs a slipped cycle at three weeks of gain', () => {
    // The headline on their page: "up to 39 lbs ... assuming 1.85 lbs/day".
    expect(lbPerCycleSlipped(1.85)).toBeCloseTo(38.85, 2)
    expect(Math.round(lbPerCycleSlipped(1.85))).toBe(39)
  })

  it('ages the first calf from its own birthday to weaning', () => {
    expect(firstCalfAgeDays(farm)).toBe(273)
    expect(firstCalfAgeDays({ firstCalfOn: null, weaningOn: '2026-11-15' })).toBeNull()
  })

  it('weans each cycle at its own weight, a cycle apart', () => {
    const w = cycleWeaningWeights(farm)!
    expect(w[0]).toBeCloseTo(85 + 1.85 * (273 - 10.5), 6)
    for (let k = 1; k < 4; k++) expect(w[k - 1] - w[k]).toBeCloseTo(38.85, 6)
    // A later calf is always the lighter one.
    expect(w[0]).toBeGreaterThan(w[3])
  })

  it('has nothing to say without the dates', () => {
    expect(cycleWeaningWeights({ ...farm, weaningOn: null })).toBeNull()
  })
})

describe('sharesFromCounts', () => {
  it('turns the calves counted into shares of the crop', () => {
    expect(sharesFromCounts([55, 20, 15, 10])).toEqual([0.55, 0.2, 0.15, 0.1])
  })
  it('refuses to divide by an empty calf crop', () => {
    expect(sharesFromCounts([0, 0, 0, 0])).toBeNull()
  })
})

describe('valueOfDistribution', () => {
  const r = valueOfDistribution(farm, [mine, target])
  const by = (k: string) => r.results.find((x) => x.key === k)!

  it('prices the same calf crop under each distribution', () => {
    const w = r.cycleWeights!
    expect(by('mine').avgWeaningWeightLb).toBeCloseTo(0.55 * w[0] + 0.2 * w[1] + 0.15 * w[2] + 0.1 * w[3], 6)
    // 100 born less the 2 that died, in every scenario.
    expect(by('mine').calvesWeaned).toBe(98)
    expect(by('target').calvesWeaned).toBe(98)
    expect(by('mine').value).toBeCloseTo(by('mine').avgWeaningWeightLb * 98 * 5.95, 6)
  })

  it('makes the first scenario the one everything is measured against', () => {
    expect(by('mine').vsBaseline).toBe(0)
    expect(by('target').vsBaseline).toBeCloseTo(by('target').value - by('mine').value, 6)
    // 55/20/15/10 is looser than 60/25/10/5, so tightening pays here.
    expect(by('target').vsBaseline).toBeGreaterThan(0)
  })

  it('pays more the further forward the calves move', () => {
    const three = valueOfDistribution(farm, [mine, target, { key: 'three', label: 'Three cycles', shares: THREE_CYCLES }])
    const t = three.results.find((x) => x.key === 'target')!
    const c = three.results.find((x) => x.key === 'three')!
    expect(c.vsBaseline).toBeGreaterThan(t.vsBaseline)
  })

  it('says when a scenario does not add to a whole calf crop', () => {
    /*
     * Their sheet will price 110% of the herd without a word. Here the
     * scenario is still computed as entered -- so the number on screen matches
     * what was typed -- and flagged.
     */
    const bad = valueOfDistribution(farm, [mine, { key: 'bad', label: 'Typo', shares: [0.7, 0.3, 0.1, 0] }])
    expect(bad.results[1].sharesTotal).toBeCloseTo(1.1, 6)
    expect(bad.results[0].sharesTotal).toBeNull()
  })

  it('does not flag a form nobody has filled in yet', () => {
    // An empty page showed "adds to 0% of the calf crop" before this.
    const empty = valueOfDistribution({ ...farm, born: [0, 0, 0, 0] }, [
      { key: 'mine', label: 'As it stands', shares: [0, 0, 0, 0] },
    ])
    expect(empty.results[0].sharesTotal).toBeNull()
  })

  it('tolerates a rounded distribution without crying about it', () => {
    const rounded = valueOfDistribution(farm, [{ key: 'r', label: 'Rounded', shares: [0.6, 0.25, 0.1, 0.049] }])
    expect(rounded.results[0].sharesTotal).toBeNull()
  })

  it('takes the open cows off the calf crop', () => {
    /*
     * The honest half their disclaimer admits is missing: the usual way a
     * calving season tightens is that late cows do not breed back.
     */
    const withOpen = valueOfDistribution(farm, [mine, { ...target, openCows: 10 }])
    expect(withOpen.results[1].calvesWeaned).toBe(88)
    expect(withOpen.results[1].vsBaseline).toBeLessThan(by('target').vsBaseline)
  })

  it('turns a gain into a loss once enough cows go open', () => {
    const lots = valueOfDistribution(farm, [mine, { ...target, openCows: 30 }])
    expect(lots.results[1].vsBaseline).toBeLessThan(0)
  })

  it('does not fall over with no dates entered', () => {
    const none = valueOfDistribution({ ...farm, firstCalfOn: null }, [mine, target])
    expect(none.cycleWeights).toBeNull()
    expect(none.results.every((x) => Number.isFinite(x.value))).toBe(true)
  })
})

describe('breakEvenOpenCows', () => {
  it('says how many cows can go open before tightening stops paying', () => {
    const be = breakEvenOpenCows(farm, mine, target)!
    expect(be).toBeGreaterThan(0)
    // At that many open cows the two scenarios should be worth the same.
    const atBe = valueOfDistribution(farm, [mine, { ...target, openCows: be }])
    expect(atBe.results[1].vsBaseline).toBeCloseTo(0, 4)
  })

  it('is nothing when the tighter season is not worth anything to begin with', () => {
    // Comparing a distribution against itself: no gain, so no room at all.
    expect(breakEvenOpenCows(farm, mine, { ...mine, key: 'same' })).toBe(0)
  })
})
