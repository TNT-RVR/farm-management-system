import { describe, expect, it } from 'vitest'
import { classForHerdName, fillForClass, refill, sexForClass, weightForClass } from './manifest-fill'

/** Home Ranch's own herd list, names and all. */
const herd = [
  { class_name: 'Bulls', avg_weight_lb: 1800 },
  { class_name: 'Cows', avg_weight_lb: 1350 },
  { class_name: 'Replacement heifers', avg_weight_lb: 1200 },
  { class_name: 'Calves', avg_weight_lb: 480 },
  { class_name: 'Yearlings', avg_weight_lb: 850 },
]

describe('sexForClass', () => {
  it('states the sex a class states', () => {
    expect(sexForClass('heifers')).toBe('Heifer')
    expect(sexForClass('Bulls')).toBe('Bull')
    expect(sexForClass('cows')).toBe('Cow')
    expect(sexForClass('steers')).toBe('Steer')
  })

  // A load of either is usually mixed; a guess here goes on paperwork a brand
  // inspector reads.
  it('says nothing for the mixed classes', () => {
    expect(sexForClass('calves')).toBe('')
    expect(sexForClass('yearlings')).toBe('')
    expect(sexForClass('')).toBe('')
    expect(sexForClass(null)).toBe('')
  })
})

describe('weightForClass', () => {
  it('matches the ranch name for the class, not just the exact word', () => {
    expect(weightForClass(herd, 'cows')).toBe('1350')
    expect(weightForClass(herd, 'heifers')).toBe('1200')
    expect(weightForClass(herd, 'bulls')).toBe('1800')
  })

  it('gives nothing for a class this ranch does not keep', () => {
    expect(weightForClass(herd, 'steers')).toBe('')
    expect(weightForClass([], 'cows')).toBe('')
    expect(weightForClass(undefined, 'cows')).toBe('')
    expect(weightForClass(herd, '')).toBe('')
  })

  it('ignores a class whose weight was never entered', () => {
    expect(weightForClass([{ class_name: 'Cows', avg_weight_lb: null }], 'cows')).toBe('')
    expect(weightForClass([{ class_name: 'Cows', avg_weight_lb: 0 }], 'cows')).toBe('')
  })

  it('takes a weight the database handed back as a string', () => {
    expect(weightForClass([{ class_name: 'Cows', avg_weight_lb: '1349.6' }], 'cows')).toBe('1350')
  })

  // An exact match wins: a ranch with both must not have "Cows" answered by
  // "Bred cows" because that row happened to come first.
  it('prefers the exact name', () => {
    const both = [
      { class_name: 'Bred cows', avg_weight_lb: 1400 },
      { class_name: 'Cows', avg_weight_lb: 1350 },
    ]
    expect(weightForClass(both, 'cows')).toBe('1350')
  })
})

describe('classForHerdName', () => {
  it('says what the manifest calls each of our herd classes', () => {
    expect(herd.map((h) => classForHerdName(h.class_name))).toEqual([
      'bulls',
      'cows',
      'heifers',
      'calves',
      'yearlings',
    ])
  })

  it('passes through a class it has never heard of, and nothing for nothing', () => {
    expect(classForHerdName('Bison')).toBe('bison')
    expect(classForHerdName('')).toBe('')
    expect(classForHerdName(null)).toBe('')
  })
})

describe('fillForClass', () => {
  it('fills the four boxes that follow from the class and the ranch', () => {
    expect(fillForClass('cows', { herd, colour: 'Red', brand: 'A7' })).toEqual({
      sex: 'Cow',
      colour: 'Red',
      avg_weight_lb: '1350',
      brand: 'A7',
    })
  })

  it('leaves empty what settings do not say', () => {
    expect(fillForClass('steers', { herd, colour: null, brand: '' })).toEqual({
      sex: 'Steer',
      colour: '',
      avg_weight_lb: '',
      brand: '',
    })
  })
})

describe('refill', () => {
  it('replaces what the last class put there', () => {
    expect(refill('Cow', 'Cow', 'Bull')).toBe('Bull')
    expect(refill('', 'Cow', 'Bull')).toBe('Bull')
    expect(refill(undefined, '', 'Bull')).toBe('Bull')
  })

  it('keeps what somebody typed', () => {
    expect(refill('1375', '1350', '1800')).toBe('1375')
    expect(refill('Mixed', '', 'Cow')).toBe('Mixed')
  })
})
