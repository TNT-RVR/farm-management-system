import { describe, expect, it } from 'vitest'
import { describeSessions, sessionsFromTimes, workMinutes } from './op-sessions'

/** n points a second apart from `from`. */
const run = (from: string, seconds: number): string[] => {
  const t0 = Date.parse(from)
  return Array.from({ length: seconds }, (_, i) => new Date(t0 + i * 1000).toISOString())
}

describe('sessionsFromTimes', () => {
  it('reads two visits twelve days apart as two sittings, not 300 hours', () => {
    const times = [...run('2026-07-22T16:15:00Z', 3600 * 2), ...run('2026-08-04T04:30:00Z', 3600 * 2.2)]
    const s = sessionsFromTimes(times)
    expect(s).toHaveLength(2)
    expect(s[0].minutes).toBe(120)
    expect(s[1].minutes).toBe(132)
    expect(workMinutes(s)).toBe(252)
  })

  it('keeps a fill-up under half an hour inside the sitting but not in the minutes', () => {
    const times = [...run('2026-07-22T16:00:00Z', 1800), ...run('2026-07-22T16:50:00Z', 1800)]
    const s = sessionsFromTimes(times)
    expect(s).toHaveLength(1)
    // Two half hours of logging; the 20-minute gap is not time on the field.
    expect(s[0].minutes).toBe(60)
    expect(s[0].points).toBe(3600)
  })

  it('splits at a gap of half an hour or more', () => {
    const times = [...run('2026-07-22T16:00:00Z', 600), ...run('2026-07-22T16:45:00Z', 600)]
    expect(sessionsFromTimes(times)).toHaveLength(2)
  })

  it('has nothing to say about no points', () => {
    expect(sessionsFromTimes([])).toEqual([])
    expect(sessionsFromTimes(['not a time'])).toEqual([])
  })
})

describe('describeSessions', () => {
  it('folds sittings on one day together', () => {
    const s = sessionsFromTimes([
      ...run('2026-07-22T16:00:00Z', 600),
      ...run('2026-07-22T18:00:00Z', 600),
      ...run('2026-08-04T16:00:00Z', 600),
    ])
    const d = describeSessions(s)
    expect(d).toHaveLength(2)
    expect(d[0].minutes).toBe(20)
    expect(d[1].minutes).toBe(10)
  })
})
