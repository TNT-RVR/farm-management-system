import { describe, expect, it } from 'vitest'
import { crossed } from '../../netlify/shared/market-alerts'

describe('crossed', () => {
  it('fires at the threshold, not only past it', () => {
    // "Over $760" should fire AT $760. Someone who set that line meant it.
    expect(crossed(760, 'above', 760)).toBe(true)
    expect(crossed(760.01, 'above', 760)).toBe(true)
    expect(crossed(759.99, 'above', 760)).toBe(false)
  })

  it('works the other way for a floor', () => {
    expect(crossed(5.0, 'below', 5.5)).toBe(true)
    expect(crossed(6.0, 'below', 5.5)).toBe(false)
  })
})
