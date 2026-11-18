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
  // Weaning on or before the first calf has no weights to give: the sum
  // below would read out a calf of minus 160 lb as if it meant something.
  if (age == null || age <= 0) return null
  return Array.from({ length: CYCLES }, (_, k) => n(i.birthWeightLb) + n(i.adgLbPerDay) * (age - cycleMidpointDays(k)))
}

/**
 * What stops the inputs being priced at all, as short sentences for the page.
 * Empty when they can be. Nothing here is a matter of judgement — a calf
 * cannot be weaned before it is born, and a cycle cannot have minus fifty
 * calves — so the page shows these instead of the table, not beside it.
 */
export function distributionProblems(i: DistributionInputs): string[] {
  const out: string[] = []
  const negative = CYCLE_LABELS.filter((_, k) => n(i.born[k]) < 0)
  if (negative.length) out.push(`Calves born can’t be negative (${negative.join(', ')}).`)
  const age = firstCalfAgeDays(i)
  if (age != null && age <= 0) out.push('Weaning day is on or before the first calf. Set it after the first calf is born.')
  else if (age != null) {
    // The latest cycle that has calves in it must be born before weaning.
    const last = i.born.reduce((a, b, k) => (n(b) > 0 ? k : a), -1)
    if (last > 0 && age <= cycleMidpointDays(last)) out.push(`Weaning day comes before the calves of ${CYCLE_LABELS[last]} are born.`)
  }
  if (n(i.calfDeathLoss) < 0) out.push('Calves lost to weaning can’t be negative.')
  else {
    const born = i.born.reduce((a, b) => a + Math.max(0, n(b)), 0)
    if (born > 0 && n(i.calfDeathLoss) > born) out.push('More calves lost than were born.')
  }
  if (n(i.birthWeightLb) < 0 || n(i.adgLbPerDay) < 0) out.push('Birth weight and daily gain can’t be negative.')
  if (n(i.salePricePerLb) < 0) out.push('Calf price can’t be negative.')
  return out
}

/**
 * The calf price to start from: the Markets tab's own steer and heifer prices
 * at the ranch's sale weights (useCalfMoney), averaged — half the calf crop
 * is each. One of them alone when the other has no recent sale; null when
 * neither has, so the page asks for a price rather than inventing one. It
 * used to start at a fixed $3.40/lb while the heifer and market pages read
 * this week's auctions.
 */
export function marketCalfPricePerLb(steersPerLb: number | null | undefined, heifersPerLb: number | null | undefined): number | null {
  const got = [steersPerLb, heifersPerLb].filter((v): v is number => v != null && Number.isFinite(v) && v > 0)
  if (!got.length) return null
  return got.reduce((a, b) => a + b, 0) / got.length
}

/** The headline: what one missed cycle costs in weaning weight. */
export const lbPerCycleSlipped = (adgLbPerDay: number) => n(adgLbPerDay) * CYCLE_DAYS

/** The farm's own distribution as shares, from the calves counted in each cycle. */
export function sharesFromCounts(born: number[]): number[] | null {
  // A negative count would make the others' shares add past 100% (or below
  // nought) — it is refused, not rounded to a quiet 0%.
  if (born.some((b) => n(b) < 0)) return null
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
