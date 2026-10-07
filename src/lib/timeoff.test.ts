import { describe, expect, it } from 'vitest'
import { awayThisWeek, daysOff, timeOffLabel, type TimeOff } from './timeoff'

const off = (p: Partial<TimeOff>): TimeOff => ({
  uid: Math.random().toString(),
  who: 'Kyle Parker',
  kind: 'Paid Time Off',
  summary: '',
  reason: null,
  starts_on: '2026-10-19',
  ends_on: '2026-10-21',
  hours: null,
  ...p,
})

describe('daysOff', () => {
  it('lists every day up to but not including the end', () => {
    expect(daysOff(off({}))).toEqual(['2026-10-19', '2026-10-20'])
  })
})

describe('awayThisWeek', () => {
  it('names the days inside the week, and counts a request that started last week', () => {
    const rows = awayThisWeek(
      [
        off({}),
        off({ who: 'Douglas Olsen', starts_on: '2026-10-15', ends_on: '2026-10-20' }),
        off({ who: 'Luke Hansen', starts_on: '2026-10-26', ends_on: '2026-10-27' }),
      ],
      '2026-10-19',
    )
    expect(rows.map((r) => `${r.who}: ${r.when}`)).toEqual(['Douglas Olsen: Mon', 'Kyle Parker: Mon–Tue'])
  })

  it('says all week when it is', () => {
    expect(awayThisWeek([off({ starts_on: '2026-10-19', ends_on: '2026-10-26' })], '2026-10-19')[0].when).toBe('all week')
  })
})

describe('timeOffLabel', () => {
  it('mentions hours only when it is a part day, and the kind only when it is not ordinary paid leave', () => {
    expect(timeOffLabel(off({}))).toBe('Kyle Parker off')
    expect(timeOffLabel(off({ hours: 2 }))).toBe('Kyle Parker off · 2 h')
    expect(timeOffLabel(off({ kind: 'Unpaid Time Off' }))).toBe('Kyle Parker off · unpaid time off')
  })
})
