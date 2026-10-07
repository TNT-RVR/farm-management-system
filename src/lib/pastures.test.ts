import { describe, expect, it } from 'vitest'
import { ageSentence, freshness, ndviColour, staleness, NO_DATA_COLOUR } from './pastures'

describe('staleness', () => {
  it('splits on the spec §4.6 boundaries', () => {
    expect(staleness(0)).toBe('fresh')
    expect(staleness(3)).toBe('fresh')
    expect(staleness(4)).toBe('ageing')
    expect(staleness(8)).toBe('ageing')
    expect(staleness(9)).toBe('stale')
  })

  it('treats no observation as stale, not as fresh', () => {
    // The dangerous default: null must never fall through to 'fresh'.
    expect(staleness(null)).toBe('stale')
  })
})

describe('ndviColour', () => {
  it('shades a reading on the ramp regardless of its age', () => {
    // Age came off the colour deliberately — greying a field out hid the very
    // reading it was meant to convey. The age is stated in words instead.
    expect(ndviColour(0.65)).not.toBe(NO_DATA_COLOUR)
  })

  it('is grey only when nothing has ever been observed', () => {
    // A field nobody has imaged is not a bare one, and must not be shaded a
    // green it has not earned.
    expect(ndviColour(null)).toBe(NO_DATA_COLOUR)
  })
})

describe('ageSentence', () => {
  it('gives the age and the date of the real look', () => {
    // Month and day, not a fixed order: the date follows the reader's locale,
    // so asserting "6 Aug" would pass here and fail in America.
    const s = ageSentence(11, '2026-08-06')
    expect(s).toContain('11 days ago')
    expect(s).toMatch(/Aug/)
    expect(s).toMatch(/\b6\b/)
  })

  it('reads the date as UTC, not as local midnight', () => {
    // A date-only string parsed in local time lands on the 5th west of
    // Greenwich, so the panel would name the day before the satellite passed.
    expect(ageSentence(1, '2026-08-01')).toMatch(/\b1\b/)
    expect(ageSentence(1, '2026-08-01')).toMatch(/Aug/)
  })

  it('warns once the value is more estimate than measurement', () => {
    expect(ageSentence(11, '2026-08-06')).toContain('estimate, not a measurement')
    expect(ageSentence(5, '2026-08-06')).toContain('interpolated')
    // Fresh enough to need no caveat at all.
    expect(ageSentence(1, '2026-08-06')).not.toContain('estimate')
  })

  it('says so plainly when there is no look at all', () => {
    expect(ageSentence(null, null)).toBe('No clear satellite look yet.')
    expect(ageSentence(4, null)).toBe('No clear satellite look yet.')
  })

  it('never claims a current reading', () => {
    // §14.2: this module provides a daily estimate, not daily imagery.
    for (const days of [0, 1, 5, 30]) {
      expect(ageSentence(days, '2026-08-06')).not.toMatch(/live|real.?time/i)
    }
  })
})

describe('freshness', () => {
  it('never claims a current reading', () => {
    expect(freshness(0).label).not.toMatch(/current|live|now|today/i)
    expect(freshness(1).label).toBe('1 day old')
  })

  it('says so plainly when nothing has been observed', () => {
    expect(freshness(null).label).toBe('no imagery yet')
    expect(freshness(null).tone).toBe('poor')
  })
})
