import { describe, expect, it } from 'vitest'
import {
  basisPerCwt,
  byYear,
  cwtToLb,
  daysAhead,
  derivePrice,
  scoreHindsight,
  wasForward,
  weightSlide,
  yearAverage,
  type CattleSale,
} from './cattleMarkets'

const lot = (over: Partial<CattleSale>): CattleSale => ({
  id: Math.random().toString(36).slice(2),
  ranch: 'Home Ranch',
  crop_year: 2024,
  animal_class: 'heifers',
  head: 88,
  sale_date: null,
  delivery_date: null,
  avg_weight_lb: 424.38,
  total_lb: 37345,
  price_per_lb: 5.3,
  total_price: 197928.5,
  buyer: null,
  notes: null,
  ...over,
})

describe('forward pricing', () => {
  it('recognises a sale agreed months before delivery', () => {
    // 2025 bulls: sold 23 May, delivered 5 December. 196 days.
    const s = lot({ sale_date: '2025-05-23', delivery_date: '2025-12-05' })
    expect(daysAhead(s)).toBe(196)
    expect(wasForward(s)).toBe(true)
  })

  it('does not call a sale forward when it was sold off the truck', () => {
    // 2024 runts: sold and delivered the same day at Perlich.
    const s = lot({ sale_date: '2024-12-09', delivery_date: '2024-12-09' })
    expect(daysAhead(s)).toBe(0)
    expect(wasForward(s)).toBe(false)
  })

  it('says nothing rather than guessing when a date is missing', () => {
    expect(daysAhead(lot({ sale_date: null, delivery_date: '2024-12-06' }))).toBeNull()
  })
})

describe('yearAverage', () => {
  it('weights by pounds, not by lot', () => {
    // A 40-head runt lot and a 117-head bull lot are not two equal opinions
    // about what the calves fetched.
    const avg = yearAverage([
      lot({ total_lb: 40000, price_per_lb: 5 }),
      lot({ total_lb: 10000, price_per_lb: 6 }),
    ])
    expect(avg).toBeCloseTo((40000 * 5 + 10000 * 6) / 50000, 6)
  })

  it('falls back to head x weight when the total was not recorded', () => {
    const avg = yearAverage([lot({ total_lb: null, head: 100, avg_weight_lb: 400, price_per_lb: 4 })])
    expect(avg).toBe(4)
  })

  it('ignores an unpriced lot instead of treating it as free', () => {
    // 2008 really has no price. Counting it as zero would drag the year down.
    const avg = yearAverage([lot({ price_per_lb: null }), lot({ total_lb: 1000, price_per_lb: 3 })])
    expect(avg).toBe(3)
  })

  it('gives null when nothing in the year was priced', () => {
    expect(yearAverage([lot({ price_per_lb: null })])).toBeNull()
  })
})

describe('byYear', () => {
  it('keeps the two ranches apart', () => {
    const rows = byYear([
      lot({ crop_year: 2024, ranch: 'Home Ranch' }),
      lot({ crop_year: 2024, ranch: 'East Ranch' }),
    ])
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.ranch).sort()).toEqual(['East Ranch', 'Home Ranch'])
  })

  it('marks a year forward when any lot in it was priced ahead', () => {
    const rows = byYear([
      lot({ crop_year: 2024, sale_date: '2024-08-16', delivery_date: '2024-12-06' }),
      lot({ crop_year: 2024, animal_class: 'runts', sale_date: '2024-12-09', delivery_date: '2024-12-09' }),
    ])
    expect(rows[0].forward).toBe(true)
    expect(rows[0].daysAhead).toBe(112)
  })
})

describe('the weight slide', () => {
  // Lighter cattle fetch MORE per pound: the buyer is paying for the pounds
  // they will add. Measured from the review rather than assumed, because it
  // moves with the market.
  const quotes = [
    { lo: 500, hi: 600, perCwt: 657.5 },
    { lo: 600, hi: 700, perCwt: 605 },
  ]

  it('measures a negative slope from two adjacent classes', () => {
    const slide = weightSlide(quotes)
    expect(slide).not.toBeNull()
    expect(slide!.centsPerLb).toBeCloseTo((605 - 657.5) / 100, 6)
    expect(slide!.centsPerLb).toBeLessThan(0)
  })

  it('derives a lighter class ABOVE the lightest quoted one', () => {
    const slide = weightSlide(quotes)!
    const at450 = derivePrice(450, quotes[0], slide)
    expect(at450).toBeGreaterThan(quotes[0].perCwt)
  })

  it('refuses when there is only one class to go on', () => {
    // A made-up slide on a made-up class is two guesses stacked.
    expect(weightSlide([quotes[0]])).toBeNull()
    expect(weightSlide([])).toBeNull()
  })
})

describe('basis', () => {
  it('is Alberta cash less the board, converted at the day rate', () => {
    // CME feeder 351.65 US, dollar at 0.7134 → 250.87 CAD equivalent.
    const b = basisPerCwt(300, 351.65, 1 / 0.7134)
    expect(b).toBeCloseTo(300 - 351.65 / 0.7134, 4)
  })

  it('converts hundredweight to the pounds a farm talks in', () => {
    expect(cwtToLb(657.5)).toBeCloseTo(6.575, 6)
  })
})

describe('scoring the lock-in calls already made', () => {
  const rows = byYear([
    lot({ crop_year: 2024, sale_date: '2024-08-16', delivery_date: '2024-12-06', price_per_lb: 5.3 }),
  ])

  it('credits locking in when the market fell by delivery', () => {
    const h = scoreHindsight(rows, (iso) => (iso === '2024-12-06' ? 4.9 : 5.1))
    expect(h[0].advantage).toBeCloseTo(0.4, 6)
  })

  it('marks it against when the market rose', () => {
    const h = scoreHindsight(rows, (iso) => (iso === '2024-12-06' ? 5.8 : 5.1))
    expect(h[0].advantage).toBeCloseTo(-0.5, 6)
  })

  it('leaves a year unscored rather than calling it a draw', () => {
    // An unanswerable year counted as zero would quietly flatter or damn the
    // record, depending which way the gaps fell.
    const h = scoreHindsight(rows, () => null)
    expect(h[0].advantage).toBeNull()
  })

  it('does not score a sale that was never priced forward', () => {
    const sameDay = byYear([lot({ sale_date: '2024-12-09', delivery_date: '2024-12-09' })])
    expect(scoreHindsight(sameDay, () => 5)).toEqual([])
  })
})

describe('weightSlide across several auction markets', () => {
  it('averages a weight class quoted at more than one market', () => {
    // The bug this fixes: Alberta quotes 500-600 at both Strathmore and
    // Ontario, so the two lightest ROWS were the same CLASS twice. That gave a
    // zero weight difference, no slide, and every figure downstream — the
    // derived 450 lb price, all three selling strategies, value of gain — went
    // silently blank.
    const live = [
      { lo: 500, hi: 600, perCwt: 679.405 }, // Ontario
      { lo: 500, hi: 600, perCwt: 657.5 }, // Strathmore
      { lo: 600, hi: 700, perCwt: 605 },
      { lo: 700, hi: 800, perCwt: 538 },
      { lo: 800, hi: 900, perCwt: 492.795 },
    ]
    const slide = weightSlide(live)
    expect(slide).not.toBeNull()
    expect(slide!.centsPerLb).toBeLessThan(0)
    // Averaged 500-600 is 668.45; 600-700 is 605. Over 100 lb of midpoint.
    expect(slide!.centsPerLb).toBeCloseTo((605 - 668.4525) / 100, 4)
  })

  it('still refuses when every quote is the same class', () => {
    expect(
      weightSlide([
        { lo: 500, hi: 600, perCwt: 660 },
        { lo: 500, hi: 600, perCwt: 670 },
      ]),
    ).toBeNull()
  })
})
