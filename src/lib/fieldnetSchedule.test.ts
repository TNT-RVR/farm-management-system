import { describe, expect, it } from 'vitest'
import { fieldnetOffSeason, fieldnetOffSeasonSlot, heartbeatStaleAfterMin } from './fieldnetSchedule'

describe('fieldnet off-season schedule', () => {
  it('backs off November through March', () => {
    expect([11, 12, 1, 2, 3].every(fieldnetOffSeason)).toBe(true)
    expect([4, 5, 6, 7, 8, 9, 10].some(fieldnetOffSeason)).toBe(false)
  })

  it('runs only in the first half hour of every third hour', () => {
    expect(fieldnetOffSeasonSlot(6, 0)).toBe(true)
    expect(fieldnetOffSeasonSlot(6, 30)).toBe(false)
    expect(fieldnetOffSeasonSlot(7, 0)).toBe(false)
  })

  it('gives the winter sync time to report before calling it stale', () => {
    expect(heartbeatStaleAfterMin('fieldnet', 60, 11)).toBe(240)
    expect(heartbeatStaleAfterMin('fieldnet', 60, 7)).toBe(60)
    // A threshold already looser than the winter gap is left alone.
    expect(heartbeatStaleAfterMin('fieldnet', 600, 1)).toBe(600)
    // Other feeds keep their own threshold all year.
    expect(heartbeatStaleAfterMin('fieldnet_applied', 360, 12)).toBe(360)
  })
})
