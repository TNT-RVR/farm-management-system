import { describe, expect, it } from 'vitest'
import { daysUntil, warrantyStatus } from './warranty'

/** The only fields the calculation reads, so a test row stays readable. */
const eq = (o: Partial<Parameters<typeof warrantyStatus>[0]>) => ({
  warranty_expires_on: null,
  warranty_hours: null,
  engine_hours: null,
  ...o,
})

const TODAY = new Date(2026, 8, 15) // 15 Sep 2026, local

describe('daysUntil', () => {
  it('counts whole local days', () => {
    expect(daysUntil('2026-09-15', TODAY)).toBe(0)
    expect(daysUntil('2026-09-16', TODAY)).toBe(1)
    expect(daysUntil('2026-09-01', TODAY)).toBe(-14)
  })

  it('does not lose a day to the spring time change', () => {
    // 8 March 2026 is the Sunday clocks go forward in Alberta. A naive
    // millisecond division across it returns 89.96 days and floors to 89.
    expect(daysUntil('2026-06-01', new Date(2026, 2, 1))).toBe(92)
  })
})

describe('warrantyStatus', () => {
  it('reports unknown when nothing has been recorded', () => {
    const w = warrantyStatus(eq({}), TODAY)
    expect(w.state).toBe('unknown')
    expect(w.label).toBeNull()
  })

  it('does not call an unrecorded warranty expired', () => {
    // The machine has 4,000 hours on it and no term recorded anywhere. Saying
    // "expired" here is how a real claim gets missed.
    expect(warrantyStatus(eq({ engine_hours: 4000 }), TODAY).state).toBe('unknown')
  })

  it('counts down the date', () => {
    const w = warrantyStatus(eq({ warranty_expires_on: '2027-09-15' }), TODAY)
    expect(w.state).toBe('ok')
    expect(w.daysLeft).toBe(365)
    expect(w.label).toBe('warranty ends in 1 year')
  })

  it('warns inside ninety days', () => {
    const w = warrantyStatus(eq({ warranty_expires_on: '2026-11-01' }), TODAY)
    expect(w.state).toBe('soon')
    expect(w.label).toBe('warranty ends in 2 months')
  })

  it('runs out on hours while the calendar still has years on it', () => {
    // The case that makes two clocks necessary: 2029 on paper, but the combine
    // has eaten the 3,000 hours.
    const w = warrantyStatus(
      eq({ warranty_expires_on: '2029-09-15', warranty_hours: 3000, engine_hours: 2940 }),
      TODAY,
    )
    expect(w.state).toBe('soon')
    expect(w.limitedBy).toBe('hours')
    expect(w.hoursLeft).toBe(60)
    expect(w.label).toBe('60 hours of warranty left')
  })

  it('says which clock ran out', () => {
    expect(
      warrantyStatus(
        eq({ warranty_expires_on: '2029-09-15', warranty_hours: 3000, engine_hours: 3120 }),
        TODAY,
      ).label,
    ).toBe('over by 120 hours')
    expect(warrantyStatus(eq({ warranty_expires_on: '2025-09-15' }), TODAY).label).toBe(
      'expired 1 year ago',
    )
  })

  it('needs a reading before an hour limit means anything', () => {
    // A limit with no engine-hour reading is not "0 hours left".
    const w = warrantyStatus(eq({ warranty_expires_on: '2028-01-01', warranty_hours: 2000 }), TODAY)
    expect(w.hoursLeft).toBeNull()
    expect(w.state).toBe('ok')
  })

  it('ends today rather than in 0 days', () => {
    expect(warrantyStatus(eq({ warranty_expires_on: '2026-09-15' }), TODAY).label).toBe(
      'warranty ends today',
    )
  })
})
