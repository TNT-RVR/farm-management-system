import { describe, expect, it } from 'vitest'
import {
  CP_TO_N,
  DEFAULT_RECOVERY,
  FEED_NUTRIENTS,
  LB_PER_TONNE,
  cropForFeed,
  feedNutrientKey,
  nutrientValuePerTonne,
  type CropForFeedInput,
} from './crop-for-feed'

const price = { n: 0.55, p2o5: 0.66, k2o: 0.5, s: 0.55 }

/** The BCRC sheet's own worked example: 160 ac of barley, 80.7 bu/ac, 1.4 t/ac straw. */
const base: CropForFeedInput = {
  crop: 'barley',
  acres: 160,
  grainYieldBuPerAc: 80.7,
  buPerTonne: 45.93,
  grainPricePerTonne: 160.76,
  wholePlantTonneDmPerAc: 3,
  strawTonneDmPerAc: 1.4,
  hayValuePerTonneDm: 260 / 0.907185 / 0.88, // $260/ton as fed at 88% DM
  costs: { combinePerAc: 41.36, swathPerAc: 13.38, silagePerAc: 63.7, balePerBale: 17.02, balesPerAc: 2 },
  nutrientPrice: price,
}

describe('the feed nutrient table', () => {
  it('keeps the source table’s grain rows exactly', () => {
    // Given directly in lb a tonne by CowBytes 5.41; nothing is derived.
    expect(FEED_NUTRIENTS.barley.grain).toEqual({ n: 44.1, p2o5: 19.19, k2o: 14.29, s: 3.09 })
    expect(FEED_NUTRIENTS.wheat.grain?.n).toBe(55.03)
    expect(FEED_NUTRIENTS.canola.grain?.s).toBe(12.57)
  })

  it('turns a composition into pounds the way the source does', () => {
    // Barley straw is 4.2% crude protein, so N is 4.2% x 0.16 of a tonne.
    expect(FEED_NUTRIENTS.barley.straw!.n).toBeCloseTo(LB_PER_TONNE * 0.042 * CP_TO_N, 6)
    expect(FEED_NUTRIENTS.barley.straw!.n).toBeCloseTo(14.81, 2)
    // 0.08% P as P2O5, 1.40% K as K2O.
    expect(FEED_NUTRIENTS.barley.straw!.p2o5).toBeCloseTo(4.04, 2)
    expect(FEED_NUTRIENTS.barley.straw!.k2o).toBeCloseTo(37.04, 2)
  })

  it('only offers the forms the source has figures for', () => {
    expect(FEED_NUTRIENTS.corn.silage).toBeDefined()
    expect(FEED_NUTRIENTS.corn.grain).toBeUndefined()
    expect(FEED_NUTRIENTS.timothy.silage).toBeUndefined()
    expect(FEED_NUTRIENTS.wheat.hay).toBeUndefined()
  })

  it('prices a tonne off the farm’s own nutrient costs', () => {
    const v = nutrientValuePerTonne(FEED_NUTRIENTS.barley.grain, price)
    expect(v).toBeCloseTo(44.1 * 0.55 + 19.19 * 0.66 + 14.29 * 0.5 + 3.09 * 0.55, 6)
    expect(nutrientValuePerTonne(undefined, price)).toBe(0)
  })
})

describe('feedNutrientKey', () => {
  it('finds the table row behind our own crop names', () => {
    expect(feedNutrientKey('Barley-Feed')).toBe('barley')
    expect(feedNutrientKey('Grain Corn')).toBe('corn')
    expect(feedNutrientKey('Canola-Seed')).toBe('canola')
    expect(feedNutrientKey('Alfalfa-Grass mix')).toBe('alfalfa-grass')
    expect(feedNutrientKey('Oats')).toBe('oat')
  })
  it('says nothing rather than guessing', () => {
    expect(feedNutrientKey('Potato-Creamer')).toBeNull()
    expect(feedNutrientKey('Beans-Pinto')).toBeNull()
    expect(feedNutrientKey(null)).toBeNull()
  })
})

describe('cropForFeed', () => {
  it('charges the grain removal against the GRAIN tonnage, not the straw', () => {
    /*
     * The BCRC sheet multiplies every nutrient column by the straw yield,
     * including the grain one. 80.7 bu/ac at 45.93 bu/tonne is 1.757 t/ac of
     * grain, against the 1.4 t/ac of straw their sheet would have used.
     */
    const combine = cropForFeed(base).options.find((o) => o.option === 'combine')!
    const perTonne = nutrientValuePerTonne(FEED_NUTRIENTS.barley.grain, price)
    expect(combine.nutrientRemovedPerAc).toBeCloseTo(perTonne * (80.7 / 45.93), 6)
    // Their version would be a quarter smaller.
    expect(combine.nutrientRemovedPerAc).toBeGreaterThan(perTonne * 1.4)
  })

  it('bales by the bale, not by the acre', () => {
    const two = cropForFeed(base).options.find((o) => o.option === 'greenfeed')!
    const four = cropForFeed({ ...base, costs: { ...base.costs, balesPerAc: 4 } }).options.find((o) => o.option === 'greenfeed')!
    expect(four.operatingPerAc - two.operatingPerAc).toBeCloseTo(2 * 17.02, 6)
    expect(two.operatingPerAc).toBeCloseTo(13.38 + 2 * 17.02, 6)
  })

  it('takes nothing off the field for swath grazing, and credits no manure', () => {
    /*
     * The one place this departs from the BCRC on purpose. Their sheet sets
     * the removal to zero AND adds a manure credit — about $290/ac on their
     * own defaults, which is more than the crop is worth. The manure is the
     * crop's own nutrients cycled through a cow, so it is neither a removal
     * nor an addition.
     */
    const graze = cropForFeed(base).options.find((o) => o.option === 'swath_graze')!
    expect(graze.nutrientRemovedPerAc).toBe(0)
    expect(graze.operatingPerAc).toBe(13.38)
    expect(graze.netPerAc).toBeCloseTo(graze.feedValuePerAc - 13.38, 6)
  })

  it('feeds less than it grows, by the option’s own recovery', () => {
    const r = cropForFeed(base)
    const graze = r.options.find((o) => o.option === 'swath_graze')!
    const silage = r.options.find((o) => o.option === 'silage')!
    expect(graze.feedTonneDmPerAc).toBeCloseTo(3 * DEFAULT_RECOVERY.swath_graze, 6)
    expect(silage.feedTonneDmPerAc).toBeCloseTo(3 * DEFAULT_RECOVERY.silage, 6)
    expect(graze.feedTonneDmPerAc).toBeLessThan(3)
  })

  it('lets the recovery be overridden one option at a time', () => {
    const r = cropForFeed({ ...base, recovery: { swath_graze: 0.6 } })
    const graze = r.options.find((o) => o.option === 'swath_graze')!
    const silage = r.options.find((o) => o.option === 'silage')!
    expect(graze.feedTonneDmPerAc).toBeCloseTo(3 * 0.6, 6)
    expect(silage.feedTonneDmPerAc).toBeCloseTo(3 * DEFAULT_RECOVERY.silage, 6)
  })

  it('ranks by net return and names the winner', () => {
    const r = cropForFeed(base)
    const nets = r.options.filter((o) => !o.unavailable).map((o) => o.netPerAc)
    expect(nets).toEqual([...nets].sort((a, b) => b - a))
    expect(r.best).toBe(r.options[0])
    expect(r.best!.unavailable).toBeNull()
  })

  it('values feed only as far as the cows are actually short', () => {
    /*
     * Without a cap every tonne the crop grows counts as hay not bought, and
     * feeding wins every time — a cereal's whole plant outweighs its grain, so
     * even a sound 80 bu barley crop reads as better grazed. That is the shape
     * of the BCRC's own worked example and it is only true while the cows are
     * short. 2.25 t/ac of DM over 160 acres is 360 tonnes; tell it the herd
     * needs 100 and the rest stops counting.
     */
    const uncapped = cropForFeed(base).options.find((o) => o.option === 'swath_graze')!
    const capped = cropForFeed({ ...base, feedNeededTonneDm: 100 }).options.find((o) => o.option === 'swath_graze')!
    expect(capped.feedTonneDmPerAc).toBeCloseTo(uncapped.feedTonneDmPerAc, 6)
    expect(capped.feedValuePerAc).toBeCloseTo((100 / 160) * base.hayValuePerTonneDm, 6)
    expect(capped.feedValuePerAc).toBeLessThan(uncapped.feedValuePerAc)
  })

  it('sends a sound crop to the combine once the cows have enough', () => {
    const sound = cropForFeed({ ...base, feedNeededTonneDm: 60 })
    expect(sound.best!.option).toBe('combine')
    // Hailed to a fifth of the grain, with the plant still standing: feed it.
    const wrecked = cropForFeed({ ...base, feedNeededTonneDm: 60, grainYieldBuPerAc: 16, grainPricePerTonne: 90 })
    expect(wrecked.best!.option).not.toBe('combine')
  })

  it('pays the surplus rate past the need, when the extra can be sold', () => {
    const r = cropForFeed({ ...base, feedNeededTonneDm: 100, surplusValuePerTonneDm: 50 })
    const graze = r.options.find((o) => o.option === 'swath_graze')!
    const need = 100 / 160
    expect(graze.feedValuePerAc).toBeCloseTo(need * base.hayValuePerTonneDm + (graze.feedTonneDmPerAc - need) * 50, 6)
  })

  it('puts an option the table cannot cost out of the running, with a reason', () => {
    const r = cropForFeed({ ...base, crop: 'corn' })
    const combine = r.options.find((o) => o.option === 'combine')!
    const greenfeed = r.options.find((o) => o.option === 'greenfeed')!
    expect(combine.unavailable).toMatch(/No grain figures/)
    expect(greenfeed.unavailable).toMatch(/No hay figures/)
    expect(r.best!.unavailable).toBeNull()
    // Unavailable options sort to the bottom however good their number looks.
    expect(r.options.slice(-2).every((o) => o.unavailable)).toBe(true)
  })

  it('reports what the feed cost a tonne, and nothing when there is no feed', () => {
    const r = cropForFeed(base)
    const graze = r.options.find((o) => o.option === 'swath_graze')!
    expect(graze.costPerTonneDm).toBeCloseTo(13.38 / graze.feedTonneDmPerAc, 6)
    expect(r.options.find((o) => o.option === 'combine')!.costPerTonneDm).toBeNull()
  })

  it('survives a field with nothing typed into it', () => {
    const empty = cropForFeed({
      ...base,
      grainYieldBuPerAc: 0,
      buPerTonne: 0,
      wholePlantTonneDmPerAc: 0,
      costs: { combinePerAc: 0, swathPerAc: 0, silagePerAc: 0, balePerBale: 0, balesPerAc: 0 },
    })
    for (const o of empty.options) {
      expect(Number.isFinite(o.netPerAc)).toBe(true)
      expect(o.costPerTonneDm).toBeNull()
    }
  })
})
