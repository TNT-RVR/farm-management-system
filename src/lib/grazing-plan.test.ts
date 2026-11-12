import { describe, expect, it } from 'vitest'
import {
  addDays,
  auDays,
  aumsFromAuDays,
  cascadeFrom,
  daysBetween,
  estimateDays,
  eventsToStays,
  gateNotes,
  hasGaps,
  leaseUse,
  nextStart,
  pairKey,
  restIssues,
  unionDays,
  type CountedStay,
  type LeaseLimit,
} from './grazing-plan'

describe('dates', () => {
  it('adds days across month ends and DST', () => {
    expect(addDays('2027-02-27', 2)).toBe('2027-03-01')
    expect(addDays('2027-03-13', 1)).toBe('2027-03-14')
    expect(addDays('2027-11-06', 1)).toBe('2027-11-07')
    expect(daysBetween('2027-05-01', '2027-06-01')).toBe(31)
    expect(daysBetween('2027-06-01', '2027-05-01')).toBe(-31)
  })
})

describe('estimateDays', () => {
  it('divides the grass by the group, rounding down', () => {
    // 10,000 AUDs for 277 cows at 1.4 AU = 387.8 AU/day -> 25.8 days
    expect(estimateDays(10_000, 277 * 1.4)).toBe(25)
  })
  it('is at least one day and null with nothing to divide by', () => {
    expect(estimateDays(0, 100)).toBe(1)
    expect(estimateDays(-50, 100)).toBe(1)
    expect(estimateDays(1000, 0)).toBeNull()
  })
})

describe('cascade', () => {
  const steps = [
    { id: 'a', start_date: '2027-05-01', end_date: '2027-05-20' },
    { id: 'b', start_date: '2027-05-20', end_date: '2027-06-10' },
    { id: 'c', start_date: '2027-06-10', end_date: '2027-06-15' },
  ]
  it('starts the next stay on the last end, or turnout', () => {
    expect(nextStart(steps, '2027-04-01')).toBe('2027-06-15')
    expect(nextStart([], '2027-04-01')).toBe('2027-04-01')
  })
  it('shifts later stays and keeps their lengths', () => {
    const edited = steps.map((s) => (s.id === 'a' ? { ...s, end_date: '2027-05-25' } : s))
    expect(hasGaps(edited)).toBe(true)
    const out = cascadeFrom(edited, 0)
    expect(out.map((s) => [s.start_date, s.end_date])).toEqual([
      ['2027-05-01', '2027-05-25'],
      ['2027-05-25', '2027-06-15'],
      ['2027-06-15', '2027-06-20'],
    ])
    expect(hasGaps(out)).toBe(false)
    // the input is untouched
    expect(edited[1].start_date).toBe('2027-05-20')
  })
  it('leaves stays up to the edited one alone', () => {
    const edited = steps.map((s) => (s.id === 'b' ? { ...s, end_date: '2027-06-01' } : s))
    const out = cascadeFrom(edited, 1)
    expect(out[0]).toEqual(steps[0])
    expect(out[2]).toMatchObject({ start_date: '2027-06-01', end_date: '2027-06-06' })
  })
})

describe('restIssues', () => {
  const rest = () => 21
  it('warns when a pasture is re-entered before its rest is up', () => {
    const issues = restIssues(
      [
        { pasture_id: 'D', start_date: '2027-05-01', end_date: '2027-05-20' },
        { pasture_id: 'F', start_date: '2027-05-20', end_date: '2027-06-01' },
        { pasture_id: 'D', start_date: '2027-06-01', end_date: '2027-06-10' },
      ],
      rest,
    )
    expect(issues).toEqual([
      { pasture_id: 'D', left_on: '2027-05-20', back_on: '2027-06-01', rest_days: 12, min_rest_days: 21 },
    ])
  })
  it('treats two groups together, or back to back, as one stay', () => {
    expect(
      restIssues(
        [
          { pasture_id: 'D', start_date: '2027-05-01', end_date: '2027-05-20' },
          { pasture_id: 'D', start_date: '2027-05-10', end_date: '2027-05-25' },
          { pasture_id: 'D', start_date: '2027-05-25', end_date: '2027-05-30' },
          { pasture_id: 'D', start_date: '2027-07-01', end_date: '2027-07-10' },
        ],
        rest,
      ),
    ).toEqual([])
  })
  it('skips pastures with no rest set', () => {
    expect(
      restIssues(
        [
          { pasture_id: 'D', start_date: '2027-05-01', end_date: '2027-05-02' },
          { pasture_id: 'D', start_date: '2027-05-03', end_date: '2027-05-04' },
        ],
        () => null,
      ),
    ).toEqual([])
  })
})

describe('leaseUse', () => {
  const lease: LeaseLimit = {
    id: 'l',
    disposition_no: 'GRL-20006',
    pasture_ids: ['L1', 'L2'],
    max_grazing_days: 60,
    capacity_aum: 58,
    billable_aum: 58,
    season_start_md: '05-15',
    season_end_md: '09-30',
  }
  const stay = (p: string, s: string, e: string, head = 100, au = 1): CountedStay => ({
    pasture_id: p,
    start_date: s,
    end_date: e,
    head,
    au_per_head: au,
  })
  it('counts days once when two groups share the lease', () => {
    const u = leaseUse(
      lease,
      [stay('L1', '2027-06-01', '2027-07-01'), stay('L2', '2027-06-15', '2027-07-20', 10), stay('X', '2027-01-01', '2027-12-01')],
      2027,
    )
    expect(u.days).toBe(49)
    expect(u.remaining_days).toBe(11)
    expect(u.over_days).toBe(false)
    // 100×30 + 10×35 = 3350 AUD / 30.4
    expect(u.aums).toBeCloseTo(3350 / 30.4, 6)
    expect(u.over_aums).toBe(true)
    expect(u.stays).toHaveLength(2)
  })
  it('flags days over the limit and stays outside the season', () => {
    const u = leaseUse(lease, [stay('L1', '2027-05-01', '2027-07-12', 1)], 2027)
    expect(u.days).toBe(72)
    expect(u.over_days).toBe(true)
    expect(u.remaining_days).toBe(-12)
    expect(u.outside_season).toHaveLength(1)
  })
  it('has no remaining days without a limit', () => {
    const u = leaseUse({ ...lease, max_grazing_days: null, capacity_aum: null, billable_aum: null }, [], 2027)
    expect(u.remaining_days).toBeNull()
    expect(u.over_aums).toBe(false)
  })
})

describe('gateNotes', () => {
  it('notes moves with no gate, telling neighbours from far pastures', () => {
    const gates = new Set([pairKey('D', 'E')])
    const neighbours = new Set([pairKey('D', 'E'), pairKey('E', 'F')])
    expect(gateNotes(['D', 'E', 'F', 'F', 'K'], gates, neighbours)).toEqual([
      { kind: 'no-gate', from: 'E', to: 'F', index: 2 },
      { kind: 'not-touching', from: 'F', to: 'K', index: 4 },
    ])
  })
  it('keys a pair the same either way round', () => {
    expect(pairKey('b', 'a')).toBe(pairKey('a', 'b'))
  })
})

describe('sums', () => {
  it('works out AUDs, AUMs and covered days', () => {
    expect(auDays(277, 1.4, 30)).toBeCloseTo(11634)
    expect(aumsFromAuDays(304)).toBeCloseTo(10)
    expect(
      unionDays([
        { start_date: '2027-05-01', end_date: '2027-05-11' },
        { start_date: '2027-05-05', end_date: '2027-05-15' },
        { start_date: '2027-06-01', end_date: '2027-06-02' },
      ]),
    ).toBe(15)
  })
})

describe('eventsToStays', () => {
  it('joins the week-long collar rows into one stay per pasture visit', () => {
    const stays = eventsToStays([
      { pasture_id: 'G', turned_in_on: '2026-04-29', moved_out_on: '2026-05-06', head_count: 264 },
      { pasture_id: 'G', turned_in_on: '2026-04-29', moved_out_on: '2026-04-29', head_count: 262 },
      { pasture_id: 'G', turned_in_on: '2026-05-06', moved_out_on: '2026-05-27', head_count: 264 },
      { pasture_id: 'C', turned_in_on: '2026-05-30', moved_out_on: '2026-07-06', head_count: 290 },
      { pasture_id: 'N', turned_in_on: '2026-09-02', moved_out_on: null, head_count: 290 },
    ])
    expect(stays.map((s) => [s.pasture_id, s.start_date, s.end_date, s.head_count])).toEqual([
      ['G', '2026-04-29', '2026-05-27', 264],
      ['C', '2026-05-30', '2026-07-06', 290],
      ['N', '2026-09-02', '2026-09-02', 290],
    ])
  })
})
