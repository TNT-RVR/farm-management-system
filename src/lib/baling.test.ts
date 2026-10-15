import { describe, expect, it } from 'vitest'
import { baleCount, cutInName, defaultBaleType, defaultRanch, isHayCrop, isWeightEstimate, lotLbPerBale, ordinal, suggestFeedType, type FeedTypeLite } from './baling'

// A made-up feed list, shaped like a farm's.
const ft = (id: string, name: string, category: string, default_unit = 'round', o: Partial<FeedTypeLite> = {}): FeedTypeLite => ({
  id,
  name,
  category,
  default_unit,
  default_lb_per_bale: null,
  is_bedding: false,
  ...o,
})
const FEEDS: FeedTypeLite[] = [
  ft('a1', '1st Cut Alfalfa', 'hay'),
  ft('a2', '2nd Cut Alfalfa', 'hay', 'lb'),
  ft('a3', '3rd Cut Alfalfa', 'hay', 'lb'),
  ft('asq', 'Alfalfa big squares', 'hay', 'big_square', { default_lb_per_bale: 1111 }),
  ft('mix', 'Grass Alfalfa Mix', 'hay'),
  ft('sf', 'Sainfoin', 'hay'),
  ft('gf', 'Green feed', 'greenfeed'),
  ft('bs', 'Barley Straw', 'straw', 'lb'),
  ft('bed', 'Straw for Bedding', 'straw', 'big_square', { is_bedding: true }),
  ft('sil', 'Silage', 'silage', 'lb'),
  ft('corn', 'Grain Corn', 'grain', 'lb'),
  ft('old', 'Old Hay', 'hay', 'round', { archived: true }),
]

describe('ordinal and cutInName', () => {
  it('names cuts', () => {
    expect([1, 2, 3, 4, 11, 12, 21].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '21st'])
    expect(cutInName('2nd Cut Alfalfa')).toBe(2)
    expect(cutInName('Second cut hay')).toBe(2)
    expect(cutInName('Alfalfa big squares')).toBeNull()
  })
})

describe('suggestFeedType', () => {
  it('takes alfalfa by its cut', () => {
    expect(suggestFeedType('Alfalfa', 2, 'round', FEEDS)).toMatchObject({ id: 'a2', sure: true })
    expect(suggestFeedType('Alfalfa', 1, 'big_square', FEEDS)).toMatchObject({ id: 'a1', sure: true })
  })
  it('takes alfalfa with no cut by bale size, else asks the cut', () => {
    expect(suggestFeedType('Alfalfa', null, 'big_square', FEEDS)).toMatchObject({ id: 'asq', sure: true })
    const g = suggestFeedType('Alfalfa', null, 'round', FEEDS)
    expect(g.sure).toBe(false)
    expect(g.id).toBeNull()
    expect(g.ask).toMatch(/cut/i)
    expect(g.likely).not.toContain('mix')
  })
  it('knows sainfoin and green feed', () => {
    expect(suggestFeedType('Sainfoin', null, 'round', FEEDS)).toMatchObject({ id: 'sf', sure: true })
    expect(suggestFeedType('Green Feed', null, 'round', FEEDS)).toMatchObject({ id: 'gf', sure: true })
  })
  it('asks about grass when the only grass feed is a mix', () => {
    const g = suggestFeedType('Grass', null, 'round', FEEDS)
    expect(g).toMatchObject({ id: null, sure: false })
    expect(g.likely).toEqual(['mix'])
  })
  it('asks about a cereal, leading with straw of that crop', () => {
    const g = suggestFeedType('Barley', null, 'round', FEEDS)
    expect(g.sure).toBe(false)
    expect(g.id).toBeNull()
    expect(g.likely[0]).toBe('bs')
    expect(g.likely).toEqual(expect.arrayContaining(['gf', 'sil', 'bed']))
    // Grain is not a baled feed; archived feeds are not offered.
    expect(g.likely).not.toContain('corn')
    expect(suggestFeedType('Alfalfa', null, 'round', FEEDS).likely).not.toContain('old')
  })
  it('asks when there is no crop', () => {
    expect(suggestFeedType(null, null, 'round', FEEDS)).toMatchObject({ id: null, sure: false })
  })
  it('does not call an alfalfa seed crop hay', () => {
    expect(suggestFeedType('Alfalfa Seed', null, 'round', FEEDS).sure).toBe(false)
    expect(isHayCrop('Alfalfa Seed')).toBe(false)
    expect(isHayCrop('Alfalfa')).toBe(true)
    expect(isHayCrop('Barley')).toBe(false)
  })
})

describe('defaultBaleType', () => {
  it('follows the feed when it is counted in bales', () => {
    expect(defaultBaleType({ default_unit: 'big_square' })).toBe('big_square')
    expect(defaultBaleType({ default_unit: 'lb' })).toBe('round')
    expect(defaultBaleType(null)).toBe('round')
  })
})

describe('lotLbPerBale', () => {
  const defaults = [
    { bale_type: 'round', lb_per_bale: 900 },
    { bale_type: 'big_square', lb_per_bale: null },
  ]
  it('uses a weighed bale first', () => {
    expect(lotLbPerBale({ unit: 'round', lb_per_bale: 777 }, { default_unit: 'round', default_lb_per_bale: 555 }, defaults)).toEqual({ lb: 777, from: 'own' })
  })
  it("uses the feed's bale weight only for the size it is for", () => {
    expect(lotLbPerBale({ unit: 'round', lb_per_bale: null }, { default_unit: 'round', default_lb_per_bale: 555 }, defaults)).toEqual({ lb: 555, from: 'feed' })
    expect(lotLbPerBale({ unit: 'round', lb_per_bale: null }, { default_unit: 'big_square', default_lb_per_bale: 555 }, defaults)).toEqual({ lb: 900, from: 'size' })
  })
  it('leaves bales unweighed when nobody has a figure', () => {
    expect(lotLbPerBale({ unit: 'big_square', lb_per_bale: null }, { default_unit: 'round', default_lb_per_bale: 555 }, defaults)).toEqual({ lb: null, from: null })
    expect(lotLbPerBale({ unit: 'lb', lb_per_bale: null }, null, defaults)).toEqual({ lb: null, from: null })
  })
})

describe('isWeightEstimate', () => {
  it('is an estimate until weighed, feed test or not', () => {
    expect(isWeightEstimate({ weight_basis: 'estimate', feed_test_id: null })).toBe(true)
    expect(isWeightEstimate({ weight_basis: 'estimate', feed_test_id: 't' })).toBe(true)
    expect(isWeightEstimate({ weight_basis: 'weighed', feed_test_id: null })).toBe(false)
    expect(isWeightEstimate({ weight_basis: null, feed_test_id: null })).toBe(false)
  })
})

describe('defaultRanch', () => {
  const ranches = [
    { id: 'north', latitude: 50.5, longitude: -112 },
    { id: 'south', latitude: 52.0, longitude: -112 },
    { id: 'nowhere', latitude: null, longitude: null },
  ]
  it('picks the nearest ranch to the field', () => {
    expect(defaultRanch(ranches, { lat: 52.1, lon: -113.9 })).toBe('south')
    expect(defaultRanch(ranches, { lat: 50.4, lon: -113.7 })).toBe('north')
  })
  it('falls back to the main ranch, then the first', () => {
    expect(defaultRanch(ranches, null, 'south')).toBe('south')
    expect(defaultRanch(ranches, { lat: null, lon: null })).toBe('north')
    expect(defaultRanch([], null)).toBeNull()
    expect(defaultRanch([ranches[2]], { lat: 1, lon: 1 })).toBe('nowhere')
  })
})

describe('baleCount', () => {
  it('is the amount of a baling record in bales', () => {
    expect(baleCount({ work_type: 'baling', amount: 12, amount_unit: 'bales' })).toBe(12)
    expect(baleCount({ work_type: 'baling', amount: 12, amount_unit: ' Bales ' })).toBe(12)
    expect(baleCount({ work_type: 'baling', amount: 12, amount_unit: 't' })).toBeNull()
    expect(baleCount({ work_type: 'baling', amount: 0, amount_unit: 'bales' })).toBeNull()
    expect(baleCount({ work_type: 'bale_hauling', amount: 12, amount_unit: 'bales' })).toBeNull()
  })
})
