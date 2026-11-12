import { describe, expect, it } from 'vitest'
import { allUnits, bushelWeightFor, convertMass, digitsFor } from './bushels'

describe('bushelWeightFor', () => {
  it('uses the crop record when it has one', () => {
    const w = bushelWeightFor('Canola', 50)
    expect(w).toEqual({ lbPerBu: 50, source: 'crop', label: 'Canola' })
  })

  it('falls back to the trade standard', () => {
    expect(bushelWeightFor('Barley', null)).toEqual({
      lbPerBu: 48,
      source: 'standard',
      label: 'Barley',
    })
    expect(bushelWeightFor('Oats', null)?.lbPerBu).toBe(34)
  })

  it('matches this farm’s own crop names', () => {
    // The crop list has "Vandermeer Corn" and "Beans-Pinto"; a table keyed on exact
    // names would miss both.
    expect(bushelWeightFor('Vandermeer Corn', null)?.lbPerBu).toBe(56)
    expect(bushelWeightFor('Beans-Pinto', null)?.lbPerBu).toBe(60)
  })

  it('prefers the more specific standard where two could match', () => {
    // Durum is wheat, and both patterns would fire — durum is listed first.
    expect(bushelWeightFor('Durum Wheat', null)?.label).toBe('Durum')
  })

  it('says nothing for a crop not sold by the bushel', () => {
    expect(bushelWeightFor('Potato', null)).toBeNull()
    expect(bushelWeightFor('Alfalfa', null)).toBeNull()
    // Sold by the pound, every one of them. A bushel figure here would be made
    // up, and a made-up figure is worse than a blank.
    expect(bushelWeightFor('Grass', null)).toBeNull()
    expect(bushelWeightFor('Quinoa', null)).toBeNull()
    expect(bushelWeightFor('Spinach Seed', null)).toBeNull()
    expect(bushelWeightFor('Phacelia', null)).toBeNull()
  })

  it('does not take ryegrass seed for cereal rye', () => {
    expect(bushelWeightFor('Rye Grass Seed', null)).toBeNull()
    expect(bushelWeightFor('Ryegrass', null)).toBeNull()
    // The cereal still answers.
    expect(bushelWeightFor('Fall Rye', null)?.lbPerBu).toBe(56)
  })

  it('weighs the alfalfa seed without weighing the hay', () => {
    expect(bushelWeightFor('Alfalfa Seed', null)?.lbPerBu).toBe(60)
    expect(bushelWeightFor('Alfalfa', null)).toBeNull()
  })

  it('names the crop the figure came from', () => {
    // Both are 60 lb, so the number was never wrong -- the screen saying where
    // it came from was.
    expect(bushelWeightFor('Chickpeas', null)?.label).toBe('Chickpeas')
    expect(bushelWeightFor('Peas', null)?.lbPerBu).toBe(60)
    expect(bushelWeightFor('Sorghum', null)?.lbPerBu).toBe(56)
    expect(bushelWeightFor('Triticale', null)?.lbPerBu).toBe(50)
  })

  it('ignores a nonsense recorded weight rather than dividing by it', () => {
    expect(bushelWeightFor('Canola', 0)?.source).toBe('standard')
    expect(bushelWeightFor('Canola', -5)?.source).toBe('standard')
  })
})

describe('convertMass', () => {
  it('converts bushels to tonnes for a real load', () => {
    // 1,000 bu of canola at 50 lb/bu = 50,000 lb = 22.68 t.
    expect(convertMass(1000, 'bu', 't', 50)).toBeCloseTo(22.6796, 3)
  })

  it('gets wheat and corn right, which differ by four pounds a bushel', () => {
    expect(convertMass(1, 'bu', 'lb', 60)).toBe(60)
    expect(convertMass(1, 'bu', 'lb', 56)).toBe(56)
  })

  it('round-trips', () => {
    const t = convertMass(2500, 'bu', 't', 48) as number
    expect(convertMass(t, 't', 'bu', 48)).toBeCloseTo(2500, 6)
  })

  it('converts weight to weight with no crop at all', () => {
    expect(convertMass(1, 't', 'kg', null)).toBe(1000)
    expect(convertMass(1, 'ston', 'lb', null)).toBe(2000)
    expect(convertMass(1, 'cwt', 'lb', null)).toBe(100)
  })

  it('refuses a bushel conversion with no bushel weight', () => {
    expect(convertMass(100, 'bu', 'kg', null)).toBeNull()
    expect(convertMass(100, 'kg', 'bu', null)).toBeNull()
  })

  it('keeps the two tonnes apart', () => {
    const metric = convertMass(1, 't', 'lb', null) as number
    const short = convertMass(1, 'ston', 'lb', null) as number
    expect(metric).toBeGreaterThan(short)
    expect(metric / short).toBeCloseTo(1.10231, 4)
  })

  it('is null for a value that is not a number', () => {
    expect(convertMass(Number.NaN, 'bu', 'kg', 50)).toBeNull()
  })
})

describe('allUnits', () => {
  it('answers every unit at once, and blanks the ones it cannot', () => {
    const rows = allUnits(100, 'kg', null)
    expect(rows.find((r) => r.unit === 'lb')?.value).toBeCloseTo(220.462, 2)
    expect(rows.find((r) => r.unit === 'bu')?.value).toBeNull()
  })

  it('fills bushels in once the crop is known', () => {
    const rows = allUnits(1, 't', 60)
    expect(rows.find((r) => r.unit === 'bu')?.value).toBeCloseTo(36.7437, 3)
  })
})

describe('digitsFor', () => {
  it('gives tonnes more precision than pounds', () => {
    expect(digitsFor('t')).toBe(3)
    expect(digitsFor('lb')).toBe(0)
  })
})
