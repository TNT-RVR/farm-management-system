import { describe, expect, it } from 'vitest'
import { endSeriesBefore, expandOccurrences } from './recur'
import { eventFormProblem, categoryLabel, EVENT_CATEGORIES } from './events'
import { contactProblem } from './contact-check'
import { contactListRows } from './reports/lists'
import { grantFigureProblem } from './grant-kit'
import { cents } from './reports/gas'
import { dbErrorMessage } from './db-error'

describe('calendar: delete this one and the ones after', () => {
  const start = new Date('2026-11-18T15:00:00Z') // a Wednesday, 9 a.m. in Alberta
  const windowStart = new Date('2026-11-01T00:00:00Z')
  const windowEnd = new Date('2026-12-31T00:00:00Z')

  it('keeps the occurrences before the one picked and none after', () => {
    const occ = new Date('2026-12-02T15:00:00Z')
    const rule = endSeriesBefore('FREQ=WEEKLY', start, occ)!
    const days = expandOccurrences(start, rule, windowStart, windowEnd).map((d) => d.toISOString().slice(0, 10))
    expect(days).toEqual(['2026-11-18', '2026-11-25'])
  })

  it('works for an evening event, whose UTC date is the next day', () => {
    const evening = new Date('2026-11-19T02:00:00Z') // 7 p.m. on the 18th in Alberta
    const occ = new Date('2026-11-21T02:00:00Z')
    const rule = endSeriesBefore('FREQ=DAILY', evening, occ)!
    expect(expandOccurrences(evening, rule, windowStart, windowEnd)).toHaveLength(2)
  })

  it('replaces any COUNT or UNTIL already there', () => {
    const rule = endSeriesBefore('FREQ=WEEKLY;COUNT=10;INTERVAL=2', start, new Date('2026-12-16T15:00:00Z'))!
    expect(rule).toBe('FREQ=WEEKLY;INTERVAL=2;UNTIL=20261215')
  })

  it('leaves nothing to keep when the first one is picked', () => {
    expect(endSeriesBefore('FREQ=WEEKLY', start, start)).toBeNull()
  })
})

describe('events: what stops a save', () => {
  const ok = { name: 'Field day', startsOn: '2026-12-10', endsOn: '2026-12-11', cost: '40' }
  it('passes a sound event', () => expect(eventFormProblem(ok)).toBeNull())
  it('wants a name', () => expect(eventFormProblem({ ...ok, name: ' ' })).toMatch(/name/))
  it('refuses an end before the start', () => expect(eventFormProblem({ ...ok, endsOn: '2026-12-05' })).toMatch(/ends before it starts/))
  it('refuses a negative cost', () => expect(eventFormProblem({ ...ok, cost: '-50' })).toMatch(/cannot be negative/))
  it('refuses a negative early-bird cost', () => expect(eventFormProblem({ ...ok, earlyCost: '-1' })).toMatch(/early-bird/))
  it('allows blanks', () => expect(eventFormProblem({ name: 'x', startsOn: '', endsOn: '', cost: '' })).toBeNull())
  it('labels every subject in words', () => {
    for (const c of EVENT_CATEGORIES) expect(categoryLabel(c)).not.toBe(c)
  })
})

describe('contacts', () => {
  it('wants a company or a name', () => {
    expect(contactProblem({ company: ' ', contact_name: null })).toMatch(/company or a name/)
    expect(contactProblem({ company: null, contact_name: 'Evelyn Miller' })).toBeNull()
  })
  it('checks each email given', () => {
    expect(contactProblem({ company: 'A', email: 'not an email' })).toMatch(/not an email/)
    expect(contactProblem({ company: 'A', email: 'a@b.example; c@d.example' })).toBeNull()
  })
  it('lists a contact with nothing to search on when there is no search', () => {
    const blank = { id: '1', company: null, contact_name: null, email: null, phone: null, tags: [], type: 'other' }
    const rows = contactListRows([blank] as never, { search: '', type: 'all' })
    expect(rows).toHaveLength(1)
    expect(contactListRows([blank] as never, { search: 'x', type: 'all' })).toHaveLength(0)
  })
})

describe('grants: the figures', () => {
  const g = { amount_min: 1000, amount_max: 15000 }
  it('refuses "from" over "up to", whichever box changed', () => {
    expect(grantFigureProblem(g, 'amount_min', 20000)).toMatch(/more than "up to"/)
    expect(grantFigureProblem(g, 'amount_max', 500)).toMatch(/less than "from"/)
  })
  it('keeps the share above 0 and at most 100', () => {
    expect(grantFigureProblem(g, 'cost_share_pct', 150)).toMatch(/at most 100/)
    expect(grantFigureProblem(g, 'cost_share_pct', 0)).toMatch(/more than 0/)
    expect(grantFigureProblem(g, 'cost_share_pct', 50)).toBeNull()
  })
  it('refuses a negative amount and allows a blank', () => {
    expect(grantFigureProblem(g, 'amount_max', -1)).toMatch(/negative/)
    expect(grantFigureProblem(g, 'amount_max', null)).toBeNull()
  })
  it('says the database rules in words', () => {
    expect(dbErrorMessage({ message: 'violates check constraint "grants_amount_order"' })).toMatch(/"from" amount/)
    expect(dbErrorMessage({ message: 'violates check constraint "contacts_has_a_name"' })).toMatch(/company or a name/)
    expect(dbErrorMessage({ message: 'violates check constraint "events_dates_order"' })).toMatch(/ends before/)
  })
})

describe('gas report: Other', () => {
  it('rounds a leftover speck to a plain zero, never -0', () => {
    expect(Object.is(cents(-0.0000001), 0)).toBe(true)
    expect(cents(12.345)).toBe(12.35)
  })
})
