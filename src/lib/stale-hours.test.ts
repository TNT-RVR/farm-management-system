import { describe, expect, it } from 'vitest'
import { hoursStaleSince, staleHoursLabel, staleHoursMachines, type HoursRow } from './stale-hours'

const now = Date.parse('2026-10-16T12:00:00Z')
const m = (id: string, at: string | null, extra: Partial<HoursRow> = {}): HoursRow => ({
  id,
  engine_hours: at ? 100 : null,
  engine_hours_at: at,
  archived: false,
  is_manual: false,
  ...extra,
})

describe('stale engine hours', () => {
  it('flags a machine read over 30 days ago while another reports', () => {
    const fleet = [m('a', '2026-10-15T08:00:00Z'), m('b', '2026-07-02T23:00:00Z'), m('c', '2026-09-20T08:00:00Z')]
    expect([...staleHoursMachines(fleet, now).keys()]).toEqual(['b'])
    expect(hoursStaleSince(fleet[1], fleet, now)).toBe('2026-07-02T23:00:00Z')
    expect(hoursStaleSince(fleet[2], fleet, now)).toBeNull()
  })

  it('treats exactly 30 days as still fresh', () => {
    const fleet = [m('a', '2026-10-15T08:00:00Z'), m('b', '2026-09-16T12:00:00Z')]
    expect(staleHoursMachines(fleet, now).size).toBe(0)
  })

  it('flags no one when every machine has gone quiet', () => {
    const fleet = [m('a', '2026-08-01T08:00:00Z'), m('b', '2026-07-02T08:00:00Z')]
    expect(staleHoursMachines(fleet, now).size).toBe(0)
  })

  it('skips machines that never reported, archived ones and ones added by hand', () => {
    const fleet = [
      m('fresh', '2026-10-15T08:00:00Z'),
      m('never', null),
      m('sold', '2026-01-01T08:00:00Z', { archived: true }),
      m('hand', '2026-01-01T08:00:00Z', { is_manual: true }),
    ]
    expect(staleHoursMachines(fleet, now).size).toBe(0)
  })

  it('does not count an archived or hand-added machine as the one still reporting', () => {
    const fleet = [
      m('old', '2026-07-01T08:00:00Z'),
      m('sold', '2026-10-15T08:00:00Z', { archived: true }),
      m('hand', '2026-10-15T08:00:00Z', { is_manual: true }),
    ]
    expect(staleHoursMachines(fleet, now).size).toBe(0)
  })

  it('judges a machine missing from the list against the rest', () => {
    const fleet = [m('a', '2026-10-15T08:00:00Z')]
    expect(hoursStaleSince(m('x', '2026-07-01T08:00:00Z'), fleet, now)).toBe('2026-07-01T08:00:00Z')
  })

  it('reads the date in farm time', () => {
    expect(staleHoursLabel('2026-07-03T03:00:00Z')).toBe('hours not updating since Jul 2, 2026')
  })
})
