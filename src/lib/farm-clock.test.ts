import { describe, expect, it } from 'vitest'
import { farmClock, farmTimeIs, farmTimeLabel } from './farm-clock'

const AB = 'America/Edmonton'

describe('farmClock', () => {
  it("reads the farm's own clock, summer and winter", () => {
    // 13:00 UTC is 7 am in Alberta in summer (MDT) and 6 am in winter (MST).
    expect(farmClock(new Date('2026-07-06T13:00:00Z'), AB)).toEqual({ weekday: 1, day: 6, month: 7, hour: 7 })
    expect(farmClock(new Date('2026-01-05T13:00:00Z'), AB).hour).toBe(6)
  })

  it('knows the local day can differ from the UTC one', () => {
    // Monday 7 am in Melbourne is still Sunday in UTC.
    expect(farmClock(new Date('2026-07-05T21:00:00Z'), 'Australia/Melbourne')).toEqual({ weekday: 1, day: 6, month: 7, hour: 7 })
  })
})

// Alberta winter dates stay before November 2026: tz data 2026c keeps the
// province on summer time from then, and CI may run either version.
describe('farmTimeIs', () => {
  const brief = { hours: [7], weekday: 1 }

  it('fires the Monday brief at 7 on the farm, wherever the farm is', () => {
    expect(farmTimeIs(brief, new Date('2026-07-06T13:00:00Z'), AB)).toBe(true)
    // In winter Alberta's 7 am is 14:00 UTC, not 13:00 (which was 6 am).
    expect(farmTimeIs(brief, new Date('2026-01-05T13:00:00Z'), AB)).toBe(false)
    expect(farmTimeIs(brief, new Date('2026-01-05T14:00:00Z'), AB)).toBe(true)
    expect(farmTimeIs(brief, new Date('2026-07-06T11:00:00Z'), 'America/Toronto')).toBe(true)
    expect(farmTimeIs(brief, new Date('2026-07-05T21:00:00Z'), 'Australia/Melbourne')).toBe(true)
  })

  it('takes a day of the month, months and two hours a day', () => {
    expect(farmTimeIs({ hours: [9], day: 1 }, new Date('2025-12-01T16:00:00Z'), AB)).toBe(true)
    expect(farmTimeIs({ hours: [9], day: 1 }, new Date('2025-12-02T16:00:00Z'), AB)).toBe(false)
    expect(farmTimeIs({ hours: [9], weekday: 1, months: [1] }, new Date('2026-01-05T16:00:00Z'), AB)).toBe(true)
    expect(farmTimeIs({ hours: [9], weekday: 1, months: [1] }, new Date('2026-02-02T16:00:00Z'), AB)).toBe(false)
    expect(farmTimeIs({ hours: [6, 16] }, new Date('2026-07-06T22:00:00Z'), AB)).toBe(true)
  })

  it('says when it will run', () => {
    expect(farmTimeLabel(brief)).toBe("Mondays at 7:00 on the farm's clock")
    expect(farmTimeLabel({ hours: [6, 16] })).toBe("daily at 6:00 and 16:00 on the farm's clock")
  })
})
