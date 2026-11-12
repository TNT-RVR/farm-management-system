import { describe, expect, it } from 'vitest'
import { fieldnetOffSeason, fieldnetOffSeasonDue, fieldnetOffSeasonSlot, heartbeatStaleAfterMin } from './fieldnetSchedule'

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

  it('catches up on the next tick when a slot was missed', () => {
    // Normal winter ticks between slots stay quiet.
    expect(fieldnetOffSeasonDue(15, 30, 30)).toBe(false)
    expect(fieldnetOffSeasonDue(17, 30, 150)).toBe(false)
    // The slot itself always runs.
    expect(fieldnetOffSeasonDue(18, 0, 180)).toBe(true)
    // Slot dropped by the scheduler: the half-hour tick after it runs.
    expect(fieldnetOffSeasonDue(18, 30, 210)).toBe(true)
    // Never synced (or unreadable) counts as overdue.
    expect(fieldnetOffSeasonDue(19, 0, null)).toBe(true)
  })

  it('gives the winter sync time to report before calling it stale', () => {
    expect(heartbeatStaleAfterMin('fieldnet', 60, 11)).toBe(240)
    expect(heartbeatStaleAfterMin('fieldnet', 60, 7)).toBe(60)
    // A threshold already looser than the winter gap is left alone.
    expect(heartbeatStaleAfterMin('fieldnet', 600, 1)).toBe(600)
    // Other feeds keep their own threshold all year.
    expect(heartbeatStaleAfterMin('fieldnet_applied', 360, 12)).toBe(360)
  })

  it('waits a week and a day for the Monday-only pasture satellite run off-season', () => {
    // The 5 Nov 2026 false alarm: three days after a Monday run.
    expect(heartbeatStaleAfterMin('sat_pasture', 4320, 11, 5)).toBe(11520)
    expect(heartbeatStaleAfterMin('sat_pasture', 4320, 4, 14)).toBe(11520)
    // In season it runs every day, so the 72 h threshold stands.
    expect(heartbeatStaleAfterMin('sat_pasture', 4320, 4, 15)).toBe(4320)
    expect(heartbeatStaleAfterMin('sat_pasture', 4320, 10, 31)).toBe(4320)
  })
})
