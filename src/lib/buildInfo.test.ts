import { describe, expect, it } from 'vitest'
import { buildAgeDays, describeBuild } from './buildInfo'

describe('describeBuild', () => {
  it('reads as a commit and a time', () => {
    const s = describeBuild('3a91c0f', '2026-09-14T20:42:00Z')
    expect(s).toContain('3a91c0f')
    expect(s).toContain('·')
    expect(s).toMatch(/Sep/)
  })

  // A build with no stamp must still say something rather than render "undefined"
  // next to a commit — the whole point is a line somebody can read back.
  it('falls back to the commit alone when there is no timestamp', () => {
    expect(describeBuild('3a91c0f', '')).toBe('3a91c0f')
    expect(describeBuild('3a91c0f', 'not a date')).toBe('3a91c0f')
  })
})

describe('buildAgeDays', () => {
  const now = new Date('2026-09-14T12:00:00Z').getTime()

  it('counts whole days', () => {
    expect(buildAgeDays('2026-09-14T11:00:00Z', now)).toBe(0)
    expect(buildAgeDays('2026-09-11T11:00:00Z', now)).toBe(3)
  })

  // A machine whose clock is ahead would otherwise report a build from the
  // future as days old and nag about updating something already current.
  it('never reports a negative age', () => {
    expect(buildAgeDays('2026-09-20T12:00:00Z', now)).toBe(0)
  })

  it('has no opinion when there is no stamp', () => {
    expect(buildAgeDays('', now)).toBeNull()
  })
})
