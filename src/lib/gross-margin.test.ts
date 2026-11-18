import { describe, expect, it } from 'vitest'
import {
  cowCalfRevenuePerCow,
  grossMargins,
  revenuePerAcre,
  switchGain,
  type CowCalf,
  type LandEnterprise,
} from './gross-margin'

/** The BCRC sheet's own worked example: 80 cows, 500 ac pasture, 250 ac hay, 500 ac crop. */
const cows: CowCalf = {
  cows: 80,
  purchasedFeedPerCow: 125,
  hiredLabourPerCow: 0,
  otherPerCow: 100,
  weaningWeightLb: 450,
  weaningRate: 0.85,
  calfPricePerLb: 3,
  cullCows: 6,
  cullWeightLb: 1300,
  cullPricePerLb: 1,
}

const land: LandEnterprise[] = [
  { key: 'pasture', label: 'Pasture', acres: 500, directPerAcre: 5, yieldPerAcre: 1, pricePerUnit: 25, unit: 'ac', internal: true },
  { key: 'hayown', label: 'Hay for the herd', acres: 250, directPerAcre: 32, yieldPerAcre: 1.4, pricePerUnit: 43, unit: 'ton', internal: true },
  { key: 'haysale', label: 'Hay for sale', acres: 0, directPerAcre: 32, yieldPerAcre: 1.4, pricePerUnit: 43, unit: 'ton', internal: false },
  { key: 'barley', label: 'Barley', acres: 500, directPerAcre: 50, yieldPerAcre: 90, pricePerUnit: 5.5, unit: 'bu', internal: false },
]

describe('revenuePerAcre', () => {
  it('prices a crop in its own unit, with no ton conversion to get wrong', () => {
    /*
     * The BCRC sheet does price x (yield / 1000) with the yield in lb/ac and
     * the price in $/ton — a ton being 2,000 lb, so their cash-crop revenue is
     * double. Here 90 bu at $5.50 is just 90 x 5.50.
     */
    expect(revenuePerAcre({ yieldPerAcre: 90, pricePerUnit: 5.5 })).toBe(495)
    expect(revenuePerAcre({ yieldPerAcre: 1.4, pricePerUnit: 43 })).toBeCloseTo(60.2, 6)
    // Pasture is priced by the acre: yield 1, price the grazing's worth.
    expect(revenuePerAcre({ yieldPerAcre: 1, pricePerUnit: 25 })).toBe(25)
  })
})

describe('cowCalfRevenuePerCow', () => {
  it('weans the calf but sells every cull', () => {
    // The calf at 85% weaned, plus the six culls spread over the eighty cows.
    expect(cowCalfRevenuePerCow(cows)).toBeCloseTo(450 * 3 * 0.85 + (1300 * 6 * 1) / 80, 6)
    expect(cowCalfRevenuePerCow(cows)).toBeCloseTo(1245, 6)
  })
  it('does not divide by nothing', () => {
    expect(cowCalfRevenuePerCow({ ...cows, cows: 0 })).toBeCloseTo(450 * 3 * 0.85, 6)
  })
})

describe('grossMargins', () => {
  const r = grossMargins(cows, land)
  const by = (k: string) => r.land.find((e) => e.key === k)!

  it('charges the herd for its own grass AND its own hay', () => {
    /*
     * The BCRC charges grazing to the cows but not home-grown hay, while still
     * crediting the hay enterprise with every tonne — the same tonne counted
     * as revenue in one place and missing as a cost in the other.
     */
    const pastureRevenue = 500 * 25
    const hayRevenue = 250 * 1.4 * 43
    expect(r.cowCalf.transferPerCow).toBeCloseTo((pastureRevenue + hayRevenue) / 80, 6)
    expect(r.cowCalf.directPerCow).toBeCloseTo(125 + 0 + 100 + r.cowCalf.transferPerCow, 6)
  })

  it('leaves bought feed separate from feed grown here', () => {
    expect(r.cowCalf.ownDirectPerCow).toBe(225)
    expect(r.cowCalf.ownDirectPerCow).toBeLessThan(r.cowCalf.directPerCow)
  })

  it('cancels the transfer when the herd and its land are added up', () => {
    /*
     * The whole point of the combined view. Whatever the grass is priced at,
     * the forage gross margin must come out the same — it is the calf cheque
     * less every real cost, and the internal price is not a real cost.
     */
    const dearer = grossMargins(
      cows,
      land.map((e) => (e.key === 'pasture' ? { ...e, pricePerUnit: 80 } : e)),
    )
    expect(dearer.forage.grossMargin).toBeCloseTo(r.forage.grossMargin, 6)
    expect(dearer.forage.perAcre).toBeCloseTo(r.forage.perAcre!, 6)
    // And it does move the two halves apart, so the test is not vacuous.
    expect(dearer.cowCalf.grossMargin).toBeLessThan(r.cowCalf.grossMargin)
    expect(dearer.land.find((e) => e.key === 'pasture')!.grossMargin).toBeGreaterThan(by('pasture').grossMargin)
  })

  it('spreads the forage margin over the pasture and hay acres together', () => {
    expect(r.forage.acres).toBe(750)
    expect(r.forage.perAcre).toBeCloseTo(r.forage.grossMargin / 750, 6)
    expect(r.forage.enterprises).toEqual(['Cow-calf', 'Pasture', 'Hay for the herd'])
  })

  it('costs a cash crop on its own revenue and its own inputs', () => {
    const barley = by('barley')
    expect(barley.revenue).toBeCloseTo(500 * 90 * 5.5, 6)
    expect(barley.directCost).toBeCloseTo(500 * 50, 6)
    expect(barley.grossMarginPerAcre).toBeCloseTo(90 * 5.5 - 50, 6)
    expect(barley.ratio).toBeCloseTo((495 - 50) / 495, 6)
  })

  it('leaves an enterprise with no acres out of the ranking but keeps its row', () => {
    expect(by('haysale').acres).toBe(0)
    expect(by('haysale').grossMarginPerAcre).toBeNull()
    expect(r.ranked.some((x) => x.key === 'haysale')).toBe(false)
    expect(r.land.some((e) => e.key === 'haysale')).toBe(true)
  })

  it('ranks the uses by what they leave an acre, forage as one block', () => {
    expect(r.ranked.map((x) => x.key)).toContain('forage')
    expect(r.ranked.some((x) => x.key === 'pasture' || x.key === 'hayown')).toBe(false)
    const perAcre = r.ranked.map((x) => x.perAcre)
    expect(perAcre).toEqual([...perAcre].sort((a, b) => b - a))
  })

  it('reports no margin an acre rather than a wrong one when there is no land', () => {
    const none = grossMargins({ ...cows, cows: 0 }, land.map((e) => ({ ...e, acres: 0 })))
    expect(none.forage.perAcre).toBeNull()
    expect(none.cowCalf.transferPerCow).toBe(0)
    expect(none.ranked).toEqual([])
  })
})

describe('switchGain', () => {
  const r = grossMargins(cows, land)

  it('values moving acres at the gap between the two margins', () => {
    const g = switchGain(r, 'forage', 'barley', 100)!
    expect(g.gain).toBeCloseTo((g.to - g.from) * 100, 6)
    expect(g.to).toBeCloseTo(90 * 5.5 - 50, 6)
  })

  it('will not move more acres than the use has', () => {
    const all = switchGain(r, 'forage', 'barley', 10_000)!
    expect(all.gain).toBeCloseTo((all.to - all.from) * 750, 6)
    // and says how many it did move, so the page can print that instead.
    expect(all.acres).toBe(750)
    expect(all.capped).toBe(true)
    const some = switchGain(r, 'forage', 'barley', 100)!
    expect(some.acres).toBe(100)
    expect(some.capped).toBe(false)
  })

  it('says nothing about a use that is not on the table', () => {
    expect(switchGain(r, 'forage', 'haysale', 100)).toBeNull()
  })
})
