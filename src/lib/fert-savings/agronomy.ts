/**
 * The agronomy the savings tools lean on, in one place and in the open.
 *
 * Every figure here is a published average or a stated assumption, not a
 * measurement of this farm; each is labelled on screen as such, and the
 * ones a person might reasonably disagree with are settings rather than
 * constants. Where the farm's own numbers exist — a soil test, a yield, an
 * invoice — they are used instead.
 *
 * Revised 26 Sep 2026 against the fertilizer research doc: removal from the
 * 2020–22 Western Canada uptake survey (USask 2023) and Alberta Agdex tables,
 * legume credits from Saskatchewan/Manitoba/NDSU, the check yield from
 * Alberta's irrigated N curves (see alberta.ts).
 */
import { checkFractionFromCurve, cropKind } from './alberta'

/**
 * Nutrients carried off in the harvested part of the crop, per unit of yield.
 * Units follow the crop's yield unit: bushels for grain, cwt for dry beans and
 * potatoes, tons of dry matter for hay and forage. Order matters: the first
 * match wins, so the specific rows come before the general ones.
 */
export const REMOVAL: { match: RegExp; unit: 'bu' | 'cwt' | 'lb' | 'ton'; n: number; p2o5: number; k2o: number; s: number; note?: string }[] = [
  { match: /canola/i, unit: 'bu', n: 1.68, p2o5: 0.67, k2o: 0.35, s: 0.4, note: 'USask 2023 survey; S from the literature (0.4), not the survey’s 0.19' },
  { match: /durum/i, unit: 'bu', n: 1.64, p2o5: 0.5, k2o: 0.3, s: 0.1 },
  // Not buckwheat.
  { match: /^(?!.*buckwheat).*wheat/i, unit: 'bu', n: 1.38, p2o5: 0.49, k2o: 0.31, s: 0.1 },
  // Silage and green feed leave with the whole plant, straw K and all.
  { match: /silage|green feed/i, unit: 'ton', n: 42, p2o5: 13, k2o: 36, s: 5, note: 'Whole-plant cereal forage, per ton DM, from 140 bu barley taking up 210 N / 65 P2O5 / 180 K2O / 26 S' },
  { match: /barley/i, unit: 'bu', n: 0.86, p2o5: 0.36, k2o: 0.26, s: 0.07 },
  { match: /oat/i, unit: 'bu', n: 0.62, p2o5: 0.25, k2o: 0.19, s: 0.06 },
  { match: /triticale|\brye\b/i, unit: 'bu', n: 1.1, p2o5: 0.45, k2o: 0.3, s: 0.08 },
  { match: /corn/i, unit: 'bu', n: 0.94, p2o5: 0.36, k2o: 0.23, s: 0.053, note: 'At 15.5% moisture; survey median N 0.72' },
  { match: /soy/i, unit: 'bu', n: 3.3, p2o5: 0.75, k2o: 1.2, s: 0.18 },
  { match: /faba/i, unit: 'bu', n: 2.7, p2o5: 0.67, k2o: 0.83, s: 0.12 },
  { match: /pea|lentil/i, unit: 'bu', n: 2.3, p2o5: 0.7, k2o: 0.7, s: 0.12 },
  { match: /bean/i, unit: 'cwt', n: 3.32, p2o5: 1.02, k2o: 1.55, s: 0.2 },
  { match: /alfalfa seed|seed alfalfa/i, unit: 'lb', n: 0.06, p2o5: 0.015, k2o: 0.015, s: 0.003 },
  { match: /alfalfa|sainfoin/i, unit: 'ton', n: 50, p2o5: 12.5, k2o: 60, s: 6, note: 'Per ton DM; Agdex 561-18 gives 10–15 P2O5 and 50–65 K2O' },
  { match: /hay|grass|fescue|timothy/i, unit: 'ton', n: 40, p2o5: 13, k2o: 50, s: 5 },
  { match: /potato/i, unit: 'cwt', n: 0.31, p2o5: 0.15, k2o: 0.63, s: 0.03, note: 'Agdex 542-9' },
  { match: /carrot/i, unit: 'cwt', n: 0.2, p2o5: 0.08, k2o: 0.35, s: 0.02, note: 'Search snippet only (UC Davis); no Alberta data' },
]

export function removalFor(cropName: string | null | undefined) {
  if (!cropName) return null
  // Alfalfa seed is checked before alfalfa hay by order.
  return REMOVAL.find((r) => r.match.test(cropName)) ?? null
}

/**
 * Convert a recorded yield into the removal table's unit.
 *
 * Alfalfa is recorded in lbs and its removal is per ton; returning nothing
 * there used to drop the farm's biggest potash user out of every balance.
 */
export function yieldInRemovalUnit(value: number, unit: string | null | undefined, removalUnit: string): number | null {
  const u = (unit ?? '').toLowerCase().trim()
  const isBu = u.includes('bu') || u === ''
  const isCwt = u.includes('cwt')
  const isTon = u === 'ton' || u === 'tons' || u.includes('ton') || u === 't' || u === 't/ac'
  const isMt = u === 'mt' || u.includes('tonne')
  const isLb = u.includes('lb')
  if (removalUnit === 'bu') return isBu ? value : null
  if (removalUnit === 'cwt') {
    if (isCwt) return value
    if (isLb) return value / 100
    if (isMt) return (value * 2204.62262) / 100
    if (isTon) return value * 20
    return null
  }
  if (removalUnit === 'ton') {
    if (isTon && !isMt) return value
    if (isMt) return value * 1.10231
    if (isLb) return value / 2000
    if (isCwt) return value / 20
    return null
  }
  if (removalUnit === 'lb') {
    if (isLb) return value
    if (isCwt) return value * 100
    return null
  }
  return null
}

/**
 * Nitrogen the previous crop leaves for the next one, lb N/ac: year 1 after
 * it, and year 2 (only forage legumes carry on).
 *
 * Alfalfa: Saskatchewan's irrigated work found the first cereal after broken
 * alfalfa needed "little" N and the second two-thirds of normal; NDSU credits
 * 150 / 100 / 50 lb by stand density, half again in year 2. With no stand
 * density on record, the middle figure. Peas 20 (Manitoba 25, Saskatchewan
 * about 15). Beans and soybeans 10 or less.
 */
export const LEGUME_CREDIT: { match: RegExp; lbN: number; year2: number; label: string; inNitrateTest: number }[] = [
  // inNitrateTest: the share a spring or fall nitrate test taken after the
  // crop already holds. Pulse N is mostly there; alfalfa keeps releasing N
  // from roots and crowns after the sample, so only half of it is.
  { match: /alfalfa|sainfoin|clover/i, lbN: 100, year2: 50, label: 'forage legume stand', inNitrateTest: 0.5 },
  { match: /faba/i, lbN: 20, year2: 0, label: 'faba bean stubble', inNitrateTest: 1 },
  { match: /pea/i, lbN: 20, year2: 0, label: 'pea stubble', inNitrateTest: 1 },
  { match: /lentil/i, lbN: 15, year2: 0, label: 'lentil stubble', inNitrateTest: 1 },
  { match: /soy/i, lbN: 10, year2: 0, label: 'soybean stubble', inNitrateTest: 1 },
  { match: /bean/i, lbN: 10, year2: 0, label: 'dry bean stubble', inNitrateTest: 1 },
]

export function legumeCredit(priorCrop: string | null | undefined) {
  if (!priorCrop) return null
  return LEGUME_CREDIT.find((l) => l.match.test(priorCrop)) ?? null
}

/**
 * The legume credit still owed once the soil test is counted, lb N/ac.
 *
 * A nitrate test taken after the legume already holds most of a pulse credit,
 * so counting both is counting it twice. `tested` says whether this season's
 * test was taken after the legume came off.
 */
export function legumeCreditAfterTest(args: { lastYear: string | null | undefined; twoYearsBack?: string | null; tested: boolean }): { lbN: number; label: string | null } {
  const y1 = legumeCredit(args.lastYear)
  const y2 = legumeCredit(args.twoYearsBack)
  const fromY1 = y1 ? y1.lbN * (args.tested ? 1 - y1.inNitrateTest : 1) : 0
  const fromY2 = y2 && y2.year2 > 0 ? y2.year2 : 0
  const label = y1 ? y1.label : y2 && y2.year2 > 0 ? `${y2.label}, second year` : null
  return { lbN: Math.round(fromY1 + fromY2), label }
}

/**
 * Share of a full yield the crop makes with no fertilizer N — the "check
 * yield" in a nitrogen trial.
 *
 * For crops with an Alberta curve it is read off the curve at the field's own
 * soil nitrate (46% of top at 50 lb soil N, 79% at 100, for CWRS). One fixed
 * figure per crop could not be right at both. The fixed figures remain only
 * for crops without a curve, and a setting overrides either.
 */
export const CHECK_YIELD_FRACTION: { match: RegExp; fraction: number }[] = [
  { match: /canola/i, fraction: 0.55 },
  { match: /corn/i, fraction: 0.5 },
  { match: /durum|wheat|barley|oat|triticale/i, fraction: 0.6 },
  { match: /potato/i, fraction: 0.55 },
]

export function checkFractionFor(crop: string | null | undefined, override?: number | null, soilN?: number | null): number | null {
  if (override != null && override > 0 && override < 1) return override
  if (!crop) return null
  if (soilN != null && soilN >= 0) {
    const fromCurve = checkFractionFromCurve(cropKind(crop), soilN)
    if (fromCurve != null) return Math.min(0.95, fromCurve)
  }
  return CHECK_YIELD_FRACTION.find((c) => c.match.test(crop))?.fraction ?? null
}

/**
 * The nitrogen rate that pays best, given what N and the crop are worth.
 *
 * The response is taken as a quadratic that tops out at the recommended
 * rate R, starting from the check yield f·Y at zero N. The last pound up to
 * R adds almost nothing, so when nitrogen is dear against the crop the
 * profitable rate sits below R by
 *
 *     R − N* = ratio · R² / (2 · (1 − f) · Y)
 *
 * where ratio is $/lb N ÷ $/unit of crop. At zero ratio N* is R.
 *
 * Only for crops without an Alberta curve, and only when R is the rate for
 * top yield. A rate already worked out at the price ratio (every rate from
 * alberta.ts) must not be trimmed again, which is what `alreadyEconomic` is for.
 */
export function economicNRate(args: {
  recN: number
  yieldGoal: number
  checkFraction: number
  nPerLb: number
  cropPerUnit: number
  alreadyEconomic?: boolean
}): { rate: number; cut: number; ratio: number } | null {
  const { recN, yieldGoal, checkFraction, nPerLb, cropPerUnit } = args
  if (!(recN > 0) || !(yieldGoal > 0) || !(cropPerUnit > 0) || !(nPerLb > 0)) return null
  if (!(checkFraction > 0 && checkFraction < 1)) return null
  const ratio = nPerLb / cropPerUnit
  if (args.alreadyEconomic) return { rate: recN, cut: 0, ratio }
  const cut = (ratio * recN * recN) / (2 * (1 - checkFraction) * yieldGoal)
  const rate = Math.max(0, recN - cut)
  return { rate, cut: recN - rate, ratio }
}

/**
 * How likely nitrogen is to be lost before the crop can use it.
 *
 * Coarse soils leach, and irrigation adds the water to do it. Fine soils do
 * not leach but, wet and warm under a pivot, they denitrify: 2–4 lb N/ac a day
 * in waterlogged soil above 15 °C (Manitoba). Fall and surface-broadcast N sit
 * exposed longest; spring banding is the safest (Agdex 100/541-1: spring band
 * 115 against fall broadcast 90).
 */
export type LossRisk = 'high' | 'moderate' | 'low'

export function nitrogenLossRisk(
  texture: string | null | undefined,
  irrigated: boolean,
  opts: { fall?: boolean; surface?: boolean; ponds?: boolean } = {},
): { risk: LossRisk; reasons: string[] } {
  const t = (texture ?? '').toLowerCase()
  const reasons: string[] = []
  let score = 0
  const fine = /clay|silt/.test(t)
  if (/(^|[^a-z])sand([^a-z]|$)|loamy sand/.test(t)) {
    score += 2
    reasons.push(`${texture} leaches`)
  } else if (/sandy loam/.test(t)) {
    score += 1
    reasons.push('sandy loam drains fast')
  } else if (fine && irrigated) {
    // Named, not scored: coated urea does little against denitrification;
    // a nitrification inhibitor or not over-watering does.
    reasons.push(`${texture} under a pivot can waterlog and denitrify, 2–4 lb N/ac a day when warm`)
  } else if (t) {
    reasons.push(`${texture} holds nitrogen against leaching`)
  } else {
    reasons.push('soil texture not recorded')
  }
  if (irrigated) {
    score += 1
    reasons.push('irrigated, so there is water to move it')
  }
  if (opts.ponds) {
    score += 1
    reasons.push('low spots that pond lose N to denitrification')
  }
  if (opts.fall) {
    score += 1
    reasons.push('fall-applied N sits through the winter and spring melt')
  }
  if (opts.surface) {
    score += 1
    reasons.push('surface urea can volatilize before it is rained or worked in')
  }
  return { risk: score >= 2 ? 'high' : score === 1 ? 'moderate' : 'low', reasons }
}
