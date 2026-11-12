/**
 * Economic thresholds for the insects this farm scouts for.
 *
 * A scouting pin says what was seen and how bad it looked. A threshold turns
 * that into a decision, and the decision is not "is there an insect in the
 * net" but "is the damage it will do worth more than the pass costs". Every
 * number here is read out of a paper in the farm's own research library, with
 * the paper named, because an economic threshold that cannot be traced is
 * worth less than no threshold at all.
 *
 * THREE THINGS THIS DELIBERATELY DOES NOT DO.
 *
 * It does not invent a threshold for a pest that has none. Alberta publishes
 * no economic threshold for potato psyllid, and none for lygus in canola at
 * the bud stage; those come back as 'none' with the reason, not as a guess.
 *
 * It does not average across crops. The same insect is a different problem in
 * a different crop, and the guides disagree with each other on purpose: lygus
 * at bud and bloom is worth spraying in alfalfa grown for seed at two to three
 * per sweep, and is NOT worth spraying in canola at any number. Both are
 * right. Keyed by pest alone, the app would be wrong half the time.
 *
 * It does not hide a soft number behind a hard verdict. Where the paper says
 * its own threshold is unverified, or uses its units loosely, that is carried
 * through to the screen as 'provisional' rather than smoothed away.
 *
 * Pure: no React, no Supabase. The hooks and the screen live elsewhere.
 */

/* ------------------------------------------------------------------ units */

/**
 * What a count counts. These are the strings the scouting_notes.count_unit
 * check constraint allows, and the labels are what the form asks for.
 *
 * The distinction between a sweep and a ten-sweep sample matters more than it
 * looks: the two differ by a factor of ten, and the guides use both.
 */
export const INSECT_UNITS = {
  per_sweep: {
    label: 'per sweep',
    /** Asked on the form. */
    prompt: 'Insects per sweep',
    help: 'One 180° sweep of a 38 cm (15 in) insect net.',
  },
  per_sample_10_sweeps: {
    label: 'per 10-sweep sample',
    prompt: 'Average per sample',
    help: 'A sample is ten 180° sweeps of a 38 cm (15 in) net. Average your samples.',
  },
  heads_per_adult: {
    label: 'heads per adult',
    prompt: 'Wheat heads per adult midge',
    help: 'Count midge on the heads at dusk: one midge for every how many heads?',
  },
  pct_stems: {
    label: '% of stems',
    prompt: 'Stems infested (%)',
    help: 'Cut stems open and look for sawdust-like frass.',
  },
} as const

export type InsectUnit = keyof typeof INSECT_UNITS

/* ------------------------------------------------------------------ crops */

/**
 * The crop as a threshold cares about it.
 *
 * `cropKey` in rotation-engine.ts folds "Alfalfa" and "Alfalfa Seed" together,
 * which is right for rotation — the stand is the same plant and breaks the same
 * diseases — and wrong here, because the whole point of an alfalfa seed crop is
 * the seed the lygus are feeding on. So this does its own matching, and tests
 * hold the two apart.
 */
export type ThresholdCrop = 'canola' | 'alfalfa_seed' | 'wheat' | 'potato' | 'other'

export function thresholdCrop(cropName: string | null | undefined): ThresholdCrop {
  const n = (cropName ?? '').toLowerCase()
  // Seed before hay, and before canola: "Seed Canola" is a canola.
  if (/alfalfa\s*seed/.test(n)) return 'alfalfa_seed'
  if (/canola/.test(n)) return 'canola'
  // Durum and winter wheat are wheat to a midge and a sawfly.
  if (/wheat|durum/.test(n)) return 'wheat'
  if (/potato/.test(n)) return 'potato'
  return 'other'
}

/* ----------------------------------------------------------------- stages */

/**
 * The crop stage the threshold is read against.
 *
 * Coarse on purpose. These are the windows the guides themselves use, not a
 * growth-staging scale: a finer scale would imply the thresholds are known
 * more precisely than they are.
 */
export type PestStage = 'early' | 'bud_bloom' | 'late_flower' | 'pod_ripening' | 'preharvest'

export const PEST_STAGES: { value: PestStage; label: string }[] = [
  { value: 'early', label: 'Before bud' },
  { value: 'bud_bloom', label: 'Bud and bloom' },
  { value: 'late_flower', label: 'End of flowering' },
  { value: 'pod_ripening', label: 'Pod ripening' },
  { value: 'preharvest', label: 'Before harvest' },
]

/* -------------------------------------------------- lygus in canola, table */

/**
 * Lygus in canola: Alberta's Table 1, as printed.
 *
 * From "Lygus bugs in Canola" (Jim Jones, Alberta Agriculture, Food and Rural
 * Development, 1999; Agdex 622-20). The threshold is not a number — it moves
 * with what the pass costs and what the canola is worth, which is the honest
 * way to write an economic threshold and the reason this is a table and not a
 * constant.
 *
 * Rows are application cost in $/ha, columns are canola price in $/tonne.
 * Values are the average number of lygus per ten-sweep sample.
 *
 * The sheet's own staging note: 'End of flowering' to early pod development in
 * the upper canopy is stage 4.4-5.1; 'Pod ripening' is stage 5.2.
 */
export const LYGUS_CANOLA_COST_PER_HA = [22, 24, 26, 28, 30, 32] as const
export const LYGUS_CANOLA_PRICE_PER_T = [220, 260, 300] as const

export const LYGUS_CANOLA_TABLE: Record<'late_flower' | 'pod_ripening', readonly (readonly number[])[]> = {
  // $220  $260  $300
  late_flower: [
    [14, 12, 10], // $22/ha
    [16, 13, 11], // $24/ha
    [17, 14, 12], // $26/ha
    [18, 15, 13], // $28/ha
    [19, 16, 14], // $30/ha
    [21, 17, 15], // $32/ha
  ],
  pod_ripening: [
    [20, 17, 15],
    [22, 18, 16],
    [24, 20, 17],
    [25, 22, 19],
    [27, 23, 20],
    [29, 25, 21],
  ],
}

/**
 * The constant behind the table, which is what lets it still be used.
 *
 * The 1999 table stops at $300 a tonne. Canola on this farm's own 2026 price
 * list is nearly $800, so every real reading would fall off the end of the
 * sheet and clamp to its lowest row — the app would answer "10 lygus" forever
 * and the money would have stopped mattering, which is the opposite of what an
 * economic threshold is for.
 *
 * It does not have to. An economic threshold is the point where the damage
 * still to come is worth more than the pass, and the damage one lygus does is
 * a physical quantity of seed, not a sum of money. So the threshold depends on
 * cost and price only through their RATIO, and Alberta's table turns out to be
 * exactly that:
 *
 *     threshold = round(k x cost($/ha) / price($/tonne))
 *
 * At pod ripening k = 200 reproduces all eighteen printed cells exactly, with
 * no error anywhere. At the end of flowering k = 140.75 reproduces sixteen of
 * eighteen exactly and the other two within one lygus, which is the sheet's own
 * rounding rather than a different relationship. The test below holds that
 * down against the printed table, so if either number is ever edited the fit
 * has to still hold.
 *
 * Inside the printed range the printed cell is used, so the app and the PDF
 * agree to the digit. Outside it the law is used, and `basis` says which — a
 * 2026 price is an extension of Alberta's own arithmetic, not a new claim.
 */
export const LYGUS_CANOLA_K: Record<'late_flower' | 'pod_ripening', number> = {
  late_flower: 140.75,
  pod_ripening: 200,
}

/** The nearest row or column in the printed table. */
const nearest = (values: readonly number[], v: number): number => {
  let best = 0
  for (let i = 1; i < values.length; i++) {
    if (Math.abs(values[i] - v) < Math.abs(values[best] - v)) best = i
  }
  return best
}

const within = (v: number, values: readonly number[]) => v >= values[0] && v <= values[values.length - 1]

export type LygusCanolaLookup = {
  threshold: number
  /** 'table' where the printed sheet covers it, 'ratio' where the law extends it. */
  basis: 'table' | 'ratio'
  /** The printed row and column used, when the basis is the table. */
  costPerHa: number | null
  pricePerTonne: number | null
}

/**
 * The lygus threshold for a given cost of pass and price of canola.
 *
 * Inside the printed table, the nearest printed cell — deliberately a lookup
 * and not an interpolation, because across the sheet's own $2/ha and $40/tonne
 * steps the value moves by one or two lygus and "13.4 lygus" would claim a
 * precision it does not have. Outside the table, the ratio law above.
 */
export function lygusCanolaThreshold(
  stage: 'late_flower' | 'pod_ripening',
  costPerHa: number,
  pricePerTonne: number,
): LygusCanolaLookup {
  if (pricePerTonne <= 0 || costPerHa <= 0) {
    return { threshold: LYGUS_CANOLA_TABLE[stage][2][1], basis: 'table', costPerHa: 26, pricePerTonne: 260 }
  }
  if (within(costPerHa, LYGUS_CANOLA_COST_PER_HA) && within(pricePerTonne, LYGUS_CANOLA_PRICE_PER_T)) {
    const r = nearest(LYGUS_CANOLA_COST_PER_HA, costPerHa)
    const c = nearest(LYGUS_CANOLA_PRICE_PER_T, pricePerTonne)
    return {
      threshold: LYGUS_CANOLA_TABLE[stage][r][c],
      basis: 'table',
      costPerHa: LYGUS_CANOLA_COST_PER_HA[r],
      pricePerTonne: LYGUS_CANOLA_PRICE_PER_T[c],
    }
  }
  // One lygus is the floor: below that there is nothing to count.
  const t = Math.max(1, Math.round((LYGUS_CANOLA_K[stage] * costPerHa) / pricePerTonne))
  return { threshold: t, basis: 'ratio', costPerHa: null, pricePerTonne: null }
}

/* ------------------------------------------------------------------ pests */

/** What the app can say about a count. */
export type Verdict =
  /** A threshold applies, but nothing has been counted yet. */
  | 'uncounted'
  /** Counted, and under the threshold. */
  | 'below'
  /** Counted, and at or over it. */
  | 'at_or_over'
  /** A published threshold exists but this is the wrong stage for it. */
  | 'wrong_stage'
  /** No threshold is published for this pest in this crop. */
  | 'none'
  /** The research says spraying here costs more than it saves. */
  | 'do_not_spray'
  /** The decision is not a spray at all. */
  | 'not_a_spray'

export type Source = { title: string; year: number; note?: string }

export type Assessment = {
  verdict: Verdict
  /** The number the count was compared against, where there is one. */
  threshold: number | null
  unit: InsectUnit | null
  /** Sentences for the screen, in the order they should be read. */
  reasons: string[]
  /** True where the paper itself hedges the number. */
  provisional: boolean
  sources: Source[]
}

export type PestInput = {
  pest: string
  crop: ThresholdCrop
  stage: PestStage
  count: number | null
  /** For lygus in canola, where the threshold moves with both. */
  costPerHa?: number | null
  pricePerTonne?: number | null
  /** Whether the wheat is being grown for a No. 1 grade. */
  gradeTarget?: boolean
}

/** Pests this module knows, as the scouting log spells them. */
export const THRESHOLD_PESTS: Record<ThresholdCrop, string[]> = {
  canola: ['Lygus bugs', 'Cabbage seedpod weevil'],
  alfalfa_seed: ['Lygus bugs', 'Alfalfa plant bug', 'Pea aphid', 'Alfalfa weevil'],
  wheat: ['Wheat midge', 'Wheat stem sawfly'],
  potato: ['Potato psyllid'],
  other: [],
}

const LYGUS_CANOLA: Source = { title: 'Lygus bugs in Canola', year: 1999 }
const LYGUS_COMPENSATION: Source = { title: 'Does canola compensate for lygus bug damage? : crop years 2000, 2001', year: 2001 }
const ALFALFA_SEED_INSECTS: Source = { title: 'Insects associated with alfalfa seed production', year: 1986 }
const SEEDPOD_WEEVIL: Source = { title: 'Biology and control of the cabbage seedpod weevil, a new pest of canola in Alberta', year: 2001 }
const WHEAT_MIDGE: Source = { title: 'Wheat midge', year: 2001 }
const WHEAT_SAWFLY: Source = { title: 'Wheat stem sawfly', year: 2002 }
const POTATO_PSYLLID: Source = { title: 'Potato psyllid', year: 2014 }

/** A simple per-sweep threshold that changes once bloom is over. */
const sweepPair = (
  budBloom: number,
  afterBloom: number,
  source: Source,
  name: string,
): ((i: PestInput) => Assessment) => (i) => {
  const late = i.stage === 'late_flower' || i.stage === 'pod_ripening' || i.stage === 'preharvest'
  if (i.stage === 'early') {
    return {
      verdict: 'wrong_stage',
      threshold: null,
      unit: 'per_sweep',
      reasons: [`The ${name} threshold starts at bud. Keep counting; before bud there is nothing to compare against.`],
      provisional: false,
      sources: [source],
    }
  }
  const threshold = late ? afterBloom : budBloom
  return {
    ...compare(i.count, threshold, 'per_sweep'),
    reasons: [
      `Threshold is ${threshold} per sweep ${late ? 'after bloom' : 'through bud and bloom'}.`,
      ...countLine(i.count, threshold, 'per_sweep'),
    ],
    provisional: false,
    sources: [source],
  }
}

/** The arithmetic, kept in one place so every pest reads it the same way. */
function compare(count: number | null, threshold: number, unit: InsectUnit): Omit<Assessment, 'reasons' | 'provisional' | 'sources'> {
  // Not 'below': nothing counted is not the same as nothing found, and a badge
  // reading "under the threshold" over an empty box would be a lie.
  if (count == null) return { verdict: 'uncounted', threshold, unit }
  // heads_per_adult counts DOWN: one midge per 4 heads is worse than per 9.
  const over = unit === 'heads_per_adult' ? count <= threshold : count >= threshold
  return { verdict: over ? 'at_or_over' : 'below', threshold, unit }
}

function countLine(count: number | null, threshold: number, unit: InsectUnit): string[] {
  if (count == null) return ['Enter what you counted to see where it sits.']
  const over = unit === 'heads_per_adult' ? count <= threshold : count >= threshold
  if (unit === 'heads_per_adult') {
    return [over
      ? `You counted one for every ${count} heads, which is at or past the threshold.`
      : `You counted one for every ${count} heads, which is under the threshold.`]
  }
  return [over ? `You counted ${count}, at or over it.` : `You counted ${count}, under it.`]
}

/* --------------------------------------------------------------- the rules */

type Rule = (i: PestInput) => Assessment

const RULES: Record<string, Partial<Record<ThresholdCrop, Rule>>> = {
  'Lygus bugs': {
    /**
     * Canola, and the most interesting entry here: before late flowering there
     * is no threshold, and the research says a spray would be worse than
     * nothing.
     *
     * The 1999 sheet states plainly that no economic threshold has been
     * established for the bud stage. The 2001 Alberta field study went looking
     * for one and found the opposite — no economic loss from lygus feeding
     * before late flowering, yields unaffected or better, and in a fifth of its
     * density trials higher yields where lygus were feeding. Canola answers
     * early damage by branching from dormant meristems and setting more pods;
     * once it stops doing that, late bloom onward, the threshold starts to
     * mean something.
     */
    canola: (i) => {
      if (i.stage === 'early' || i.stage === 'bud_bloom') {
        return {
          verdict: 'do_not_spray',
          threshold: null,
          unit: 'per_sample_10_sweeps',
          reasons: [
            'No economic threshold for lygus in canola before the end of flowering, and that is not a gap in the research.',
            'An Alberta field study found no yield loss from lygus feeding at bud or bloom at any density it tested — in a fifth of the trials yield went up — because canola answers early damage by branching and setting more pods. Spraying now is likely to be counter-productive.',
            'Keep counting. The threshold begins at the end of flowering, once the crop has stopped compensating.',
          ],
          provisional: false,
          sources: [LYGUS_CANOLA, LYGUS_COMPENSATION],
        }
      }
      if (i.stage === 'preharvest') {
        return {
          verdict: 'do_not_spray',
          threshold: null,
          unit: 'per_sample_10_sweeps',
          reasons: [
            'Once the seeds in the pods are firm and turning yellow or brown, the cost of control is likely to exceed the damage the lygus can still do before harvest.',
          ],
          provisional: false,
          sources: [LYGUS_CANOLA],
        }
      }
      const stage = i.stage === 'pod_ripening' ? 'pod_ripening' : 'late_flower'
      const cost = i.costPerHa ?? null
      const price = i.pricePerTonne ?? null
      if (cost == null || price == null) {
        return {
          verdict: 'none',
          threshold: null,
          unit: 'per_sample_10_sweeps',
          reasons: [
            'The lygus threshold in canola moves with what the pass costs and what the canola is worth, so it needs both before it can say anything.',
            'Alberta’s table runs from $22 to $32 a hectare and $220 to $300 a tonne; across that range the threshold ranges from 10 to 29 lygus per ten-sweep sample.',
          ],
          provisional: false,
          sources: [LYGUS_CANOLA],
        }
      }
      const look = lygusCanolaThreshold(stage, cost, price)
      const when = stage === 'pod_ripening' ? 'at pod ripening' : 'at the end of flowering'
      return {
        ...compare(i.count, look.threshold, 'per_sample_10_sweeps'),
        reasons: [
          look.basis === 'table'
            ? `At $${look.costPerHa} a hectare and $${look.pricePerTonne} a tonne, ${when} the threshold is ${look.threshold} lygus per ten-sweep sample.`
            : `At $${cost} a hectare and $${price} a tonne, ${when} the threshold works out at ${look.threshold} lygus per ten-sweep sample.`,
          ...countLine(i.count, look.threshold, 'per_sample_10_sweeps'),
          ...(look.basis === 'ratio'
            ? [
                `Alberta’s table was printed in 1999 and stops at $300 a tonne, so this is its own arithmetic carried forward: the threshold depends on the cost of the pass against the price of the canola, and dearer canola is worth protecting at fewer lygus.`,
              ]
            : []),
        ],
        provisional: false,
        sources: [LYGUS_CANOLA],
      }
    },
    /** Alfalfa for seed: the opposite advice, and both are right. */
    alfalfa_seed: sweepPair(2, 4, ALFALFA_SEED_INSECTS, 'lygus'),
  },

  'Alfalfa plant bug': { alfalfa_seed: sweepPair(2, 5, ALFALFA_SEED_INSECTS, 'alfalfa plant bug') },

  'Pea aphid': {
    alfalfa_seed: (i) => ({
      ...compare(i.count, 150, 'per_sweep'),
      reasons: [
        'Threshold is 150 to 200 per sweep; this uses the lower end.',
        ...countLine(i.count, 150, 'per_sweep'),
      ],
      provisional: false,
      sources: [ALFALFA_SEED_INSECTS],
    }),
  },

  'Alfalfa weevil': {
    alfalfa_seed: (i) => ({
      ...compare(i.count, 20, 'per_sweep'),
      reasons: ['Threshold is 20 per sweep.', ...countLine(i.count, 20, 'per_sweep')],
      provisional: false,
      sources: [ALFALFA_SEED_INSECTS],
    }),
  },

  'Cabbage seedpod weevil': {
    /**
     * Carried as provisional on the paper's own say-so. It recommends three to
     * four adults per sweep sample "although not verified by empirical
     * research", on early results and researchers' semi-quantitative
     * judgement — and in the same report writes the unit three ways ("per
     * sweep", "per sweep sample", "per sweep net sample") without defining it.
     * A factor of ten hangs on which was meant, so the screen says so rather
     * than pretending to a number.
     */
    canola: (i) => {
      if (i.stage === 'early') {
        return {
          verdict: 'wrong_stage',
          threshold: null,
          unit: 'per_sweep',
          reasons: ['Canola becomes susceptible at bud. Start sweeping then, and keep on until pod ripening.'],
          provisional: true,
          sources: [SEEDPOD_WEEVIL],
        }
      }
      return {
        ...compare(i.count, 3, 'per_sweep'),
        reasons: [
          'Threshold is 3 to 4 adults per sweep sample; this uses the lower end.',
          ...countLine(i.count, 3, 'per_sweep'),
          'The study recommending it says plainly that it is not verified by empirical research, and it writes the unit as "per sweep", "per sweep sample" and "per sweep net sample" in the same report without defining it. Ten sweeps or one changes the answer tenfold, so check this against the current provincial guide before it decides a pass.',
        ],
        provisional: true,
        sources: [SEEDPOD_WEEVIL],
      }
    },
  },

  'Wheat midge': {
    /**
     * Two thresholds, and which one applies is a marketing decision rather
     * than an agronomic one: 1 midge per 4-5 heads protects yield, 1 per 8-10
     * heads protects a No. 1 grade. The grade threshold is the stricter of the
     * two and exists because the Canadian Grain Commission's tolerances made
     * it worth spraying sooner than yield alone would justify.
     */
    wheat: (i) => {
      if (i.stage === 'early') {
        return {
          verdict: 'wrong_stage',
          threshold: null,
          unit: 'heads_per_adult',
          reasons: ['Wheat is susceptible from heading until flowering. Count on the heads in the evening, when the females are active at the top of the canopy.'],
          provisional: false,
          sources: [WHEAT_MIDGE],
        }
      }
      if (i.stage === 'pod_ripening' || i.stage === 'preharvest') {
        return {
          verdict: 'do_not_spray',
          threshold: null,
          unit: 'heads_per_adult',
          reasons: [
            'Past the advanced stages of flowering the plants are no longer susceptible, and larvae already inside the florets will not be reached.',
            'A pass now would mostly kill Macroglenes penetrans, the parasitic wasp that carries midge control into next year.',
          ],
          provisional: false,
          sources: [WHEAT_MIDGE],
        }
      }
      const threshold = i.gradeTarget ? 9 : 4
      return {
        ...compare(i.count, threshold, 'heads_per_adult'),
        reasons: [
          i.gradeTarget
            ? 'Where conditions favour a No. 1 grade, control may be needed at one adult midge for every 8 to 10 heads — stricter than the yield threshold, because the grade is worth more than the bushels it costs.'
            : 'For yield, one adult midge for every 4 to 5 heads means about 15% of the yield if it is not controlled.',
          ...countLine(i.count, threshold, 'heads_per_adult'),
          'Spray in the evening. Cygon and Lagon have to go on within 24 hours of the threshold; Lorsban, Nufos and Pyrinex also kill the eggs, so holding off up to four days lets more heads emerge behind the pass.',
        ],
        provisional: false,
        sources: [WHEAT_MIDGE],
      }
    },
  },

  'Wheat stem sawfly': {
    /**
     * Not a spray decision at all, which is the useful part: there is no
     * rescue treatment. Above 15% of stems cut the answer is to swath early
     * and save what is standing; at 10-15% last year the answer is a
     * solid-stem variety this year. Both are decisions the app can carry
     * forward rather than a pass it can book.
     */
    wheat: (i) => {
      const count = i.count
      const reasons = [
        'There is no spray for sawfly. Swath the crop if more than 15% of stems are infested, and choose a solid-stem wheat next year if 10 to 15% of last year’s crop was cut.',
      ]
      if (count == null) return { verdict: 'not_a_spray', threshold: 15, unit: 'pct_stems', reasons, provisional: false, sources: [WHEAT_SAWFLY] }
      reasons.push(
        count > 15
          ? `At ${count}% of stems, swath rather than straight cut — above 15% the standing crop is what is at risk.`
          : count >= 10
            ? `At ${count}% of stems, this field earns a solid-stem variety next year.`
            : `At ${count}% of stems, below the 10% that would change next year’s variety.`,
      )
      return { verdict: 'not_a_spray', threshold: 15, unit: 'pct_stems', reasons, provisional: false, sources: [WHEAT_SAWFLY] }
    },
  },

  'Potato psyllid': {
    potato: () => ({
      verdict: 'none',
      threshold: null,
      unit: null,
      reasons: [
        'No economic threshold has been established for psyllids on potatoes in Alberta.',
        'What the province asks for instead is the sample: collect them by sweep net or sticky card, freeze them overnight, and email bugs.r.us@gov.ab.ca for where to ship them. It is how they track whether psyllid — and the zebra chip disease it carries — is arriving here.',
      ],
      provisional: false,
      sources: [POTATO_PSYLLID],
    }),
  },
}

/* ------------------------------------------------------------------- entry */

/** Whether anything is known about this pest in this crop. */
export function hasThreshold(pest: string, crop: ThresholdCrop): boolean {
  return !!RULES[pest]?.[crop]
}

/**
 * Whether the crop stage changes the answer for this pest.
 *
 * Worked out by asking, rather than listed: sawfly gives the same advice at
 * every stage because there is no spray to time, and psyllid has no threshold
 * to time either. Deriving it means the screen cannot drift out of step with
 * the rules — add a stage-sensitive rule and the stage buttons appear by
 * themselves.
 */
export function usesStage(pest: string, crop: ThresholdCrop): boolean {
  if (!hasThreshold(pest, crop)) return false
  const answers = new Set(
    PEST_STAGES.map((s) =>
      JSON.stringify(assess({ pest, crop, stage: s.value, count: 1, costPerHa: 30, pricePerTonne: 260 })),
    ),
  )
  return answers.size > 1
}

/** The unit a pest is counted in, for the form to ask the right question. */
export function unitFor(pest: string, crop: ThresholdCrop): InsectUnit | null {
  const rule = RULES[pest]?.[crop]
  if (!rule) return null
  return rule({ pest, crop, stage: 'late_flower', count: null, costPerHa: 26, pricePerTonne: 260 }).unit
}

/**
 * Read a count against the published threshold.
 *
 * Returns null where nothing is published for this pest in this crop, so the
 * caller can stay silent rather than show an empty card. A pest the app has
 * never heard of is not an error: the scouting log lets anyone type anything,
 * and most pins are not insects at all.
 */
export function assess(input: PestInput): Assessment | null {
  const rule = RULES[input.pest]?.[input.crop]
  if (!rule) return null
  return rule(input)
}

/* ------------------------------------------------------- the form's draft */

/**
 * What the screen holds while somebody is entering a count.
 *
 * Strings, because they come from number inputs and a half-typed "1." has to
 * survive the keystroke. Alongside the count sit the three things the verdict
 * depends on and the pin does not store: the stage, the cost of the pass and
 * the price of the crop.
 */
export type InsectCountDraft = {
  count: string
  stage: PestStage
  costPerHa: string
  pricePerTonne: string
  gradeTarget: boolean
}

/**
 * A blank count.
 *
 * The pass cost is a round $30/ha rather than the middle of Alberta's 1999
 * table, because the table's dollars are 1999 dollars and a custom aerial pass
 * today is nearer thirty than twenty-six. It is an editable starting point, not
 * a figure the app claims to know: nothing in the app records what a pass costs
 * per hectare yet.
 *
 * The price is left to the caller, which knows the crop and can read the
 * year's own price list.
 */
export const EMPTY_INSECT_COUNT: InsectCountDraft = {
  count: '',
  stage: 'late_flower',
  costPerHa: '30',
  pricePerTonne: '',
  gradeTarget: false,
}

/** Canola is priced per bushel on the crop list; the threshold wants tonnes. */
export const CANOLA_BU_PER_TONNE = 44.092

/** A blank count with this year's own price for the crop already in it. */
export function initialInsectCount(pricePerBushel: number | null | undefined): InsectCountDraft {
  const t = pricePerBushel && pricePerBushel > 0 ? Math.round(pricePerBushel * CANOLA_BU_PER_TONNE) : null
  return { ...EMPTY_INSECT_COUNT, pricePerTonne: t ? String(t) : '260' }
}

/**
 * What the pin should store, or null where nothing countable was entered.
 *
 * The unit comes from the pest and crop rather than from the form, so a count
 * can never be saved under the wrong one — which for lygus would be a factor
 * of ten between canola and alfalfa seed.
 */
export function draftToCount(
  draft: InsectCountDraft,
  pest: string,
  cropName: string | null | undefined,
): { count_value: number; count_unit: InsectUnit } | null {
  const unit = unitFor(pest, thresholdCrop(cropName))
  const n = Number(draft.count)
  if (!unit || draft.count.trim() === '' || !Number.isFinite(n) || n < 0) return null
  return { count_value: n, count_unit: unit }
}

/** How the verdict should read and look on screen. */
export const VERDICT_LABEL: Record<Verdict, string> = {
  uncounted: 'Nothing counted yet',
  below: 'Under the threshold',
  at_or_over: 'At or over the threshold',
  wrong_stage: 'Too early to judge',
  none: 'No threshold published',
  do_not_spray: 'Spraying would cost more than it saves',
  not_a_spray: 'Not a spray decision',
}

export const VERDICT_TONE: Record<Verdict, 'good' | 'bad' | 'neutral'> = {
  uncounted: 'neutral',
  below: 'good',
  at_or_over: 'bad',
  wrong_stage: 'neutral',
  none: 'neutral',
  do_not_spray: 'good',
  not_a_spray: 'neutral',
}
