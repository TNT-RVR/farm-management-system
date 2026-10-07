import { describe, expect, it } from 'vitest'
import { compareCrop, cropTokens, prettyCrop } from './cropMatch'

// The real crop list from the farm, and the real names Deere sends back.
const CROPS = [
  'Green Feed', 'Seed Canola', 'Fescue', 'Canola', 'Sainfoin', 'Carrots', 'Potato',
  'Vandermeer Corn', 'Corn', 'Durum Wheat', 'Summer Fallow', 'Beans-Great Northern',
  'Beans-Pinto', 'Beans-Yellow', 'Alfalfa',
]

describe('cropTokens', () => {
  it('drops handling qualifiers that are not the crop', () => {
    expect([...cropTokens('CORN_WET')]).toEqual(['corn'])
    expect([...cropTokens('POTATOES_FOR_RETAIL')]).toEqual(['potato'])
    expect([...cropTokens('EDIBLE_BEANS')]).toEqual(['bean'])
  })

  it('stems plurals so potatoes meets potato', () => {
    expect(cropTokens('Carrots')).toEqual(cropTokens('CARROTS'))
    expect(cropTokens('Potato')).toEqual(cropTokens('POTATOES_FOR_RETAIL'))
  })
})

describe('compareCrop', () => {
  it('matches across word order', () => {
    expect(compareCrop('WHEAT_DURUM', 'Durum Wheat', CROPS)).toBe('match')
  })

  it('matches a qualified Deere name to the plain crop', () => {
    expect(compareCrop('CORN_WET', 'Corn', CROPS)).toBe('match')
    expect(compareCrop('POTATOES_FOR_RETAIL', 'Potato', CROPS)).toBe('match')
  })

  // The whole reason this is token-based: these would all be false alarms.
  it('does not flag a variety of the planned crop', () => {
    expect(compareCrop('CORN_WET', 'Vandermeer Corn', CROPS)).toBe('match')
    expect(compareCrop('CANOLA', 'Seed Canola', CROPS)).toBe('match')
    expect(compareCrop('EDIBLE_BEANS', 'Beans-Pinto', CROPS)).toBe('match')
    expect(compareCrop('EDIBLE_BEANS', 'Beans-Great Northern', CROPS)).toBe('match')
  })

  it('flags a genuine mismatch', () => {
    expect(compareCrop('CANOLA', 'Durum Wheat', CROPS)).toBe('mismatch')
    expect(compareCrop('EDIBLE_BEANS', 'Potato', CROPS)).toBe('mismatch')
  })

  // BARLEY and GRASS_SEEDS are both in the Deere data with no counterpart in our
  // crop list. That is a gap in our list, not proof the field was planted wrong.
  it('stays silent when Deere names a crop we do not have at all', () => {
    expect(compareCrop('BARLEY', 'Canola', CROPS)).toBe('unknown')
    expect(compareCrop('GRASS_SEEDS', 'Canola', CROPS)).toBe('unknown')
  })

  it('is unknown when either side is missing', () => {
    expect(compareCrop(null, 'Canola', CROPS)).toBe('unknown')
    expect(compareCrop('CANOLA', null, CROPS)).toBe('unknown')
    expect(compareCrop('', '', CROPS)).toBe('unknown')
  })
})

describe('prettyCrop', () => {
  it('reads like English', () => {
    expect(prettyCrop('POTATOES_FOR_RETAIL')).toBe('Potatoes For Retail')
    expect(prettyCrop('CORN_WET')).toBe('Corn Wet')
  })
})
