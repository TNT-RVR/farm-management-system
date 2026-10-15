import { describe, expect, it } from 'vitest'
import { KIND_SIGN, daysOfFeedLeft, inNaturalUnits, type FeedOnHand } from './feed-inventory'

const f = (o: Partial<FeedOnHand>): FeedOnHand => ({
  ranch_id: 'r1',
  feed_type_id: 't1',
  feed_name: 'Green feed',
  default_unit: 'round',
  default_lb_per_bale: 1500,
  is_bedding: false,
  put_up_lb: 0,
  fed_lb: 0,
  remaining_lb: 0,
  unweighed_lines: 0,
  ...o,
})

describe('KIND_SIGN', () => {
  it('knows which way each kind moves the pile', () => {
    // The sign follows the kind rather than being typed, so nobody has to
    // remember a minus on a sale — and a missing one would ADD to the pile.
    expect(KIND_SIGN.harvested).toBe(1)
    expect(KIND_SIGN.purchased).toBe(1)
    expect(KIND_SIGN.sold).toBe(-1)
    expect(KIND_SIGN.shrink).toBe(-1)
    expect(KIND_SIGN.adjustment).toBe(0)
  })
})

describe('inNaturalUnits', () => {
  it('counts baled feed in bales', () => {
    expect(inNaturalUnits(f({}), 15000)).toBe('10 rounds')
    expect(inNaturalUnits(f({}), 1500)).toBe('1 round')
  })

  it('leaves pounds as pounds', () => {
    expect(inNaturalUnits(f({ default_unit: 'lb', default_lb_per_bale: null }), 2500)).toBe(
      '2,500 lb',
    )
  })

  it('will not invent a bale count from a weight nobody recorded', () => {
    expect(inNaturalUnits(f({ default_lb_per_bale: null }), 15000)).toBeNull()
  })
})

describe('daysOfFeedLeft', () => {
  it('measures against what has actually been fed', () => {
    // 60,000 lb left, 30,000 lb fed over 30 days = 1,000 lb a day = 60 days.
    expect(daysOfFeedLeft(60000, 30000, 30)).toBe(60)
  })

  it('says nothing rather than forever when nothing has been fed', () => {
    // A rate of zero divides into anything and would report a pile lasting
    // until the end of time.
    expect(daysOfFeedLeft(60000, 0, 30)).toBeNull()
    expect(daysOfFeedLeft(60000, 30000, 0)).toBeNull()
  })

  it('says nothing about a pile that is already gone', () => {
    expect(daysOfFeedLeft(-5000, 30000, 30)).toBeNull()
  })
})
