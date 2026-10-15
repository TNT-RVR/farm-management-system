import { describe, expect, it } from 'vitest'
import { cutFor, cutLabel, estimateYield, formatYieldRange, isRange, marginRange, parseYieldText, planYieldText, type YieldCut } from './yield-estimate'

const cut = (over: Partial<YieldCut>): YieldCut => ({
  id: 'c1',
  field_id: 'f1',
  crop_year: 2030,
  crop_id: null,
  zone_id: null,
  loss_pct: 50,
  reason: 'hail 1 Jul',
  ...over,
})

describe('cutFor', () => {
  const cuts = [
    cut({ id: 'field', loss_pct: 10 }),
    cut({ id: 'crop', crop_id: 'corn', loss_pct: 100 }),
    cut({ id: 'zone', zone_id: 'z2', loss_pct: 40 }),
    cut({ id: 'other-year', crop_year: 2029, crop_id: 'corn' }),
  ]

  it('takes the crop area’s own cut first', () => {
    expect(cutFor(cuts, { fieldId: 'f1', cropYear: 2030, cropId: 'corn', zoneId: 'z2' })?.id).toBe('zone')
  })
  it('then the crop’s cut on the field', () => {
    expect(cutFor(cuts, { fieldId: 'f1', cropYear: 2030, cropId: 'corn', zoneId: 'z1' })?.id).toBe('crop')
    expect(cutFor(cuts, { fieldId: 'f1', cropYear: 2030, cropId: 'corn' })?.id).toBe('crop')
  })
  it('then a cut on the whole field', () => {
    expect(cutFor(cuts, { fieldId: 'f1', cropYear: 2030, cropId: 'beans' })?.id).toBe('field')
  })
  it('never a cut from another year or field, and an area cut never reaches a whole-field row', () => {
    expect(cutFor(cuts, { fieldId: 'f2', cropYear: 2030, cropId: 'corn' })).toBeNull()
    expect(cutFor([cut({ zone_id: 'z2' })], { fieldId: 'f1', cropYear: 2030, cropId: 'corn' })).toBeNull()
    expect(cutFor([cut({ crop_year: 2029 })], { fieldId: 'f1', cropYear: 2030, cropId: 'corn' })).toBeNull()
  })
})

describe('estimateYield', () => {
  it('a single figure with no range is a point', () => {
    const e = estimateYield({ expected: 40 })
    expect(e).toMatchObject({ low: 40, expected: 40, high: 40, cutPct: 0, rangeFrom: null })
    expect(isRange(e)).toBe(false)
  })

  it('a crop range keeps the figure found as the expected value', () => {
    const e = estimateYield({ expected: 50, crop: { low: 40, high: 70 } })
    expect(e).toMatchObject({ low: 40, expected: 50, high: 70, rangeFrom: 'crop' })
  })

  it('a range with no figure expects its midpoint', () => {
    expect(estimateYield({ expected: null, crop: { low: 40, high: 70 } }).expected).toBe(55)
    expect(estimateYield({ expected: 50, plan: { low: 20, high: 30 } }).expected).toBe(25)
  })

  it('a plan range beats the crop’s, and a typed figure stands beside it', () => {
    const e = estimateYield({ expected: 33, typed: true, plan: { low: 20, high: 30 }, crop: { low: 40, high: 70 } })
    // 33 is outside 20–30: the range widens to hold it.
    expect(e).toMatchObject({ low: 20, expected: 33, high: 33, rangeFrom: 'plan' })
  })

  it('a typed figure with no plan range ignores the crop range', () => {
    expect(estimateYield({ expected: 45, typed: true, crop: { low: 40, high: 70 } })).toMatchObject({ low: 45, high: 45, rangeFrom: null })
  })

  it('takes the cut off every end of the range', () => {
    const e = estimateYield({ expected: 50, crop: { low: 40, high: 60 }, cut: cut({ loss_pct: 25 }) })
    expect(e.low).toBeCloseTo(30)
    expect(e.expected).toBeCloseTo(37.5)
    expect(e.high).toBeCloseTo(45)
    expect(e.before).toEqual({ low: 40, expected: 50, high: 60 })
    expect(e.cutPct).toBe(25)
  })

  it('a 100% loss leaves nothing', () => {
    expect(estimateYield({ expected: 50, cut: cut({ loss_pct: 100 }) })).toMatchObject({ low: 0, expected: 0, high: 0 })
  })

  it('clamps a cut to 0–100', () => {
    expect(estimateYield({ expected: 10, cut: cut({ loss_pct: 150 }) }).expected).toBe(0)
    expect(estimateYield({ expected: 10, cut: cut({ loss_pct: -5 }) }).expected).toBe(10)
  })

  it('a harvested yield takes no cut and no range', () => {
    const e = estimateYield({ expected: 44, typed: true, harvested: true, plan: { low: 20, high: 30 }, crop: { low: 40, high: 70 }, cut: cut({ loss_pct: 50 }) })
    expect(e).toMatchObject({ low: 44, expected: 44, high: 44, cutPct: 0, rangeFrom: null })
    expect(e.cut?.id).toBe('c1')
  })

  it('ignores a range that is backwards, negative or half there', () => {
    expect(estimateYield({ expected: 50, crop: { low: 70, high: 40 } }).rangeFrom).toBeNull()
    expect(estimateYield({ expected: 50, crop: { low: -1, high: 40 } }).rangeFrom).toBeNull()
    expect(estimateYield({ expected: 50, plan: { low: 40, high: null } }).rangeFrom).toBeNull()
  })

  it('reads numbers that arrive as strings', () => {
    expect(estimateYield({ expected: 50, crop: { low: '40', high: '60' } })).toMatchObject({ low: 40, high: 60 })
  })
})

describe('marginRange', () => {
  it('is yield × price less cost at each end', () => {
    expect(marginRange({ low: 10, expected: 20, high: 30 }, 5, 60)).toEqual({ low: -10, expected: 40, high: 90 })
  })
  it('with no price, every end is minus the cost', () => {
    expect(marginRange({ low: 10, expected: 20, high: 30 }, null, 60)).toEqual({ low: -60, expected: -60, high: -60 })
  })
})

describe('parseYieldText', () => {
  it('reads one figure, a range, or nothing', () => {
    expect(parseYieldText('')).toEqual({ kind: 'clear' })
    expect(parseYieldText(' 42.5 ')).toEqual({ kind: 'point', value: 42.5 })
    expect(parseYieldText('12-18')).toEqual({ kind: 'range', low: 12, high: 18 })
    expect(parseYieldText('12 – 18')).toEqual({ kind: 'range', low: 12, high: 18 })
    expect(parseYieldText('12 to 18')).toEqual({ kind: 'range', low: 12, high: 18 })
    expect(parseYieldText('1,200-1,800')).toEqual({ kind: 'range', low: 1200, high: 1800 })
  })
  it('puts a backwards range the right way round, and an even one is a point', () => {
    expect(parseYieldText('18-12')).toEqual({ kind: 'range', low: 12, high: 18 })
    expect(parseYieldText('15-15')).toEqual({ kind: 'point', value: 15 })
  })
  it('refuses anything else', () => {
    expect(parseYieldText('abc')).toBeNull()
    expect(parseYieldText('-5')).toBeNull()
    expect(parseYieldText('12-')).toBeNull()
  })
})

describe('formatting', () => {
  it('shows a range or a figure', () => {
    expect(formatYieldRange({ low: 12, expected: 15, high: 18 })).toBe('12–18')
    expect(formatYieldRange({ low: 15, expected: 15, high: 15 })).toBe('15')
    expect(formatYieldRange({ low: null, expected: null, high: null })).toBe('')
  })
  it('writes a plan’s own figures back into its box', () => {
    expect(planYieldText({ yield_per_acre_override: null, yield_low: 12, yield_high: 18 })).toBe('12–18')
    expect(planYieldText({ yield_per_acre_override: 15, yield_low: null, yield_high: null })).toBe('15')
    expect(planYieldText(null)).toBe('')
  })
  it('labels a cut', () => {
    expect(cutLabel({ loss_pct: 50, reason: 'hail 1 Jul' })).toBe('−50% · hail 1 Jul')
  })
})
