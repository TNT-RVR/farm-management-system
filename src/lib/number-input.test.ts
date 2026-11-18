import { describe, expect, it } from 'vitest'
import { readAmount } from './number-input'

describe('readAmount', () => {
  it('reads figures, with or without thousands commas', () => {
    expect(readAmount('80', { label: 'N' })).toEqual({ value: 80, error: null })
    expect(readAmount('1,200', { label: 'Acres' })).toEqual({ value: 1200, error: null })
    expect(readAmount(65, { label: 'Acres' })).toEqual({ value: 65, error: null })
  })

  it('takes a blank box as 0 unless told otherwise', () => {
    expect(readAmount('', { label: 'S' }).value).toBe(0)
    expect(readAmount('  ', { label: 'Feed short', blank: null }).value).toBeNull()
  })

  it('refuses words rather than reading them as 0', () => {
    const r = readAmount('eighty', { label: 'N' })
    expect(r.value).toBeNull()
    expect(r.error).toMatch(/“eighty” is not a number/)
  })

  it('refuses a negative where none makes sense', () => {
    expect(readAmount('-65', { label: 'Acres', min: 0 }).error).toBe('Acres can’t be negative.')
    expect(readAmount('0', { label: 'Hay dry matter', min: 0, minExclusive: true }).error).toMatch(/more than 0/)
  })

  it('refuses a figure past what is real', () => {
    const r = readAmount('188', { label: 'Hay dry matter', min: 0, max: 100, unit: '%' })
    expect(r.value).toBeNull()
    expect(r.error).toBe('Hay dry matter of 188% is past 100% — check the figure.')
    expect(readAmount('5000', { label: 'N', max: 500, unit: 'lb/ac' }).error).toMatch(/5,000 lb\/ac is past 500 lb\/ac/)
    expect(readAmount('100', { label: 'Damage', min: 0, max: 100, unit: '%' }).error).toBeNull()
  })
})
