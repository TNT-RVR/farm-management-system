import { describe, expect, it } from 'vitest'
import {
  FARM_FACTS,
  TOPIC_LABEL,
  candidatesForWeek,
  factForWeek,
  unusedForMonth,
  weekIndex,
  type FarmFact,
} from './farm-facts'

describe('the fact library', () => {
  it('has a unique id for every fact', () => {
    // Ids are how a skip is remembered. Two facts sharing one is a fact that
    // can never be reached.
    const ids = FARM_FACTS.map((f) => f.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('gives every fact something to do about it', () => {
    // A fact nobody acts on is a quiz question, not an agenda item.
    for (const f of FARM_FACTS) {
      expect(f.soWhat.length, f.id).toBeGreaterThan(20)
      expect(f.body.length, f.id).toBeGreaterThan(80)
    }
  })

  it('uses months that exist', () => {
    for (const f of FARM_FACTS) {
      for (const m of f.months ?? []) {
        expect(m, f.id).toBeGreaterThanOrEqual(1)
        expect(m, f.id).toBeLessThanOrEqual(12)
      }
    }
  })

  it('labels every topic it uses', () => {
    for (const f of FARM_FACTS) expect(TOPIC_LABEL[f.topic], f.id).toBeTruthy()
  })

  it('has something to say in every month of the year', () => {
    // A month with nothing seasonal falls back to the whole list, so this
    // cannot fail today — but it would catch a later change that made the
    // seasonal filter strict.
    for (let m = 1; m <= 12; m++) {
      expect(factForWeek(new Date(2026, m - 1, 15)), `month ${m}`).not.toBeNull()
    }
  })
})

describe('weekIndex', () => {
  it('advances by exactly one each Monday', () => {
    // 14 Sep 2026 is a Monday.
    const monday = new Date(2026, 8, 14)
    const nextMonday = new Date(2026, 8, 21)
    expect(weekIndex(nextMonday) - weekIndex(monday)).toBe(1)
  })

  it('does not change during the week', () => {
    // Everybody in the meeting sees the same fact, and it does not change while
    // the page is open on Wednesday.
    const monday = weekIndex(new Date(2026, 8, 14))
    for (const d of [15, 16, 17, 18, 19, 20]) {
      expect(weekIndex(new Date(2026, 8, d))).toBe(monday)
    }
  })

  it('does not reset at the new year', () => {
    // A week-of-year number repeats and has 52 or 53 of them, which would make
    // the rotation jump every January.
    const dec = weekIndex(new Date(2026, 11, 28))
    const jan = weekIndex(new Date(2027, 0, 4))
    expect(jan - dec).toBe(1)
  })
})

describe('factForWeek', () => {
  const facts: FarmFact[] = [
    { id: 'a', topic: 'cattle', title: 'A', body: 'x', soWhat: 'y' },
    { id: 'b', topic: 'cattle', title: 'B', body: 'x', soWhat: 'y' },
    { id: 'harvest', topic: 'canola', title: 'H', body: 'x', soWhat: 'y', months: [9] },
  ]

  it('puts the season first', () => {
    const september = new Date(2026, 8, 14)
    expect(candidatesForWeek(september, facts)[0].id).toBe('harvest')
  })

  it('leaves an out-of-season fact out altogether, not merely last', () => {
    // Swathing advice in February is the one thing the seasons exist to
    // prevent, so it must not be reachable by skipping either.
    const february = new Date(2026, 1, 9)
    expect(candidatesForWeek(february, facts).map((f) => f.id)).not.toContain('harvest')
  })

  it('offers the evergreen facts behind the seasonal ones', () => {
    const september = new Date(2026, 8, 14)
    expect(candidatesForWeek(september, facts).map((f) => f.id)).toEqual(['harvest', 'a', 'b'])
  })

  it('gives the same answer all week', () => {
    const mon = new Date(2026, 8, 14)
    const wed = new Date(2026, 8, 16)
    expect(factForWeek(mon, 0, facts)?.id).toBe(factForWeek(wed, 0, facts)?.id)
  })

  it('copes with an empty library rather than throwing', () => {
    expect(factForWeek(new Date(), 0, [])).toBeNull()
    expect(candidatesForWeek(new Date(), [])).toEqual([])
  })

  it('handles a negative skip', () => {
    expect(factForWeek(new Date(1970, 0, 5), -1, facts)).not.toBeNull()
  })
})

describe('unusedForMonth', () => {
  const library: FarmFact[] = [
    { id: 'a', topic: 'cattle', title: 'A', body: 'x', soWhat: 'y', months: [9] },
    { id: 'b', topic: 'cattle', title: 'B', body: 'x', soWhat: 'y', months: [9, 10] },
    { id: 'c', topic: 'cattle', title: 'C', body: 'x', soWhat: 'y' },
  ]

  it('counts what is left for a month, not what exists', () => {
    // What can run out at a meeting is this month's unread facts. A library of
    // two hundred is still empty on the day if they are all February's.
    expect(unusedForMonth(library, new Set(['a']), 9).map((f) => f.id)).toEqual(['b'])
  })

  it('does not count an evergreen fact towards a month', () => {
    // They are the fallback behind the season, not part of its stock — counting
    // them would hide a month that has nothing of its own left.
    expect(unusedForMonth(library, new Set(), 3)).toEqual([])
  })
})

describe('the library is stocked for every month', () => {
  // The whole point of never repeating is that the library gets consumed, and
  // the whole point of the seasons is that a month is served by its OWN facts.
  // A month with fewer than a month's worth falls through to the evergreen
  // ones early and then runs dry — so this is the number that has to hold as
  // facts are added and used.
  const weeksInAMonth = 52 / 12

  it.each(Array.from({ length: 12 }, (_, i) => i + 1))('month %i has a month of its own facts', (m) => {
    const seasonal = FARM_FACTS.filter((f) => f.months?.includes(m))
    expect(seasonal.length, `month ${m}`).toBeGreaterThanOrEqual(weeksInAMonth)
  })

  it('has a year of Mondays in it', () => {
    expect(FARM_FACTS.length).toBeGreaterThanOrEqual(52)
  })
})
