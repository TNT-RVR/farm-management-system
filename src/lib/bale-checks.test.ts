import { describe, expect, it } from 'vitest'
import { cToF, fToC, formOf, moistureRisk, readingRisk, tempRisk } from './bale-checks'

describe('tempRisk', () => {
  it('bands core temperature the way the hay-fire guides do', () => {
    expect(tempRisk(40)?.level).toBe('ok')
    expect(tempRisk(55)?.level).toBe('watch')
    expect(tempRisk(70)?.level).toBe('danger')
    expect(tempRisk(80)?.level).toBe('fire')
    expect(tempRisk(null)).toBeNull()
  })
  it('puts the boundaries in the hotter band', () => {
    expect(tempRisk(52)?.level).toBe('watch')
    expect(tempRisk(79)?.level).toBe('fire')
  })
})

describe('moistureRisk', () => {
  it('holds denser bales to drier hay', () => {
    expect(moistureRisk(17, 'round')?.level).toBe('ok')
    expect(moistureRisk(17, 'big_square')?.level).toBe('watch')
    expect(moistureRisk(19, 'small_square')?.level).toBe('ok')
    expect(moistureRisk(21, null)).toEqual({ level: 'watch', limit: 20 })
  })
})

describe('readingRisk', () => {
  it('is the worse of temperature and moisture', () => {
    expect(readingRisk({ temp_c: 30, moisture_pct: 25, bale_form: 'round' })).toBe('watch')
    expect(readingRisk({ temp_c: 70, moisture_pct: 10, bale_form: 'round' })).toBe('danger')
    expect(readingRisk({ temp_c: null, moisture_pct: null, bale_form: null })).toBe('ok')
  })
})

it('converts probe readings both ways', () => {
  expect(cToF(79)).toBeCloseTo(174.2, 1)
  expect(fToC(175)).toBeCloseTo(79.4, 1)
  expect(formOf('round')).toBe('round')
  expect(formOf('lb')).toBeNull()
})
