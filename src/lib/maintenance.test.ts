import { describe, expect, it } from 'vitest'
import { dueLabel, dueRank, dueState, type ServicePlan } from './maintenance'

const plan = (over: Partial<ServicePlan> = {}): ServicePlan => ({
  id: 'p',
  name: 'Engine oil',
  interval_hours: 500,
  interval_months: null,
  last_done_hours: 2000,
  last_done_on: null,
  warn_within_hours: 50,
  ...over,
})

const NOW = new Date('2026-08-11T12:00:00Z')

describe('dueState by hours', () => {
  it('is fine well before the interval', () => {
    const d = dueState(plan(), 2200, NOW)
    expect(d.state).toBe('ok')
    expect(d.hoursRemaining).toBe(300)
  })

  it('warns inside the warning window', () => {
    expect(dueState(plan(), 2470, NOW).state).toBe('due-soon')
  })

  it('is overdue at and past the interval', () => {
    expect(dueState(plan(), 2500, NOW).state).toBe('overdue')
    expect(dueState(plan(), 2600, NOW).hoursRemaining).toBe(-100)
  })

  // A machine with no modem reports nothing. Calling that "ok" would be a guess
  // in the direction that skips a service.
  it('cannot tell without engine hours', () => {
    const d = dueState(plan(), null, NOW)
    expect(d.state).toBe('unknown')
    expect(d.reason).toMatch(/does not report engine hours/)
  })

  it('cannot tell before a service has been logged', () => {
    const d = dueState(plan({ last_done_hours: null }), 2200, NOW)
    expect(d.state).toBe('unknown')
    expect(d.reason).toMatch(/nothing to measure from/)
  })
})

describe('dueState by time', () => {
  const yearly = plan({ interval_hours: null, interval_months: 12, last_done_hours: null })

  it('is fine early in the year', () => {
    expect(dueState({ ...yearly, last_done_on: '2026-06-01' }, null, NOW).state).toBe('ok')
  })

  it('warns within a month of the date', () => {
    expect(dueState({ ...yearly, last_done_on: '2025-09-01' }, null, NOW).state).toBe('due-soon')
  })

  it('is overdue past the date', () => {
    const d = dueState({ ...yearly, last_done_on: '2025-06-01' }, null, NOW)
    expect(d.state).toBe('overdue')
    expect(d.daysRemaining).toBeLessThan(0)
  })
})

// "500 hours or once a year, whichever comes first" is how these actually read.
// Honouring one half only is wrong in a way nobody notices until the oil is a
// season old.
describe('dueState with both intervals', () => {
  const both = plan({ interval_months: 12, last_done_on: '2026-07-01' })

  it('is overdue on hours even when the date is fine', () => {
    expect(dueState(both, 2600, NOW).state).toBe('overdue')
  })

  it('is overdue on the date even when hours are fine', () => {
    const stale = { ...both, last_done_on: '2025-01-01' }
    const d = dueState(stale, 2100, NOW)
    expect(d.state).toBe('overdue')
    expect(d.reason).toMatch(/time interval/)
  })

  it('reports both halves when neither is due', () => {
    const d = dueState(both, 2100, NOW)
    expect(d.state).toBe('ok')
    expect(d.hoursRemaining).toBe(400)
    expect(d.daysRemaining).toBeGreaterThan(0)
  })

  // One half measurable and the other not is still an answer.
  it('uses the hours half when the date half has no baseline', () => {
    const d = dueState({ ...both, last_done_on: null }, 2600, NOW)
    expect(d.state).toBe('overdue')
    expect(d.daysRemaining).toBeNull()
  })
})

describe('dueLabel', () => {
  it('says how long is left', () => {
    expect(dueLabel(dueState(plan(), 2200, NOW))).toBe('in 300 h')
  })

  it('says how far past due', () => {
    expect(dueLabel(dueState(plan(), 2600, NOW))).toMatch(/100 h past due/)
  })

  it('admits when it cannot tell', () => {
    expect(dueLabel(dueState(plan(), null, NOW))).toBe('cannot tell')
  })
})

describe('dueRank', () => {
  it('puts what needs doing first, and unknown above fine', () => {
    const order = (['ok', 'unknown', 'overdue', 'due-soon'] as const)
      .slice()
      .sort((a, b) => dueRank(a) - dueRank(b))
    expect(order).toEqual(['overdue', 'due-soon', 'unknown', 'ok'])
  })
})
