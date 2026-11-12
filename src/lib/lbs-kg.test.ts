import { describe, expect, it } from 'vitest'
import { isLbs, kgAside, kgNumber, kgRangeAside, kgText, toKg, KG_PER_LB } from './lbs-kg'

describe('pounds to kilograms', () => {
  it('converts by the exact definition of the pound', () => {
    expect(KG_PER_LB).toBe(0.45359237)
    expect(toKg(1)).toBeCloseTo(0.45359237, 10)
    // A bean crop's normal yield.
    expect(toKg(3000)).toBeCloseTo(1360.77711, 5)
  })

  it('has nothing to say about a missing or unreadable figure', () => {
    expect(toKg(null)).toBeNull()
    expect(toKg(undefined)).toBeNull()
    expect(toKg(Number.NaN)).toBeNull()
    expect(kgNumber(null)).toBeNull()
  })

  it('drops the decimal on a big number and keeps it on a small one', () => {
    expect(kgNumber(3000)).toBe('1,361')
    expect(kgNumber(40)).toBe('18.1')
    // Right at the boundary: 100 kg and over reads whole.
    expect(kgNumber(250)).toBe('113')
  })
})

describe('which units get kilograms', () => {
  it('is pounds, however they are spelled', () => {
    expect(isLbs('lbs')).toBe(true)
    expect(isLbs('lb')).toBe(true)
    expect(isLbs('LBS')).toBe(true)
    expect(isLbs(' lbs ')).toBe(true)
  })

  it('is not a volume or another weight somebody reads directly', () => {
    // A bushel's weight depends on the crop, so it cannot convert here.
    expect(isLbs('bu')).toBe(false)
    expect(isLbs('cwt')).toBe(false)
    expect(isLbs('MT')).toBe(false)
    expect(isLbs('ac')).toBe(false)
    expect(isLbs(null)).toBe(false)
    expect(isLbs('')).toBe(false)
  })
})

describe('what goes on the screen', () => {
  it('writes the kilograms per acre for a pounds crop', () => {
    expect(kgText(3000, 'lbs')).toBe('1,361 kg/ac')
  })

  it('writes nothing at all for any other unit', () => {
    expect(kgText(80, 'bu')).toBeNull()
    expect(kgText(250, 'cwt')).toBeNull()
    expect(kgAside(80, 'bu')).toBe('')
  })

  it('takes whatever trails the unit at the call site', () => {
    // A total weight rather than a rate: no "/ac".
    expect(kgText(52000, 'lbs', '')).toBe('23,587 kg')
    expect(kgAside(52000, 'lbs', '')).toBe(' (23,587 kg)')
  })

  it('brackets it for a line of running text', () => {
    expect(`3,000 lbs/ac${kgAside(3000, 'lbs')}`).toBe('3,000 lbs/ac (1,361 kg/ac)')
  })
})

describe('bushels, which weigh what the crop weighs', () => {
  it('converts with the crop’s test weight', () => {
    // Soybeans and dry beans: 60 lb to the bushel.
    expect(kgText(40, 'bu', '/ac', 60)).toBe('1,089 kg/ac')
    // Canola is 50.
    expect(kgText(40, 'bu', '/ac', 50)).toBe('907 kg/ac')
  })

  it('says nothing at all when the test weight is not set', () => {
    // A guess on a number somebody sends a buyer is worse than no number.
    expect(kgText(40, 'bu')).toBeNull()
    expect(kgText(40, 'bu', '/ac', null)).toBeNull()
    expect(kgAside(40, 'bu')).toBe('')
  })

  it('refuses a test weight that cannot be one', () => {
    expect(kgText(40, 'bu', '/ac', 0)).toBeNull()
    expect(kgText(40, 'bu', '/ac', -60)).toBeNull()
    expect(kgText(40, 'bu', '/ac', Number.NaN)).toBeNull()
  })

  it('ignores a test weight on a crop already in pounds', () => {
    // The pounds are pounds; a test weight has nothing to do with it.
    expect(kgText(3000, 'lbs', '/ac', 60)).toBe('1,361 kg/ac')
  })

  it('still says nothing for a hundredweight or a tonne', () => {
    expect(kgText(250, 'cwt', '/ac', 100)).toBeNull()
    expect(kgText(5, 'MT', '/ac', 60)).toBeNull()
  })
})

describe('a band rather than a figure', () => {
  it('converts both ends of a yield zone', () => {
    expect(kgRangeAside(1360, 1800, 'lbs', '')).toBe(' (617–816 kg)')
  })

  it('converts the end an open band has', () => {
    expect(kgRangeAside(1800, null, 'lbs', '')).toBe(' (816+ kg)')
    expect(kgRangeAside(null, 1800, 'lbs', '')).toBe(' (up to 816 kg)')
  })

  it('says nothing for a band in index points or bushels', () => {
    // Yield-zone bands are often unitless index points.
    expect(kgRangeAside(74, 100, null)).toBe('')
    expect(kgRangeAside(40, 60, 'bu')).toBe('')
    expect(kgRangeAside(null, null, 'lbs')).toBe('')
  })
})
