/**
 * Alberta's sclerotinia stem rot checklist, scored.
 *
 * Agdex 149/632-4, "Disease Forecasting for Sclerotinia White Stem Rot in
 * Canola" (revised July 2007), which the research library holds. Fifteen
 * questions in three sections; each answer carries a fixed number of points and
 * each section has a published threshold. The sheet's own verdict is that all
 * three sections have to clear their threshold before a fungicide is worth it —
 * section one says the farm has had the disease, section two that the weather is
 * right for it this year, section three that there is a crop worth protecting.
 *
 * The questions and point values are transcribed exactly, including the ones
 * that look odd. Question 15 scores 20 for a crop that fell short of its
 * potential and 0 for one that made it, which reads backwards until you see
 * what it is asking: a 30 bu/ac field that keeps coming off at 25 has been
 * losing yield to something, and sclerotinia is the usual something.
 *
 * The sheet is filled in shortly after first flower, and the fungicide goes on
 * at 20 to 30 per cent bloom — four to eight days later. Nothing here invents
 * an answer: a question the app can offer from its own records is marked
 * `fromRecords`, and the rest are the grower's to answer.
 */

export type SclerotiniaOption = { label: string; points: number }

export type SclerotiniaQuestion = {
  /** The sheet's own numbering, 1 to 15. */
  n: number
  section: 1 | 2 | 3
  question: string
  options: SclerotiniaOption[]
  /**
   * What in the app can answer this, where something can. The screen uses it to
   * offer an answer; it never fills one in silently, because every one of these
   * is a judgement the sheet asks a person to make.
   */
  fromRecords?: 'scouting' | 'sprays' | 'weather' | 'forecast' | 'yield' | 'plan' | 'satellite'
}

export const SCLEROTINIA_SOURCE = {
  paperId: '8cc88466-b198-47a6-987b-df896bfa5d34',
  paper: 'Disease forecasting for Sclerotinia white stem rot in canola',
  agdex: '149/632-4',
  revised: 'July 2007',
}

export const SCLEROTINIA_QUESTIONS: SclerotiniaQuestion[] = [
  {
    n: 1,
    section: 1,
    question:
      'Have you had good looking crops at flowering and poor yields at harvest, even though growing conditions were favourable?',
    options: [
      { label: 'Yes', points: 20 },
      { label: 'No', points: 0 },
    ],
    fromRecords: 'yield',
  },
  {
    n: 2,
    section: 1,
    question: 'Have you seen sclerotinia stem rot in your crops in previous years?',
    options: [
      { label: 'Yes', points: 20 },
      { label: 'No', points: 10 },
    ],
    fromRecords: 'scouting',
  },
  {
    n: 3,
    section: 1,
    question: 'Have you heard of sclerotinia problems in your area in the past two to three years?',
    options: [
      { label: 'Yes', points: 10 },
      { label: 'No', points: 5 },
    ],
  },
  {
    n: 4,
    section: 1,
    question: 'Have you seen black sclerotes in your harvested seed in the past two to three years?',
    options: [
      { label: 'Yes', points: 20 },
      { label: 'No', points: 10 },
    ],
  },
  {
    n: 5,
    section: 1,
    question: 'In previous years have your canola crops lodged?',
    options: [
      { label: 'Heavily', points: 20 },
      { label: 'Moderately', points: 10 },
      { label: 'Lightly', points: 0 },
    ],
    fromRecords: 'scouting',
  },
  {
    n: 6,
    section: 1,
    question: 'Do you see large swaths at harvest but get low yield?',
    options: [
      { label: 'Yes', points: 10 },
      { label: 'No', points: 0 },
    ],
  },
  {
    n: 7,
    section: 1,
    question: 'If you sprayed a sclerotinia fungicide in previous years, what were the results?',
    options: [
      { label: 'Better crop', points: 20 },
      { label: 'No difference', points: 0 },
    ],
    fromRecords: 'sprays',
  },
  {
    n: 8,
    section: 2,
    question:
      'Walking through the crop in the morning at the beginning of flowering, are your boots and pant legs wet when you come out?',
    options: [
      { label: 'Yes', points: 20 },
      { label: 'No', points: 10 },
    ],
  },
  {
    n: 9,
    section: 2,
    question:
      'Have you had wet weather in the immediate area within 2 to 3 weeks before flowering that let the soil stay moist for extended periods?',
    options: [
      { label: 'Yes', points: 20 },
      { label: 'No', points: 10 },
    ],
    fromRecords: 'weather',
  },
  {
    n: 10,
    section: 2,
    question:
      'Were apothecia found in the field, around the field, or in any neighbouring cereal or canola field where canola grew in the previous 1 to 3 years?',
    options: [
      { label: 'Yes', points: 20 },
      { label: 'No', points: 10 },
    ],
    fromRecords: 'scouting',
  },
  {
    n: 11,
    section: 2,
    question: 'Do you expect it to be dry throughout the flowering stage of the crop?',
    options: [
      { label: 'Highly likely', points: 0 },
      { label: 'Moderately likely', points: 10 },
      { label: 'Not likely', points: 20 },
    ],
    fromRecords: 'forecast',
  },
  {
    n: 12,
    section: 3,
    question: 'What is the condition of the stand in height, vigour and uniformity?',
    options: [
      { label: 'Excellent', points: 20 },
      { label: 'Good', points: 10 },
      { label: 'Fair', points: 5 },
      { label: 'Poor', points: 0 },
    ],
    fromRecords: 'satellite',
  },
  {
    n: 13,
    section: 3,
    question: 'Walking through the crop, how dense is the canopy?',
    options: [
      { label: 'Light', points: 0 },
      { label: 'Moderate', points: 10 },
      { label: 'Very dense', points: 20 },
    ],
  },
  {
    n: 14,
    section: 3,
    question: 'What is the yield potential of the stand?',
    options: [
      { label: '10 to 20 bu/ac', points: 0 },
      { label: '20 to 30 bu/ac', points: 10 },
      { label: 'Over 30 bu/ac', points: 20 },
    ],
    fromRecords: 'plan',
  },
  {
    n: 15,
    section: 3,
    question:
      'In previous years, when the yield potential was 30+ bu/ac, what were the actual yields?',
    options: [
      { label: 'Over 30 bu/ac', points: 0 },
      { label: '20 to 30 bu/ac', points: 20 },
    ],
    fromRecords: 'yield',
  },
]

/** The sheet's own thresholds: 60 or more, more than 50, 50 or more. */
export const SECTION_RULES = {
  1: { threshold: 60, inclusive: true, meaning: 'the farm has had sclerotinia' },
  2: { threshold: 50, inclusive: false, meaning: 'the weather suits it this year' },
  3: { threshold: 50, inclusive: true, meaning: 'there is a crop worth protecting' },
} as const

export type Answers = Record<string, number>

export type SectionScore = {
  section: 1 | 2 | 3
  points: number
  /** Highest the section can score, for showing the score in proportion. */
  max: number
  answered: number
  questions: number
  /** Null until every question in the section is answered. */
  clears: boolean | null
}

const SECTIONS: (1 | 2 | 3)[] = [1, 2, 3]

/**
 * Score the three sections.
 *
 * A section with an unanswered question gets `clears: null` rather than a
 * verdict on a partial score. The sheet says to answer all the questions, and
 * a part-filled checklist that already reads "spray" is how a decision aid
 * turns into a rubber stamp.
 */
export function scoreSections(answers: Answers): SectionScore[] {
  return SECTIONS.map((section) => {
    const qs = SCLEROTINIA_QUESTIONS.filter((q) => q.section === section)
    const given = qs.filter((q) => answers[String(q.n)] != null)
    const points = given.reduce((s, q) => s + Number(answers[String(q.n)]), 0)
    const rule = SECTION_RULES[section]
    return {
      section,
      points,
      max: qs.reduce((s, q) => s + Math.max(...q.options.map((o) => o.points)), 0),
      answered: given.length,
      questions: qs.length,
      clears:
        given.length < qs.length
          ? null
          : rule.inclusive
            ? points >= rule.threshold
            : points > rule.threshold,
    }
  })
}

export type Verdict = {
  /** 'spray' only when all three sections clear, which is what the sheet says. */
  call: 'spray' | 'hold' | 'incomplete'
  why: string
}

/**
 * What the sheet concludes.
 *
 * Deliberately only three answers. The sheet itself warns that the checklist is
 * not always reliable — sudden weather can bring an infection on unexpectedly,
 * and a high-risk field can show little disease — so a number dressed up as a
 * probability would be claiming more than the method has.
 */
export function verdict(scores: SectionScore[]): Verdict {
  const missing = scores.filter((s) => s.clears == null)
  if (missing.length) {
    const left = missing.reduce((n, s) => n + (s.questions - s.answered), 0)
    return {
      call: 'incomplete',
      why: `${left} question${left === 1 ? '' : 's'} still to answer — the sheet scores all fifteen or none.`,
    }
  }
  const failed = scores.filter((s) => !s.clears)
  if (!failed.length) {
    return {
      call: 'spray',
      why: 'All three sections clear the sheet’s thresholds, so it says a fungicide is worth applying at 20 to 30 per cent bloom.',
    }
  }
  const names = failed.map((s) => `section ${s.section} (${SECTION_RULES[s.section].meaning}) scored ${s.points}`)
  return {
    call: 'hold',
    why: `${names.join('; ')}. The sheet wants all three sections over their threshold before a fungicide pays.`,
  }
}

/**
 * How long there is to act, from the day first flower was seen.
 *
 * The sheet: two to four days from first flower to 10 per cent bloom, four to
 * eight days to the 20 to 30 per cent bloom spray window, and the fungicide
 * protects for at least nine days once on. Book the applicator early.
 */
export function sprayWindow(firstFlower: string): { opensOn: string; closesOn: string } {
  const at = (days: number) => {
    const d = new Date(`${firstFlower}T12:00:00Z`)
    d.setUTCDate(d.getUTCDate() + days)
    return d.toISOString().slice(0, 10)
  }
  return { opensOn: at(4), closesOn: at(8) }
}

/**
 * The loss the sheet's own arithmetic expects from an infection level.
 *
 * "An Argentine canola field with a 50 per cent main stem infection would have
 * an approximate yield loss of 25 per cent: 50 x 0.50 = 25." Polish types lose
 * less at the same infection level, which is why the species is asked for.
 */
export function expectedLossPct(infectionPct: number, species: 'argentine' | 'polish' = 'argentine') {
  const loss = infectionPct * 0.5
  return species === 'argentine' ? loss : null
}

/** The economic trigger the 1981–82 trials gave, by species. */
export const WORTH_SPRAYING_AT = {
  argentine: 15,
  polish: 30,
} as const
