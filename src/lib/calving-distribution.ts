/**
 * What a tighter calving season is worth.
 *
 * A calf born in the first heat cycle is three weeks older at weaning than one
 * born in the second, and three weeks of gain is about forty pounds. So moving
 * calves forward in the calving season is worth money without changing
 * anything else about the herd — that is the whole idea, and this works out
 * how much.
 *
 * Nothing here talks to Supabase, so the page and the tests use the same
 * numbers.
 *
 * ---------------------------------------------------------------------------
 * Modelled on the BCRC's Value of Calving Distribution Calculator, whose
 * spreadsheet was read on 13 Nov 2026. The shape is theirs: four 21-day
 * cycles, each cycle's calf weaned at its own age, the herd's average weaning
 * weight as the share-weighted mean, and the whole thing priced against the
 * current distribution. Three things are done differently:
 *
 *   1. THEIR CYCLE MIDPOINTS ARE TRUNCATED. Cells C32:C35 offset by 10, 31,
 *      52 and 73 days where the middle of each 21-day cycle is 10.5, 31.5,
 *      52.5 and 73.5. The gaps between cycles are right, so the comparison
 *      survives, but every weaning weight comes out about a pound light.
 *      Halves here.
 *
 *   2. NOTHING CHECKS THAT A SCENARIO'S SHARES ADD TO 100%. Type an ideal
 *      distribution of 70/30/10/0 into their sheet and it will cheerfully
 *      price 110% of the herd. Here a scenario that does not add up says so
 *      and is still computed as entered, so the mistake is visible rather
 *      than quietly corrected.
 *
 *   3. THEIR NUMBER IS AN UPPER BOUND AND THEY SAY SO WITHOUT MODELLING IT:
 *      "Costs incurred to achieve a tighter calving season and value from
 *      retaining cows in the herd are not included." That matters, because
 *      the usual way a calving season tightens is that late cows do not breed
 *      back and leave. Their model moves those calves forward and keeps them.
 *      A scenario here can carry `openCows` — cows that end up open getting
 *      there — so the calves they would have had come off the total. Leave it
 *      at nought and you get their figure.
 * ---------------------------------------------------------------------------
 */

const n = (v: unknown): number => {
  const x = Number(v)
  return Number.isFinite(x) ? x : 0
}

/** One heat cycle. The whole model is built on this. */
export const CYCLE_DAYS = 21
export const CYCLES = 4

export const CYCLE_LABELS = ['Days 1–21', 'Days 22–42', 'Days 43–63', 'Day 64+'] as const

/**
 * Days after the first calf of the year that the average calf of cycle `i`
 * (0-based) is born: the middle of its 21-day window.
 */
export const cycleMidpointDays = (i: number): number => i * CYCLE_DAYS + CYCLE_DAYS / 2

/** The 60-25-10-5 the industry aims at. */
export const INDUSTRY_TARGET = [0.6, 0.25, 0.1, 0.05]

/** Three cycles and done — the tight season a condensed breeding gives. */
export const THREE_CYCLES = [0.65, 0.25, 0.1, 0]

export type DistributionInputs = {
  /** The day the first calf hit the ground. */
  firstCalfOn: string | null
  weaningOn: string | null
  birthWeightLb: number
  adgLbPerDay: number
  /** Calves born, by cycle. */
  born: number[]
  /** Calves lost between birth and weaning. */
  calfDeathLoss: number
  salePricePerLb: number
}

export type Scenario = {
  key: string
  label: string
  /** Share of the calf crop in each cycle. Should add to 1. */
  shares: number[]
  /**
   * Cows that end up open getting to this distribution, and so wean no calf.
   * Nought reproduces the BCRC's figure, which assumes every late cow simply
   * calves earlier instead.
   */
  openCows?: number
}

export type ScenarioResult = {
  key: string
  label: string
  shares: number[]
  /** The share-weighted average weaning weight, lb. */
  avgWeaningWeightLb: number
  calvesWeaned: number
  totalLb: number
  value: number
  /** Against the first scenario, which is the farm as it stands. */
  vsBaseline: number
  /** Null when the shares add to 1; the total otherwise. */
  sharesTotal: number | null
}

/** How many days the first calf is old at weaning. */
export function firstCalfAgeDays(i: Pick<DistributionInputs, 'firstCalfOn' | 'weaningOn'>): number | null {
  if (!i.firstCalfOn || !i.weaningOn) return null
  const a = Date.parse(`${i.firstCalfOn.slice(0, 10)}T00:00:00Z`)
  const b = Date.parse(`${i.weaningOn.slice(0, 10)}T00:00:00Z`)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null
  return Math.round((b - a) / 86_400_000)
}

/**
 * What a calf born in each cycle weighs at weaning, lb.
 *
 * Birth weight plus its own age times the daily gain. The first cycle's calf
 * is the oldest because the clock starts at the first calf of the year.
 */
export function cycleWeaningWeights(i: DistributionInputs): number[] | null {
  const age = firstCalfAgeDays(i)
  if (age == null) return null
  return Array.from({ length: CYCLES }, (_, k) => n(i.birthWeightLb) + n(i.adgLbPerDay) * (age - cycleMidpointDays(k)))
}

/** The headline: what one missed cycle costs in weaning weight. */
export const lbPerCycleSlipped = (adgLbPerDay: number) => n(adgLbPerDay) * CYCLE_DAYS

/** The farm's own distribution as shares, from the calves counted in each cycle. */
export function sharesFromCounts(born: number[]): number[] | null {
  const total = born.reduce((a, b) => a + n(b), 0)
  if (!(total > 0)) return null
  return born.map((b) => n(b) / total)
}

const SHARE_TOLERANCE = 0.005

/**
 * Every scenario priced, the first one taken as the farm as it stands.
 *
 * Head count is held constant across scenarios apart from each one's own
 * `openCows`: the point is what the SAME calf crop is worth born earlier.
 */
export function valueOfDistribution(
  i: DistributionInputs,
  scenarios: Scenario[],
): { cycleWeights: number[] | null; lbPerCycle: number; results: ScenarioResult[] } {
  const cycleWeights = cycleWeaningWeights(i)
  const bornTotal = i.born.reduce((a, b) => a + n(b), 0)
  const weanedBase = Math.max(0, bornTotal - n(i.calfDeathLoss))

  const results = scenarios.map((s): ScenarioResult => {
    const total = s.shares.reduce((a, b) => a + n(b), 0)
    const avg = cycleWeights ? s.shares.reduce((a, sh, k) => a + n(sh) * cycleWeights[k], 0) : 0
    const weaned = Math.max(0, weanedBase - n(s.openCows))
    const totalLb = avg * weaned
    return {
      key: s.key,
      label: s.label,
      shares: s.shares,
      avgWeaningWeightLb: avg,
      calvesWeaned: weaned,
      totalLb,
      value: totalLb * n(i.salePricePerLb),
      vsBaseline: 0,
      // Nothing entered is not a typo: a scenario of all zeros is a form
      // waiting to be filled in, and shouting at it would train the warning
      // to be ignored. Only a distribution someone actually typed can be
      // wrong.
      sharesTotal: total === 0 || Math.abs(total - 1) <= SHARE_TOLERANCE ? null : total,
    }
  })

  const baseline = results[0]?.value ?? 0
  for (const r of results) r.vsBaseline = r.value - baseline

  return { cycleWeights, lbPerCycle: lbPerCycleSlipped(i.adgLbPerDay), results }
}

/**
 * How many cows could go open before a tighter season stops paying.
 *
 * The question their sheet cannot ask. A scenario earns more per calf and the
 * same herd weans fewer of them, so there is a number of open cows at which
 * the two cancel — above it, tightening costs money.
 */
export function breakEvenOpenCows(
  i: DistributionInputs,
  baseline: Scenario,
  tighter: Scenario,
): number | null {
  const base = valueOfDistribution(i, [baseline, { ...tighter, openCows: 0 }])
  const [b, t] = base.results
  if (!(t.avgWeaningWeightLb > 0)) return null
  const gain = t.value - b.value
  if (gain <= 0) return 0
  // Each open cow costs one calf at the tighter scenario's average weight.
  const perCow = t.avgWeaningWeightLb * n(i.salePricePerLb)
  return perCow > 0 ? gain / perCow : null
}
