import { describe, expect, it } from 'vitest'
import { addMonths, dueLabel, dueRank, dueState, nextDue, nextDueLabel, rollForward, serviceSummary, type ServicePlan } from './maintenance'

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

  // Two weeks by default: 21 days out is still fine, 10 days out warns.
  it('warns within two weeks of the date by default', () => {
    expect(dueState({ ...yearly, last_done_on: '2025-09-01' }, null, NOW).state).toBe('ok')
    expect(dueState({ ...yearly, last_done_on: '2025-08-21' }, null, NOW).state).toBe('due-soon')
  })

  it("honours a plan's own day margin", () => {
    expect(dueState({ ...yearly, last_done_on: '2025-09-01', warn_within_days: 30 }, null, NOW).state).toBe('due-soon')
    expect(dueState({ ...yearly, last_done_on: '2025-08-21', warn_within_days: 0 }, null, NOW).state).toBe('ok')
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

// Made-up machines and readings throughout.
describe('the hour warning margin', () => {
  const p = plan({ warn_within_hours: 25 })

  it('is fine just outside the margin and warns just inside it', () => {
    expect(dueState(p, 2474, NOW).state).toBe('ok') // 26 h to go
    expect(dueState(p, 2475, NOW).state).toBe('due-soon') // 25 h to go
  })

  it('with no margin goes straight from fine to overdue at the due point', () => {
    const none = plan({ warn_within_hours: 0 })
    expect(dueState(none, 2499, NOW).state).toBe('ok')
    expect(dueState(none, 2500, NOW).state).toBe('overdue')
  })
})

describe('addMonths', () => {
  it('adds whole months', () => {
    expect(addMonths('2026-03-15', 12)).toBe('2027-03-15')
    expect(addMonths('2026-11-10', 3)).toBe('2027-02-10')
  })

  // Date#setMonth would give 3 March and push a monthly job a month late.
  it('stays inside a shorter month', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonths('2027-01-31', 13)).toBe('2028-02-29')
    expect(addMonths('2026-08-31', 6)).toBe('2027-02-28')
  })
})

describe('nextDue', () => {
  it('is one interval on from the last service, on each half', () => {
    const both = plan({ interval_months: 12, last_done_on: '2026-05-04' })
    expect(nextDue(both)).toEqual({ hours: 2500, on: '2027-05-04' })
  })

  it('leaves a half without a baseline unknown', () => {
    expect(nextDue(plan({ last_done_hours: null }))).toEqual({ hours: null, on: null })
    expect(nextDue(plan({ interval_months: 6 }))).toEqual({ hours: 2500, on: null })
  })

  it('is carried on the due state and labelled', () => {
    const d = dueState(plan({ interval_months: 12, last_done_on: '2026-05-04' }), 2200, NOW)
    expect(d.nextDueHours).toBe(2500)
    expect(d.nextDueOn).toBe('2027-05-04')
    expect(nextDueLabel(d)).toMatch(/^at 2,500 h · /)
    expect(nextDueLabel({ nextDueHours: null, nextDueOn: null })).toBeNull()
  })
})

describe('rollForward', () => {
  const both = plan({ interval_months: 12, last_done_on: '2025-06-01' })

  it('moves the next due point one interval on from when it was done', () => {
    const done = rollForward(both, '2026-08-11', 2540)
    expect(nextDue(done)).toEqual({ hours: 3040, on: '2027-08-11' })
    expect(dueState(done, 2540, NOW).state).toBe('ok')
  })

  // A late service measured from where it was due would come round early.
  it('measures from the hours it was done at, not the hours it was due at', () => {
    expect(nextDue(rollForward(both, '2026-08-11', 2600)).hours).toBe(3100)
  })

  it('keeps the hour baseline when the hours were not known', () => {
    const done = rollForward(both, '2026-08-11', null)
    expect(done.last_done_hours).toBe(2000)
    expect(done.last_done_on).toBe('2026-08-11')
  })

  it('clears an overdue plan', () => {
    expect(dueState(both, 2600, NOW).state).toBe('overdue')
    expect(dueState(rollForward(both, '2026-08-11', 2600), 2600, NOW).state).toBe('ok')
  })
})

describe('serviceSummary', () => {
  it('counts overdue and due-soon plans, ignoring fine and unknown', () => {
    const plans = [
      plan({ id: 'a' }), // due at 2500: 40 h to go, inside the 50 h margin
      plan({ id: 'b', last_done_hours: 2480 }), // due at 2980: fine
      plan({ id: 'c', last_done_hours: null }), // unknown
      plan({ id: 'd', last_done_hours: 1900 }), // due at 2400: overdue
    ]
    expect(serviceSummary(plans, 2460, NOW)).toEqual({ overdue: 1, dueSoon: 1 })
  })
})
