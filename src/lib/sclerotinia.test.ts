import { describe, expect, it } from 'vitest'
import {
  SCLEROTINIA_QUESTIONS,
  SECTION_RULES,
  expectedLossPct,
  scoreSections,
  sprayWindow,
  verdict,
  type Answers,
} from './sclerotinia'

// This decides whether a fungicide goes on a canola field, so the published
// thresholds and the "answer all fifteen" rule are held down rather than left
// to review. A checklist that quietly scores a partial answer sheet is how a
// decision aid becomes a rubber stamp.

/** Every question answered with the option at `pick` (clamped to what exists). */
const fill = (pick: (q: (typeof SCLEROTINIA_QUESTIONS)[number]) => number): Answers =>
  Object.fromEntries(SCLEROTINIA_QUESTIONS.map((q) => [String(q.n), pick(q)]))

const highest = fill((q) => Math.max(...q.options.map((o) => o.points)))
const lowest = fill((q) => Math.min(...q.options.map((o) => o.points)))

describe('the transcribed checklist', () => {
  it('has the sheet’s fifteen questions in three sections', () => {
    expect(SCLEROTINIA_QUESTIONS).toHaveLength(15)
    expect(SCLEROTINIA_QUESTIONS.map((q) => q.n)).toEqual([...Array(15)].map((_, i) => i + 1))
    expect(SCLEROTINIA_QUESTIONS.filter((q) => q.section === 1)).toHaveLength(7)
    expect(SCLEROTINIA_QUESTIONS.filter((q) => q.section === 2)).toHaveLength(4)
    expect(SCLEROTINIA_QUESTIONS.filter((q) => q.section === 3)).toHaveLength(4)
  })

  it('gives every question at least two options, all worth 0 to 20 points', () => {
    for (const q of SCLEROTINIA_QUESTIONS) {
      expect(q.options.length, `Q${q.n}`).toBeGreaterThanOrEqual(2)
      for (const o of q.options) {
        expect(o.points, `Q${q.n} ${o.label}`).toBeGreaterThanOrEqual(0)
        expect(o.points, `Q${q.n} ${o.label}`).toBeLessThanOrEqual(20)
        expect(o.points % 5, `Q${q.n} ${o.label}`).toBe(0)
      }
    }
  })

  it('keeps question 15 scoring the way the sheet prints it', () => {
    // Backwards at a glance and right on reflection: a field that keeps coming
    // off under its potential has been losing yield to something.
    const q15 = SCLEROTINIA_QUESTIONS.find((q) => q.n === 15)!
    expect(q15.options.find((o) => o.label === 'Over 30 bu/ac')?.points).toBe(0)
    expect(q15.options.find((o) => o.label === '20 to 30 bu/ac')?.points).toBe(20)
  })
})

describe('scoring', () => {
  it('totals each section and knows its maximum', () => {
    const [one, two, three] = scoreSections(highest)
    expect(one.points).toBe(120)
    expect(one.max).toBe(120)
    expect(two.points).toBe(80)
    expect(three.points).toBe(80)
  })

  it('reaches no verdict until every question in a section is answered', () => {
    const partial = { ...highest }
    delete partial['6']
    const [one, two] = scoreSections(partial)
    expect(one.clears).toBeNull()
    expect(one.answered).toBe(6)
    expect(two.clears).toBe(true)
    expect(verdict(scoreSections(partial)).call).toBe('incomplete')
  })

  it('treats a zero answer as answered, because zero is a real answer', () => {
    // Q1 'No' and Q6 'No' are both worth nothing; counting them as unanswered
    // would leave the sheet permanently incomplete for a clean field.
    const [one] = scoreSections(lowest)
    expect(one.answered).toBe(7)
    expect(one.clears).toBe(false)
  })

  it('applies the sheet’s thresholds, inclusive where it says so', () => {
    // Section one is "60 or more", section two "more than 50", section three
    // "50 or higher". The difference decides a field sitting exactly on 50.
    expect(SECTION_RULES[1]).toMatchObject({ threshold: 60, inclusive: true })
    expect(SECTION_RULES[2]).toMatchObject({ threshold: 50, inclusive: false })
    expect(SECTION_RULES[3]).toMatchObject({ threshold: 50, inclusive: true })

    // Section two on exactly 50 does NOT clear.
    const fifty: Answers = { ...highest, '8': 10, '9': 10, '10': 20, '11': 10 }
    expect(scoreSections(fifty)[1].points).toBe(50)
    expect(scoreSections(fifty)[1].clears).toBe(false)

    // Section three on exactly 50 does.
    const three: Answers = { ...highest, '12': 20, '13': 10, '14': 20, '15': 0 }
    expect(scoreSections(three)[2].points).toBe(50)
    expect(scoreSections(three)[2].clears).toBe(true)
  })
})

describe('the verdict', () => {
  it('says spray only when all three sections clear', () => {
    expect(verdict(scoreSections(highest)).call).toBe('spray')
  })

  it('holds when any one section falls short, and names which', () => {
    const weakThree: Answers = { ...highest, '12': 0, '13': 0, '14': 0, '15': 0 }
    const v = verdict(scoreSections(weakThree))
    expect(v.call).toBe('hold')
    expect(v.why).toContain('section 3')
    expect(v.why).toContain('crop worth protecting')
  })

  it('holds on a clean field with no history', () => {
    expect(verdict(scoreSections(lowest)).call).toBe('hold')
  })
})

describe('the spray window', () => {
  it('opens four days after first flower and closes at eight', () => {
    expect(sprayWindow('2026-07-01')).toEqual({ opensOn: '2026-07-05', closesOn: '2026-07-09' })
  })

  it('crosses a month end', () => {
    expect(sprayWindow('2026-06-28')).toEqual({ opensOn: '2026-07-02', closesOn: '2026-07-06' })
  })
})

describe('loss from an infection level', () => {
  it('halves the main stem infection, as the sheet’s worked example does', () => {
    // "50 per cent main stem infection ... 50 x 0.50 = 25."
    expect(expectedLossPct(50)).toBe(25)
  })

  it('will not put the Argentine arithmetic on Polish canola', () => {
    // The sheet says only that Polish losses "may be lower" — no number.
    expect(expectedLossPct(50, 'polish')).toBeNull()
  })
})
