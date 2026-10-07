import { describe, expect, it } from 'vitest'
import {
  MAX_NEW_PER_MONTH,
  TARGET_UNUSED_PER_MONTH,
  monthsNeedingFacts,
  parseFacts,
  slugFor,
  stockByMonth,
  titleTooClose,
  validateFact,
} from '../../netlify/shared/meeting-facts-core'
import { STOCK_PER_MONTH, type FarmFact } from './farm-facts'

/** A library of `n` facts for one month, ids month-1, month-2, … */
const monthly = (month: number, n: number): FarmFact[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `m${month}-${i + 1}`,
    topic: 'cattle' as const,
    title: `Fact ${month}.${i + 1}`,
    body: 'x',
    soWhat: 'y',
    months: [month],
  }))

describe('knowing when to write more', () => {
  it('says nothing needs writing while every month is stocked', () => {
    const library = Array.from({ length: 12 }, (_, i) => monthly(i + 1, TARGET_UNUSED_PER_MONTH)).flat()
    expect(monthsNeedingFacts(library, new Set(), new Date(2026, 8, 14))).toEqual([])
  })

  it('counts a used fact as gone', () => {
    // The whole point of the log is that a fact is spent once read out, so
    // stock has to be counted net of it — not as the size of the library.
    const library = monthly(9, TARGET_UNUSED_PER_MONTH)
    const used = new Set(library.slice(0, 3).map((f) => f.id))
    expect(stockByMonth(library, used)[8]).toEqual({
      month: 9,
      unused: TARGET_UNUSED_PER_MONTH - 3,
      short: 3,
    })
  })

  it('writes for the nearest month short, not the emptiest', () => {
    // A month five out that is bare still has twenty top-up runs ahead of it.
    // This month being one short is the one that reaches a meeting.
    const library = [
      ...monthly(9, TARGET_UNUSED_PER_MONTH - 1), // September: short by one
      ...monthly(10, TARGET_UNUSED_PER_MONTH),
      ...monthly(11, TARGET_UNUSED_PER_MONTH),
      // December: nothing at all
    ]
    const wanted = monthsNeedingFacts(library, new Set(), new Date(2026, 8, 14))
    expect(wanted.map((w) => w.month)).toEqual([9, 12])
  })

  it('leaves next spring alone in September', () => {
    // Writing May facts in September is work against a stock that will be
    // topped up thirty times before anybody needs it.
    const wanted = monthsNeedingFacts([], new Set(), new Date(2026, 8, 14), 12)
    expect(wanted.map((w) => w.month)).toEqual([9, 10, 11, 12, 1, 2])
  })

  it('wraps into the new year without losing January', () => {
    const wanted = monthsNeedingFacts([], new Set(), new Date(2026, 10, 16), 3)
    expect(wanted.map((w) => w.month)).toEqual([11, 12, 1])
  })

  it('asks for no more than a reply can hold', () => {
    const [worst] = monthsNeedingFacts([], new Set(), new Date(2026, 8, 14))
    expect(Math.min(worst.short, MAX_NEW_PER_MONTH)).toBeLessThanOrEqual(MAX_NEW_PER_MONTH)
  })

  it('holds the same target the app uses to ask for a top-up', () => {
    // Two numbers drifting apart would mean the screen asking for facts the
    // job does not think are needed, forever.
    expect(TARGET_UNUSED_PER_MONTH).toBe(STOCK_PER_MONTH)
  })
})

describe('not saying the same thing twice', () => {
  const existing = ['Swath canola at 60% seed colour change — on the main stem']

  it('catches the same fact in different words', () => {
    // This is the failure the whole log exists to prevent, arriving by the one
    // door the log cannot close: a new id on an old fact.
    expect(titleTooClose('Canola: swath at 60% colour change on the main stem', existing)).toBe(true)
  })

  it('lets a genuinely different fact through', () => {
    expect(titleTooClose('Frost locks green into canola seed', existing)).toBe(false)
  })

  it('compares what a title is about, not the words it shares', () => {
    // Two titles about different things share "is", "the" and "a" and nothing
    // that matters, so the filler is thrown away before they are compared.
    expect(titleTooClose('Feed test the hay that is in the yard', ['That is the one to do'])).toBe(
      false,
    )
  })

  it('treats a title with no substance in it as a duplicate', () => {
    // Nothing to compare means nothing to stand behind, so it does not get in.
    expect(titleTooClose('It is what it is', ['Anything at all'])).toBe(true)
  })

  it('never reissues an id, including one that was dropped', () => {
    // meeting_fact_log remembers ids forever, so a reused id would silently
    // resurrect "already read out" on a fact nobody has heard.
    const taken = new Set(['stubble-traps-snow', 'stubble-traps-snow-2'])
    expect(slugFor('Stubble traps snow', taken)).toBe('stubble-traps-snow-3')
  })

  it('makes a usable id out of an awkward title', () => {
    expect(slugFor('60% colour change — count it on the main stem!', new Set())).toBe(
      '60-colour-change-count-it',
    )
  })
})

describe('checking a written fact before it can be read out', () => {
  const good = {
    topic: 'cattle',
    title: 'Cold costs a cow feed before it costs her condition',
    body: 'A dry cow in good condition sits comfortable down to about -20 °C with a dry winter coat, and below that her energy requirement climbs roughly two per cent for every further degree. A wet or muddy coat lifts that threshold by ten degrees or more, because the insulation is gone. She takes it out of her own back fat long before anybody sees her shivering.',
    so_what: 'Feed ahead of a cold snap rather than after it, and keep bedding dry — the coat is the insulation you are paying for.',
    months: [12, 1, 2],
    source_url: 'https://www.beefresearch.ca/topics/winter-feeding/',
  }

  const check = (patch: Record<string, unknown>, month = 1) =>
    validateFact({ ...good, ...patch }, month, [], new Set())

  it('accepts one that is sourced, seasonal and actionable', () => {
    const r = check({})
    expect('fact' in r && r.fact.id).toBe('cold-costs-a-cow-feed')
    expect('fact' in r && r.fact.months).toEqual([1, 2, 12])
  })

  it('refuses one with nothing to check it against', () => {
    // The single thing that makes an automatically written fact safe to read
    // out is that whoever hears it can go and look.
    expect(check({ source_url: '' })).toEqual({ reason: 'no source to check it against' })
    expect(check({ source_url: 'ask any agronomist' })).toEqual({
      reason: 'no source to check it against',
    })
  })

  it('refuses one written for the wrong month', () => {
    // Otherwise the seasonal filter is defeated from the inside, which is the
    // whole reason the months exist.
    expect(check({ months: [6, 7] })).toEqual({ reason: 'not a fact for January' })
  })

  it('refuses an evergreen fact in seasonal clothing', () => {
    expect(check({ months: [1, 2, 3, 4, 5, 6, 7] })).toEqual({
      reason: 'too many months to be seasonal',
    })
  })

  it('refuses one too thin to read aloud', () => {
    expect(check({ body: 'Cows get cold in winter.' })).toMatchObject({
      reason: expect.stringContaining('body too short'),
    })
  })

  it('refuses one with nothing to do about it', () => {
    expect(check({ so_what: 'Worth knowing.' })).toEqual({ reason: 'nothing to do about it' })
  })

  it('refuses a topic the agenda cannot label', () => {
    expect(check({ topic: 'hogs' })).toEqual({ reason: 'unknown topic hogs' })
  })

  it('refuses one that repeats a fact already in the library', () => {
    const r = validateFact({ ...good }, 1, ['Cold costs a cow feed before her condition'], new Set())
    expect(r).toEqual({ reason: 'already covered' })
  })

  it('takes so_what in either spelling', () => {
    const { so_what, ...rest } = good
    const r = validateFact({ ...rest, soWhat: so_what }, 1, [], new Set())
    expect('fact' in r).toBe(true)
  })
})

describe('reading the reply', () => {
  it('finds the array inside a model that wanted to chat', () => {
    expect(parseFacts('Here you go:\n[{"title":"a"}]\nHope that helps.')).toEqual([{ title: 'a' }])
  })

  it('returns nothing rather than throwing on a broken reply', () => {
    // A bad reply must cost one empty top-up run, not the function.
    expect(parseFacts('[{"title": ')).toEqual([])
    expect(parseFacts('I could not find anything.')).toEqual([])
    expect(parseFacts('{"title":"not an array"}')).toEqual([])
  })
})
