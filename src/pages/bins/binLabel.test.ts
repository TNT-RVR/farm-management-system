import { describe, expect, it } from 'vitest'
import { binLabel } from './BinMap'

describe('binLabel', () => {
  it('a pin says the number alone', () => {
    expect(binLabel('Main Yard - #21 (Fertilizer Bin)')).toBe('#21')
    expect(binLabel('Main Yard #23')).toBe('#23')
    expect(binLabel('Creek Yard - #3')).toBe('#3')
  })
  it('a bin with no number keeps its own name, without the yard', () => {
    expect(binLabel('Main Yard - Seed shed')).toBe('Seed shed')
    expect(binLabel('Quonset')).toBe('Quonset')
  })
})
