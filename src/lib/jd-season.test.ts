import { describe, expect, it } from 'vitest'
import { seasonFor } from './jd-season'

describe('Deere crop season', () => {
  it('fixes a season years away from the work', () => {
    expect(seasonFor(2028, '2026-09-24T17:46:29Z')).toBe(2026)
    expect(seasonFor(2019, '2026-05-19T14:48:46Z')).toBe(2026)
  })
  it('keeps next season for fall work, and last season for a winter harvest', () => {
    expect(seasonFor(2027, '2026-10-15T15:00:00Z')).toBe(2027)
    expect(seasonFor(2027, '2026-05-15T15:00:00Z')).toBe(2026)
    expect(seasonFor(2025, '2026-01-20T15:00:00Z')).toBe(2025)
    expect(seasonFor(2025, '2026-06-20T15:00:00Z')).toBe(2026)
  })
  it('fills a missing season from the date, and leaves a season with no date alone', () => {
    expect(seasonFor(null, '2026-06-01T12:00:00Z')).toBe(2026)
    expect(seasonFor('2026', null)).toBe(2026)
    expect(seasonFor(null, null)).toBeNull()
  })
})
