// How a year's rain turns into a year's grass.
//
// Two different relationships get called "rainfall and forage", and keeping
// them apart is the whole point of this file.
//
//   - ACROSS SITES. The Forage Yield Estimator's rows (FORAGE_YIELD_ESTIMATOR
//     in forage-yield.ts) go 460 → 740 → 1,300 → 2,000 lb/ac as the annual
//     zone goes 300 → 400 → 500 → 600 mm. That curve ACCELERATES: +280, then
//     +560, then +700 lb per extra 100 mm. It accelerates because a wetter
//     zone is not just wetter — Brown to Dark Brown to Black Chernozem brings
//     more organic matter, more nitrogen and more heat units with it. The
//     table classifies where you ranch, and it is still the right way to pick
//     the row.
//   - WITHIN ONE SITE, YEAR TO YEAR. Hold the soil still and the same pasture
//     answers a wet year quite differently. That response DECELERATES, and
//     this file models it. A wet year cannot borrow next year's nitrogen.
//
// Multiplying the row by (this year's rain ÷ a normal year's rain) treated the
// second relationship as a straight line through the origin, and a straight
// line through the origin is wrong at both ends:
//
//   - THE DRY END. The first 75-125 mm of a season's moisture grows nothing at
//     all: it goes to soil evaporation and runoff before a plant makes a
//     harvestable leaf. So the grass does not live on the rain, it lives on
//     the rain ABOVE that threshold, and a 10 % shortfall of rain is a bigger
//     than 10 % shortfall of what the grass actually gets. At Home Ranch's
//     289 mm normal season, 10 % less rain is about 12 % less grass; 40 % less
//     rain is about 53 % less grass. The amplification grows as the year gets
//     drier, which is the behaviour the old straight line was missing in
//     exactly the years it mattered.
//   - THE WET END. Once moisture stops being the limiting factor, growth runs
//     into a ceiling set by soil nitrogen, heat units and the plants
//     themselves. On unfertilized pasture the extra rain past roughly
//     500-550 mm largely leaches through. The straight line had a 160 % year
//     growing 160 % of the grass, which no unfertilized pasture does.
//
// The model is the Mitscherlich diminishing-returns curve, the standard form
// for this: Y = Ymax × (1 − e^(−c(P − P₀))). Used as a RATIO against a normal
// year, Ymax cancels — which is what makes it safe to bolt onto the estimator
// without having to know any pasture's absolute ceiling. The pasture's ceiling
// is already in the row the table picked.
//
// Sources Sam brought on 12 Nov 2026: the zero-yield threshold and the
// nutrient ceiling as above; BCRC's Carrying Capacity Calculator for the zone
// yields; and the Western Canadian seasonal split (April-June decides 50-80 %
// of a year's forage, July-August under 20 %), which is why rain is weighted
// by when it fell before any of this is applied.

/**
 * The season's first millimetres, which grow nothing.
 *
 * Soil evaporation and runoff take the first 75-125 mm before there is any
 * harvestable biomass; 100 mm is the middle of that range and the figure the
 * BCRC-style rules of thumb use (4 inches). Everything above it is what the
 * grass is actually living on.
 */
export const ZERO_YIELD_MM = 100

/**
 * Curvature of the response, per mm.
 *
 * The usual range is 0.0035 to 0.005. The gentler end is right here: these are
 * unfertilized Brown-zone pastures on a 289 mm normal season, nowhere near the
 * ceiling in an ordinary year, so most of the curve they ever see is the part
 * where rain still pays. A steeper constant would flatten a good year into a
 * normal one.
 */
export const RESPONSE_C = 0.0035

/**
 * The most a wet year can add: 130 % of a normal year's grass.
 *
 * Without nitrogen the pasture cannot use more than that however it rains —
 * 125 % to 135 % is the usual cap, and the curve on its own would still let a
 * very wet year drift past it. If the pasture is fertilized the cap is the
 * wrong model and the number wants raising deliberately, not by accident.
 */
export const WET_YEAR_CAP = 1.3

/**
 * The share of the year's growth that a season's moisture buys, 0 to 1.
 *
 * Only meaningful against another call of itself: the absolute value depends
 * on a pasture's own ceiling, which this does not know and does not need to.
 */
export function growthResponse(mm: number): number {
  const above = Math.max(0, (Number.isFinite(mm) ? mm : 0) - ZERO_YIELD_MM)
  return 1 - Math.exp(-RESPONSE_C * above)
}

/**
 * What this season does to the zone's yield: the multiplier on the estimator's
 * row.
 *
 * 1 in a normal year by construction, under 1 in a dry one by more than the
 * rain fell short, over 1 in a wet one by less than the rain came up — and
 * never over WET_YEAR_CAP. Floored at nothing; 1 when there is nothing to
 * compare against, so the row stands alone.
 */
export function seasonYieldFactor(seasonMm: number, normalSeasonMm: number): number {
  const base = growthResponse(normalSeasonMm)
  if (!(base > 0) || !Number.isFinite(seasonMm)) return 1
  return Math.max(0, Math.min(WET_YEAR_CAP, growthResponse(seasonMm) / base))
}

/**
 * How much each part of the year's rain counts toward this year's grass.
 *
 * April to June decides 50-80 % of a year's forage in Western Canada; July and
 * August under 20 %, because by then the cool-season grasses have gone from
 * growing leaf to making seed and extra rain largely goes past them. The rain
 * before the season — the previous autumn and the winter, as stored soil
 * moisture — is what the first flush of spring growth is drawn on, and counts
 * for about a third.
 *
 * September and October rain is in no bucket. It falls after the grass has
 * finished for the year, so it makes none of THIS year's forage; it becomes
 * next year's carryover instead, where it is counted once.
 */
export const RAIN_WEIGHTS = { carryover: 0.35, spring: 0.5, summer: 0.15 } as const

/** The months each weight covers. Carryover is the previous Sept through March. */
export const CARRYOVER_MONTHS = [9, 10, 11, 12, 1, 2, 3]
export const SPRING_MONTHS = [4, 5, 6]
export const SUMMER_MONTHS = [7, 8]

/** A year's rain split into the three parts the weights apply to, mm. */
export type RainSplit = { carryoverMm: number; springMm: number; summerMm: number }

const weigh = (s: RainSplit) =>
  RAIN_WEIGHTS.carryover * s.carryoverMm + RAIN_WEIGHTS.spring * s.springMm + RAIN_WEIGHTS.summer * s.summerMm

/**
 * This season's rain in growing-season-equivalent millimetres: what the grass
 * can make use of, not what the gauge collected.
 *
 * The weights are relative, so the weighted sum is rescaled to put a NORMAL
 * year back on exactly its own season total. That has two consequences worth
 * saying out loud. The scale stays real millimetres, so ZERO_YIELD_MM still
 * means 100 mm of rain rather than 100 units of something. And a year whose
 * rain was distributed normally comes out at its own total, so this only ever
 * moves a year by how its rain was spread differently from usual: 150 mm in
 * May is a different year from 150 mm in August, and now reads as one.
 *
 * NaN when the normals are not there to rescale against — callers fall back to
 * the plain season total rather than invent a distribution.
 */
export function effectiveSeasonMm(year: RainSplit, normal: RainSplit, normalSeasonMm: number): number {
  const base = weigh(normal)
  if (!(base > 0) || !(normalSeasonMm > 0)) return NaN
  return (weigh(year) * normalSeasonMm) / base
}

/** Sum the daily rain of the given months within a year, mm. */
export function sumMonths(daily: { t: string; mm: number }[], year: number, months: number[]): number {
  let n = 0
  for (const d of daily) {
    if (Number(d.t.slice(0, 4)) !== year) continue
    if (months.includes(Number(d.t.slice(5, 7)))) n += d.mm ?? 0
  }
  return Math.round(n * 10) / 10
}

/**
 * Take half, leave half: the rate for a ranch that has not set its own.
 *
 * Native range, not irrigated tame pasture under rotation. The other half is
 * not spare — it is the leaf a plant rebuilds its roots from and the litter
 * that keeps the next rain in the soil. The BCRC's own calculators use 25-50 %
 * for native range; this is the top of that, and Sam set both ranches here
 * on 12 Nov 2026, down from 80 %.
 *
 * The grass a cow tramples and fouls is counted separately, on the animal-unit
 * day itself (grazing_count_waste), so this rate is not carrying that too.
 */
export const DEFAULT_UTILIZATION = 0.5

/**
 * A season factor at or below this is a drought year as far as stocking goes.
 *
 * A fifth under normal. Not a cliff: see droughtUtilization.
 */
export const DROUGHT_FACTOR = 0.8

/** Where the slide ends: half a normal year's grass or worse. */
export const DROUGHT_FLOOR_FACTOR = 0.5

/**
 * How much of the standing forage to take in a bad year, at the floor.
 *
 * The rule of thumb is "half in a normal year, a third in a drought". A ranch
 * that takes more than half normally gets the same CUT rather than the same
 * number — two thirds of its own rate — because dropping a pasture run at 80 %
 * straight to 33 % is a different decision from the one the rule describes,
 * and not one arithmetic should make on its own.
 */
export const DROUGHT_UTILIZATION = 0.33
export const DROUGHT_CUT = 0.66

/**
 * Take less in a dry year.
 *
 * Grazing a drought-stressed plant to the usual half leaves it without the
 * leaf area to rebuild its roots, and the pasture comes back worse NEXT year
 * however that year rains — the one cost in this model that outlives the
 * season causing it. So the take-half rule slides down toward a third as the
 * year goes from a fifth under normal to half of normal.
 *
 * It only ever lowers the rate. A ranch already grazing lighter than the
 * drought rate keeps its own number, and a wet year changes nothing: taking
 * MORE in a good year is a decision for a person, not an arithmetic default.
 */
export function droughtUtilization(base: number, factor: number): number {
  if (!Number.isFinite(factor) || !Number.isFinite(base) || factor >= DROUGHT_FACTOR) return base
  const span = DROUGHT_FACTOR - DROUGHT_FLOOR_FACTOR
  const t = Math.min(1, Math.max(0, (DROUGHT_FACTOR - factor) / span))
  const target = Math.min(base, Math.max(DROUGHT_UTILIZATION, base * DROUGHT_CUT))
  return base + (target - base) * t
}
