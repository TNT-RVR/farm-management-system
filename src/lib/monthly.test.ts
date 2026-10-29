import { describe, expect, it } from 'vitest'
import { closedByMonth, copyResult, dueKey, inWindow, jobWhen, monthlyLists, outstanding, personCounts, taskLoad, tasksByCopy, windowLabel, windowOf, ym, type CopyLite, type JobLite } from './monthly'
import { monthlyYearReport } from './reports/monthly-jobs'

const job = (id: string, start_month: number, end_month: number, recurrence: JobLite['recurrence'] = 'annual', extra: Partial<JobLite> = {}): JobLite => ({
  id,
  title: id,
  start_month,
  end_month,
  recurrence,
  active: true,
  sort_order: 0,
  ...extra,
})
const copy = (id: string, template_id: string, year: number, month: number, state: CopyLite['state'] = 'todo', completed_by: string | null = null): CopyLite & { skip_note: string | null } => ({
  id,
  template_id,
  year,
  month,
  state,
  completed_by,
  completed_at: state === 'todo' ? null : `${year}-${String(month).padStart(2, '0')}-15T12:00:00Z`,
  skip_note: state === 'skipped' ? 'not needed' : null,
})

describe('windows', () => {
  it('wraps Dec→Jan', () => {
    expect(inWindow(1, 11, 2)).toBe(true)
    expect(inWindow(12, 11, 2)).toBe(true)
    expect(inWindow(3, 11, 2)).toBe(false)
    expect(inWindow(5, 4, 6)).toBe(true)
    expect(inWindow(7, 4, 6)).toBe(false)
  })

  it('keys once-in-window jobs to the window start, every-month jobs to the month', () => {
    const winter = job('w', 11, 2)
    expect(dueKey(winter, 2027, 1)).toEqual({ year: 2026, month: 11 })
    expect(dueKey(winter, 2026, 12)).toEqual({ year: 2026, month: 11 })
    expect(dueKey(winter, 2027, 3)).toBeNull()
    const temps = job('t', 11, 2, 'multi_per_year')
    expect(dueKey(temps, 2027, 1)).toEqual({ year: 2027, month: 1 })
    expect(dueKey(job('o', 9, 11, 'one_time'), 2026, 10)).toEqual({ year: 2026, month: 9 })
  })

  it('spans the window across New Year', () => {
    const winter = job('w', 11, 2)
    expect(windowOf({ year: 2026, month: 11 }, winter)).toEqual({ start: ym(2026, 11), end: ym(2027, 2) })
    expect(windowLabel({ year: 2026, month: 11 }, winter)).toBe('Nov 2026–Feb 2027')
    expect(windowLabel({ year: 2026, month: 9 }, job('f', 9, 11))).toBe('Sep–Nov')
    expect(windowLabel({ year: 2026, month: 12 }, job('t', 11, 2, 'multi_per_year'), true)).toBe('Dec 2026')
    expect(jobWhen(job('t', 11, 2, 'multi_per_year'))).toBe('Every month, Nov–Feb')
    expect(jobWhen(job('f', 9, 11))).toBe('Once, Sep–Nov')
    expect(jobWhen(job('o', 10, 10))).toBe('Oct')
  })
})

describe('the To do list', () => {
  const now = ym(2026, 10)
  const jobs = [job('fall', 9, 11), job('oct', 10, 10), job('aug', 8, 8), job('temps', 1, 12, 'multi_per_year'), job('off', 10, 10, 'annual', { active: false }), job('nov', 11, 11)]
  const copies = [
    copy('fall26', 'fall', 2026, 9),
    copy('oct26', 'oct', 2026, 10, 'done', 'u1'),
    copy('oct25', 'oct', 2025, 10),
    copy('aug26', 'aug', 2026, 8),
    copy('aug25', 'aug', 2025, 8),
    copy('temps9', 'temps', 2026, 9),
    copy('temps10', 'temps', 2026, 10),
    copy('off26', 'off', 2026, 10),
    copy('nov26', 'nov', 2026, 11),
  ]
  const lists = monthlyLists(jobs, copies, now)

  it('puts leftovers first: ended, still to do, not yet come round again', () => {
    // aug26 is a leftover; aug25 is superseded by it; oct25 by this year's
    // October copy (the 11-month reset); temps9 by temps10.
    expect(lists.leftovers.map((i) => i.copy.id)).toEqual(['aug26'])
  })

  it('keeps done copies on this month, and leaves switched-off jobs out', () => {
    expect(lists.thisMonth.map((i) => i.copy.id).sort()).toEqual(['fall26', 'oct26', 'temps10'])
  })

  it('shows next month without repeating what is already showing', () => {
    expect(lists.nextMonth.map((i) => i.copy.id)).toEqual(['nov26'])
  })

  it('counts outstanding work for the meeting', () => {
    expect(outstanding(lists, false).map((i) => i.copy.id)).toEqual(['aug26', 'fall26', 'temps10'])
    expect(outstanding(lists, true).map((i) => i.copy.id)).toContain('nov26')
  })

  it('drops a leftover after a year even when the job has no newer copy', () => {
    const l = monthlyLists([job('x', 9, 9)], [copy('x', 'x', 2025, 9)], ym(2026, 10))
    expect(l.leftovers).toEqual([])
  })

  it('carries December into January', () => {
    const l = monthlyLists([job('d', 12, 12)], [copy('d', 'd', 2026, 12)], ym(2027, 1))
    expect(l.leftovers.map((i) => i.copy.id)).toEqual(['d'])
  })
})

describe('completed and counts', () => {
  const jobs = [job('a', 9, 9), job('b', 10, 10), job('c', 3, 3)]
  const copies = [copy('a', 'a', 2026, 9, 'done', 'u1'), copy('b', 'b', 2026, 10, 'skipped', 'u2'), copy('c', 'c', 2026, 3), copy('b5', 'b', 2025, 10, 'done', 'u2')]

  it('groups the year by month, newest first', () => {
    expect(closedByMonth(jobs, copies, 2026).map((g) => [g.month, g.items.map((i) => i.copy.id)])).toEqual([
      [10, ['b']],
      [9, ['a']],
    ])
  })

  it('ranks people by jobs done, skips apart', () => {
    expect(personCounts([...copies, copy('z', 'a', 2026, 9, 'done', 'u2'), copy('y', 'a', 2026, 9, 'done', 'u2')])).toEqual([
      { userId: 'u2', done: 3, skipped: 1 },
      { userId: 'u1', done: 1, skipped: 0 },
    ])
  })

  it('calls a to-do copy missed only once its window is over', () => {
    expect(copyResult({ state: 'todo' }, ym(2026, 3), ym(2026, 10))).toBe('missed')
    expect(copyResult({ state: 'todo' }, ym(2026, 11), ym(2026, 10))).toBe('open')
  })

  it('builds the year report', () => {
    const r = monthlyYearReport(jobs, copies, new Map([['u1', 'Dean'], ['u2', 'Kurt']]), 2026, ym(2026, 10))
    expect(r.meta).toEqual([
      ['Jobs due', 3],
      ['Done', 1],
      ['Skipped', 1],
      ['Missed', 1],
      ['Still open', 0],
    ])
    expect(r.sections[0].rows.map((x) => [x[0], x[2], x[3]])).toEqual([
      ['a', 'Done', 'Dean'],
      ['b', 'Skipped', 'Kurt'],
      ['c', 'Missed', null],
    ])
    expect(r.sections[1].rows).toEqual([
      ['Dean', 1, 0, '100%'],
      ['Kurt', 0, 1, '0%'],
    ])
  })
})

describe('tasks', () => {
  const t = (id: string, assignee_ids: string[], status = 'open', due_at: string | null = null, source_ref: string | null = null) => ({ id, assignee_ids, status, due_at, source: source_ref ? 'monthly' : 'manual', source_ref })

  it('finds the tasks handed out for a copy', () => {
    const m = tasksByCopy([t('1', ['u1'], 'open', null, 'c1'), t('2', ['u2'], 'done', null, 'c1'), t('3', ['u3'])])
    expect(m.get('c1')?.map((x) => x.id)).toEqual(['1', '2'])
    expect(m.size).toBe(1)
  })

  it('counts open and overdue work per person', () => {
    const now = new Date('2026-10-24T12:00:00Z')
    const rows = taskLoad([t('1', ['u1', 'u2'], 'open', '2026-10-01T00:00:00Z'), t('2', ['u1'], 'open', '2026-11-01T00:00:00Z'), t('3', ['u1'], 'done'), t('4', ['gone'])], ['u1', 'u2', 'u3'], now)
    expect(rows).toEqual([
      { userId: 'u1', open: 2, overdue: 1 },
      { userId: 'u2', open: 1, overdue: 1 },
      { userId: 'u3', open: 0, overdue: 0 },
    ])
  })
})
