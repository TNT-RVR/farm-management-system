import { describe, expect, it } from 'vitest'
import { duration } from './fieldOps'

describe('duration', () => {
  it('reads as hours and minutes', () => {
    expect(duration('2026-06-03T04:12:00Z', '2026-06-03T06:48:00Z')).toBe('2h 36m')
  })

  it('drops the hours when under one', () => {
    expect(duration('2026-06-03T04:12:00Z', '2026-06-03T04:47:00Z')).toBe('35m')
  })

  it('spans midnight', () => {
    expect(duration('2026-06-03T23:30:00Z', '2026-06-04T01:00:00Z')).toBe('1h 30m')
  })

  // A pass with no end, or an end before its start, has no honest duration to
  // show — better blank than "0m", which reads as a pass that took no time.
  it('is null when there is nothing to measure', () => {
    expect(duration('2026-06-03T04:12:00Z', undefined)).toBeNull()
    expect(duration(undefined, '2026-06-03T04:12:00Z')).toBeNull()
    expect(duration('2026-06-03T06:00:00Z', '2026-06-03T04:00:00Z')).toBeNull()
    expect(duration('not a date', '2026-06-03T04:00:00Z')).toBeNull()
  })
})
