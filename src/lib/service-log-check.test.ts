import { describe, expect, it } from 'vitest'
import { serviceLogProblem, type ServiceLogCheck } from './service-log-check'

const base: ServiceLogCheck = {
  doneOn: '2026-11-18',
  engineHours: 2150,
  cost: 120,
  today: '2026-11-18',
  meterHours: 2148,
  meterOn: '2026-11-16',
  others: [],
}

describe('serviceLogProblem', () => {
  it('passes a sensible service', () => {
    expect(serviceLogProblem(base)).toBeNull()
  })

  it('refuses a date in the future, with a day of grace', () => {
    expect(serviceLogProblem({ ...base, doneOn: '2027-06-01' })).toMatch(/in the future/)
    expect(serviceLogProblem({ ...base, doneOn: '2026-11-19' })).toBeNull()
    expect(serviceLogProblem({ ...base, doneOn: '2026-11-20' })).toMatch(/in the future/)
  })

  it('refuses negatives', () => {
    expect(serviceLogProblem({ ...base, cost: -5 })).toBe('A service cost cannot be negative.')
    expect(serviceLogProblem({ ...base, engineHours: -1 })).toBe('Engine hours cannot be negative.')
  })

  it('refuses hours below the meter on or after the day it was read', () => {
    expect(serviceLogProblem({ ...base, engineHours: 900 })).toMatch(/meter read 2,148 h/)
    expect(serviceLogProblem({ ...base, engineHours: 900, doneOn: '2026-11-16' })).toMatch(/meter read/)
  })

  it('takes a lower reading dated before the meter was read as history', () => {
    expect(serviceLogProblem({ ...base, engineHours: 900, doneOn: '2025-04-10' })).toBeNull()
  })

  it('treats a meter with no reading date as read today', () => {
    expect(serviceLogProblem({ ...base, engineHours: 900, meterOn: null })).toMatch(/meter read/)
    expect(serviceLogProblem({ ...base, engineHours: 900, meterOn: null, doneOn: '2026-10-01' })).toBeNull()
  })

  it('refuses hours below a service logged on an earlier day', () => {
    const others = [
      { done_on: '2025-06-01', engine_hours: 1500 },
      { done_on: '2026-03-01', engine_hours: 1800 },
    ]
    expect(serviceLogProblem({ ...base, doneOn: '2026-05-01', engineHours: 1700, others })).toMatch(/already at 1,800 h/)
    expect(serviceLogProblem({ ...base, doneOn: '2026-05-01', engineHours: 1900, others })).toBeNull()
    // Before both: nothing to compare against.
    expect(serviceLogProblem({ ...base, doneOn: '2025-01-01', engineHours: 1000, others })).toBeNull()
  })

  it('has nothing to say about hours left blank', () => {
    expect(serviceLogProblem({ ...base, engineHours: null })).toBeNull()
  })
})
