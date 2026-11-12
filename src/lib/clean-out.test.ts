import { describe, expect, it } from 'vitest'
import { cleanOutFor } from './clean-out'

describe('cleanOutFor', () => {
  it('takes the field actual once its clean yield is in', () => {
    expect(cleanOutFor({ clean_total: 900, scale_total: 1000 }, 5)).toEqual({ pct: 10, actual: true })
  })
  it('falls back to the crop estimate', () => {
    expect(cleanOutFor({ clean_total: null, scale_total: 1000 }, 5)).toEqual({ pct: 5, actual: false })
    expect(cleanOutFor(null, 3)).toEqual({ pct: 3, actual: false })
  })
  it('knows nothing without either', () => {
    expect(cleanOutFor(null, null)).toBeNull()
  })
})
