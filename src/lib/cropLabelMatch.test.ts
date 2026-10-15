import { describe, expect, it } from 'vitest'
import { cropMatches, normaliseCrop, rowsForCrop } from './cropLabelMatch'

describe('cropMatches', () => {
  it('matches the crops this farm grows to their label names', () => {
    expect(cropMatches('POTATOES_FOR_RETAIL', 'Potatoes')).toBe(true)
    expect(cropMatches('CARROTS', 'Carrots')).toBe(true)
    expect(cropMatches('CANOLA', 'Canola')).toBe(true)
    expect(cropMatches('WHEAT_DURUM', 'durum wheat')).toBe(true)
    expect(cropMatches('EDIBLE_BEANS', 'Dry Common Beans')).toBe(true)
    expect(cropMatches('CORN_WET', 'Corn')).toBe(true)
  })

  it('ignores the bracketed qualifiers labels are full of', () => {
    expect(cropMatches('EDIBLE_BEANS', 'Dry Common Beans (Phaseolus vulgaris varieties only)')).toBe(
      true,
    )
  })

  it('allows a qualifier after the crop but not a different word starting the same', () => {
    expect(cropMatches('POTATOES_FOR_RETAIL', 'Potatoes seed production')).toBe(true)
    expect(cropMatches('CORN_WET', 'Cornflower')).toBe(false)
  })

  // The single most important case in this file. Sweet corn carries a 20-day
  // hand-harvest interval on labels where field corn carries 24 hours, and
  // CORN_WET is silage corn. Matching these would put one crop's safety
  // interval on another.
  it('never treats sweet corn or seed corn as field corn', () => {
    expect(cropMatches('CORN_WET', 'Sweet Corn')).toBe(false)
    expect(cropMatches('CORN_WET', 'seed corn')).toBe(false)
    expect(cropMatches('CORN_WET', 'Popcorn')).toBe(false)
  })

  it('does not confuse beans with soybeans', () => {
    expect(cropMatches('EDIBLE_BEANS', 'Soybeans')).toBe(false)
  })

  it('refuses anything it cannot name, rather than guessing', () => {
    expect(cropMatches('SOMETHING_NEW', 'Potatoes')).toBe(false)
    expect(cropMatches('POTATOES_FOR_RETAIL', 'Bushberries')).toBe(false)
    expect(cropMatches(null, 'Potatoes')).toBe(false)
    expect(cropMatches(undefined, 'Potatoes')).toBe(false)
    expect(cropMatches('POTATOES_FOR_RETAIL', '')).toBe(false)
  })
})

describe('rowsForCrop', () => {
  // The Lorox L table, which is why per-crop intervals exist at all.
  const lorox = [
    { crop: 'Potatoes', reentry: 96 },
    { crop: 'Asparagus', reentry: 96 },
    { crop: 'Carrots', reentry: 192 },
    { crop: 'Celery', reentry: 240 },
    { crop: 'Coriander and Caraway', reentry: 12 },
  ]

  it('picks the row for the crop in the field', () => {
    expect(rowsForCrop('CARROTS', lorox)).toEqual([{ crop: 'Carrots', reentry: 192 }])
    expect(rowsForCrop('POTATOES_FOR_RETAIL', lorox)).toEqual([{ crop: 'Potatoes', reentry: 96 }])
  })

  it('returns nothing for a crop the label does not cover', () => {
    // Which the caller must read as "fall back to the whole-label interval",
    // not as "no restriction".
    expect(rowsForCrop('CANOLA', lorox)).toEqual([])
  })
})

describe('normaliseCrop', () => {
  it('strips punctuation, case and Deere underscores', () => {
    expect(normaliseCrop('POTATOES_FOR_RETAIL')).toBe('potatoes for retail')
    expect(normaliseCrop('Flax (including low linolenic acid varieties)')).toBe('flax')
    expect(normaliseCrop('  Sweet  Corn ')).toBe('sweet corn')
  })
})
