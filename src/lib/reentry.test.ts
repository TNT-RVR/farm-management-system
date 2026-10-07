import { describe, expect, it } from 'vitest'
import {
  byField,
  describeWait,
  effectiveReentryHours,
  statusFor,
  type AppliedEvent,
} from './reentry'

const NOW = new Date('2026-09-02T12:00:00')

const ev = (over: Partial<AppliedEvent> = {}): AppliedEvent => ({
  fieldId: 'f1',
  fieldName: 'Kellers',
  appliedAt: '2026-09-02T06:00:00',
  productName: 'Liberty',
  reentryHours: 12,
  ...over,
})

describe('statusFor', () => {
  it('counts the interval from when the sprayer left', () => {
    // Sprayed 06:00, twelve-hour interval, now noon: six hours to go.
    const s = statusFor(ev(), NOW)
    expect(s.state).toBe('restricted')
    expect(s.hoursLeft).toBe(6)
    expect(s.clearAt?.toISOString()).toBe(new Date('2026-09-02T18:00:00').toISOString())
  })

  it('clears once the interval has run', () => {
    expect(statusFor(ev({ appliedAt: '2026-09-01T06:00:00' }), NOW).state).toBe('clear')
  })

  it('never calls an unread label safe while it could still matter', () => {
    const s = statusFor(ev({ reentryHours: null }), NOW)
    expect(s.state).toBe('unknown')
    expect(s.clearAt).toBeNull()
  })

  it('stops shouting about an unread label once it cannot matter', () => {
    // A month on, an unknown interval is not a re-entry question any more.
    expect(statusFor(ev({ appliedAt: '2026-08-01T06:00:00', reentryHours: null }), NOW).state).toBe(
      'clear',
    )
  })

  it('rounds the wait up, so it is never reported short', () => {
    // Ten minutes left still reads as an hour.
    expect(statusFor(ev({ appliedAt: '2026-09-02T00:10:00' }), NOW).hoursLeft).toBe(1)
  })

  it('is unknown for a date it cannot read', () => {
    expect(statusFor(ev({ appliedAt: 'not a date' }), NOW).state).toBe('unknown')
  })
})

describe('byField', () => {
  it('gives a field the worst state of anything sprayed on it', () => {
    const [f] = byField(
      [
        ev({ productName: 'Cleared', appliedAt: '2026-09-01T06:00:00', reentryHours: 4 }),
        ev({ productName: 'Still out', reentryHours: 24 }),
      ],
      NOW,
    )
    expect(f.state).toBe('restricted')
    expect(f.worst?.productName).toBe('Still out')
  })

  it('prefers unknown over clear, because unknown is not safe', () => {
    const [f] = byField(
      [
        ev({ productName: 'Done', appliedAt: '2026-09-01T06:00:00', reentryHours: 4 }),
        ev({ productName: 'No label', reentryHours: null }),
      ],
      NOW,
    )
    expect(f.state).toBe('unknown')
  })

  it('picks the one that clears last among restricted products', () => {
    const [f] = byField(
      [
        ev({ productName: 'Short', reentryHours: 12 }),
        ev({ productName: 'Long', reentryHours: 48 }),
      ],
      NOW,
    )
    expect(f.worst?.productName).toBe('Long')
    expect(f.status.hoursLeft).toBe(42)
  })

  it('sorts restricted fields above the rest', () => {
    const out = byField(
      [
        ev({ fieldId: 'a', fieldName: 'Clear one', appliedAt: '2026-09-01T06:00:00', reentryHours: 4 }),
        ev({ fieldId: 'b', fieldName: 'Restricted one', reentryHours: 24 }),
      ],
      NOW,
    )
    expect(out.map((f) => f.fieldName)).toEqual(['Restricted one', 'Clear one'])
  })

  it('leaves out anything older than the recent window', () => {
    expect(byField([ev({ appliedAt: '2026-01-01T06:00:00' })], NOW)).toHaveLength(0)
  })

  it('leaves out applications with no field', () => {
    expect(byField([ev({ fieldId: null })], NOW)).toHaveLength(0)
  })

  it('lists a field’s products newest first', () => {
    const [f] = byField(
      [
        ev({ productName: 'Older', appliedAt: '2026-09-01T06:00:00' }),
        ev({ productName: 'Newer', appliedAt: '2026-09-02T06:00:00' }),
      ],
      NOW,
    )
    expect(f.events.map((e) => e.productName)).toEqual(['Newer', 'Older'])
  })
})

describe('describeWait', () => {
  it('reads plainly at a gate', () => {
    expect(describeWait(6)).toBe('6 hours')
    expect(describeWait(1)).toBe('1 hour')
    expect(describeWait(24)).toBe('1 day')
    expect(describeWait(51)).toBe('2 days 3 hours')
    expect(describeWait(0)).toBe('clear')
  })
})

describe('effectiveReentryHours', () => {
  it('uses the field interval over the label maximum', () => {
    // Rambler: 20 days for hand detasseling seed corn, 24 hours for everything
    // else. This farm grows no corn, so it is a one-day wait, not twenty.
    expect(effectiveReentryHours({ reentryHours: 480, reentryFieldHours: 24 })).toBe(24)
  })

  it('uses the field interval even when it is the LONGER of the two', () => {
    // Registration 16279 states six days for scouting and twelve hours for
    // other activities. Scouting is field work. A rule that took the smaller
    // number would send somebody into the crop five days early.
    expect(effectiveReentryHours({ reentryHours: 12, reentryFieldHours: 144 })).toBe(144)
  })

  it('falls back to the maximum when no field interval was read', () => {
    expect(effectiveReentryHours({ reentryHours: 480, reentryFieldHours: null })).toBe(480)
    expect(effectiveReentryHours({ reentryHours: 480 })).toBe(480)
  })

  it('still reports nothing when the label gave nothing', () => {
    expect(effectiveReentryHours({ reentryHours: null, reentryFieldHours: null })).toBeNull()
  })
})

describe('statusFor with two intervals', () => {
  it('clears on the field interval, not the label maximum', () => {
    // Sprayed at 06:00, it is now 12:00. Twenty-four-hour field interval means
    // still restricted; the 480-hour maximum must not be what decides.
    const s = statusFor(
      { appliedAt: '2026-09-02T06:00:00', reentryHours: 480, reentryFieldHours: 24 },
      NOW,
    )
    expect(s.state).toBe('restricted')
    expect(s.hoursLeft).toBe(18)
  })

  it('is clear a day later rather than three weeks later', () => {
    const s = statusFor(
      { appliedAt: '2026-09-01T06:00:00', reentryHours: 480, reentryFieldHours: 24 },
      NOW,
    )
    expect(s.state).toBe('clear')
  })

  it('stays restricted for the longer field interval where that is the case', () => {
    const s = statusFor(
      { appliedAt: '2026-09-01T06:00:00', reentryHours: 12, reentryFieldHours: 144 },
      NOW,
    )
    expect(s.state).toBe('restricted')
  })

  it('an unread field interval leaves the old behaviour untouched', () => {
    const s = statusFor({ appliedAt: '2026-09-02T06:00:00', reentryHours: 12 }, NOW)
    expect(s.state).toBe('restricted')
    expect(s.hoursLeft).toBe(6)
  })
})

// Lorox L is why per-crop intervals exist. Its label is a seven-crop table:
// potatoes 4 days, carrots 8 days to scout, celery 10, coriander 12 hours. One
// number for the product is wrong for nearly every crop on it.
describe('a label that states the interval by crop', () => {
  const lorox = [
    { crop: 'Potatoes', reentryHours: 96, reentryFieldHours: 96 },
    { crop: 'Carrots', reentryHours: 192, reentryFieldHours: 192 },
    { crop: 'Celery', reentryHours: 240, reentryFieldHours: 240 },
    { crop: 'Coriander and Caraway', reentryHours: 144, reentryFieldHours: 12 },
  ]

  it('uses the row for the crop that is actually in the field', () => {
    expect(
      effectiveReentryHours({
        reentryHours: 240,
        reentryFieldHours: 96,
        crop: 'CARROTS',
        cropIntervals: lorox,
      }),
    ).toBe(192)
  })

  it('gives a different answer for a different crop on the same label', () => {
    expect(
      effectiveReentryHours({
        reentryHours: 240,
        reentryFieldHours: 96,
        crop: 'POTATOES_FOR_RETAIL',
        cropIntervals: lorox,
      }),
    ).toBe(96)
  })

  it('falls back to the whole-label figure for a crop the label does not cover', () => {
    // Canola is not on that table. Falling through to 96 is right; falling
    // through to nothing, or to the shortest row, would not be.
    expect(
      effectiveReentryHours({
        reentryHours: 240,
        reentryFieldHours: 96,
        crop: 'CANOLA',
        cropIntervals: lorox,
      }),
    ).toBe(96)
  })

  it('falls back when the crop in the field is unknown', () => {
    expect(
      effectiveReentryHours({
        reentryHours: 240,
        reentryFieldHours: 96,
        crop: null,
        cropIntervals: lorox,
      }),
    ).toBe(96)
  })

  it('never reads a sweet corn row as field corn', () => {
    // The row exists on the label and must not be reachable from silage corn.
    const withSweetCorn = [
      { crop: 'Sweet Corn', reentryHours: 480, reentryFieldHours: 480 },
      { crop: 'Corn', reentryHours: 24, reentryFieldHours: 24 },
    ]
    expect(
      effectiveReentryHours({
        reentryHours: 480,
        reentryFieldHours: 24,
        crop: 'CORN_WET',
        cropIntervals: withSweetCorn,
      }),
    ).toBe(24)
  })

  it('takes the longest when several rows match the one crop', () => {
    expect(
      effectiveReentryHours({
        reentryHours: 24,
        reentryFieldHours: 24,
        crop: 'CARROTS',
        cropIntervals: [
          { crop: 'Carrots', reentryHours: 48, reentryFieldHours: 48 },
          { crop: 'Carrots', reentryHours: 192, reentryFieldHours: 192 },
        ],
      }),
    ).toBe(192)
  })

  it('ignores a matched row that states no interval at all', () => {
    expect(
      effectiveReentryHours({
        reentryHours: 240,
        reentryFieldHours: 96,
        crop: 'CARROTS',
        cropIntervals: [{ crop: 'Carrots', reentryHours: null, reentryFieldHours: null }],
      }),
    ).toBe(96)
  })

  it('drives the actual verdict, not just the number', () => {
    // Sprayed on carrots 5 days ago. Under the potato figure (4 days) this
    // field would read clear; under the carrot figure (8 days) it is not.
    const s = statusFor(
      {
        appliedAt: '2026-08-28T06:00:00',
        reentryHours: 240,
        reentryFieldHours: 96,
        crop: 'CARROTS',
        cropIntervals: lorox,
      },
      new Date('2026-09-02T12:00:00'),
    )
    expect(s.state).toBe('restricted')
  })
})
