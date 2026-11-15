/**
 * What grows back behind the cattle (Sam, 12 Nov 2026).
 *
 * The fence calculator counted a paddock's grass once and stopped: a strip
 * grazed in May and walked past again in July was credited with nothing the
 * second time. This works out the second time, from the four things Sam
 * named — when it was grazed, what it has rained since, how hard it was taken,
 * and how much was standing to begin with.
 *
 * Four terms, each with a source, in the order they apply:
 *
 *  1. THE SEASON. Grass here grows on spring moisture and is finished by
 *     August, so what can regrow is only the share of the year's growth still
 *     to come: `growthToCome(from, to)`. Graze on 1 June and the curve has
 *     about half the year left; graze on 1 September and it has none, whatever
 *     the rain does. The curve is the one the move-out check already uses
 *     (pasture-move.ts GROWTH_BY_MONTH), read day by day rather than by month.
 *
 *  2. THE LAG. Crider, USDA Technical Bulletin 1102, *Root-Growth Stoppage
 *     Resulting from Defoliation of Grass* (1955): take 40 % or less of the
 *     leaf and no roots stop growing at all; take 90 % and all of them stop.
 *     When more than half is taken, root growth stops for 6 to 18 days,
 *     averaging 11. So a hard-grazed strip loses days off the front of its
 *     recovery — which is why a hard take in late July regrows nothing: the
 *     lag eats what is left of the season.
 *
 *  3. THE RAIN since it was grazed, against the long-term average for the same
 *     stretch of the calendar (`rainFactor`). The same quantity the Grazing
 *     tab scales a season by, measured over this window instead of the season.
 *
 *  4. VIGOUR. A hard-grazed plant does not merely start late, it grows slower
 *     once it starts. The only figure we have for this is the USDA CEAP
 *     synthesis *Responses of Plant Communities to Grazing in the Southwestern
 *     United States* (2006): sites grazed over 50 % utilisation produced 58 %
 *     of what ungrazed sites produced. That is annual production under
 *     season-long heavy use, not a second pass, so it is the softest number
 *     here — see VIGOUR_AT_FULL_TAKE.
 *
 * What it does NOT model: species (bunch grasses recover quicker than sod
 * formers), soil moisture carried over from last fall, and the year after.
 * Bai et al. found a single defoliation in May or June in Saskatchewan's
 * northern mixed prairie warrants a year of rest — this says nothing about
 * next year, only about coming back round this one.
 *
 * Everything here is pure and in lb/acre of GROSS standing forage: the
 * utilisation rate is applied by the caller, once, so it is never taken off
 * twice.
 */

/** Days a year's growth is spread over, as cumulative share by day of the year. */
type Anchor = { md: string; share: number }

/**
 * Cumulative share of a season's growth standing on a date.
 *
 * The same figures as pasture-move.ts GROWTH_BY_MONTH — southern Alberta mixed
 * grass: growth starts in April, most of it comes in May and June on spring
 * moisture, it slows in July and has stopped by the end of August. That
 * function reads them by month on purpose, so a figure on screen does not
 * creep day by day. Regrowth has to be read day by day — a strip grazed on
 * 2 June and one grazed on 29 June do not have the same year left — so the
 * same anchors are drawn as a line here. They agree at every month end.
 */
const GROWTH_ANCHORS: Anchor[] = [
  { md: '03-31', share: 0 },
  { md: '04-30', share: 0.05 },
  { md: '05-31', share: 0.3 },
  { md: '06-30', share: 0.75 },
  { md: '07-31', share: 0.95 },
  { md: '08-31', share: 1 },
]

const DAY_MS = 86_400_000
const dayOfYear = (iso: string) => {
  const y = Number(iso.slice(0, 4))
  return Math.round((Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) - Date.UTC(y, 0, 1)) / DAY_MS)
}
const anchorDay = (iso: string, md: string) => dayOfYear(`${iso.slice(0, 4)}-${md}`)

/**
 * Share of this year's growth that has happened by `iso`, 0 to 1.
 *
 * Before April it is 0: January to March is last season's grass standing, and
 * nothing is being added. (pasture-move.ts reads those months as 1 instead,
 * because it is asking how much of the year's grass is THERE, not how much is
 * still to come. Two different questions off one curve.)
 */
export function seasonGrowthAt(iso: string): number {
  const d = dayOfYear(iso)
  const first = anchorDay(iso, GROWTH_ANCHORS[0].md)
  if (d <= first) return 0
  for (let i = 1; i < GROWTH_ANCHORS.length; i++) {
    const x1 = anchorDay(iso, GROWTH_ANCHORS[i].md)
    if (d <= x1) {
      const x0 = anchorDay(iso, GROWTH_ANCHORS[i - 1].md)
      const y0 = GROWTH_ANCHORS[i - 1].share
      const y1 = GROWTH_ANCHORS[i].share
      return y0 + ((y1 - y0) * (d - x0)) / (x1 - x0)
    }
  }
  return 1
}

/** Share of a year's growth still to come between two dates; 0 when `to` is not after `from`. */
export function growthToCome(from: string, to: string): number {
  if (to <= from) return 0
  // Across a new year the curve restarts: a strip grazed in September and
  // revisited in June gets next spring's growth, not a slice of this one.
  const years = Number(to.slice(0, 4)) - Number(from.slice(0, 4))
  if (years > 0) return Math.max(0, 1 - seasonGrowthAt(from)) + Math.max(0, years - 1) + seasonGrowthAt(to)
  return Math.max(0, seasonGrowthAt(to) - seasonGrowthAt(from))
}

/** Below this share of the leaf taken, Crider found no root growth stopped at all. */
export const CRIDER_SAFE_TAKE = 0.4
/** At this share taken, all of it stopped. */
export const CRIDER_TOTAL_TAKE = 0.9
/** Crider's average stoppage when more than half the leaf is taken, in days (his range is 6–18). */
export const CRIDER_LAG_DAYS = 11

/**
 * Share of roots whose growth stops, for a given share of the leaf taken.
 *
 * A straight line between the two figures Crider reported and we could check —
 * nothing stops at 40 %, everything stops at 90 %. His bulletin has a row for
 * each ten per cent in between; those were not to hand, so this does not
 * pretend to them.
 */
export function rootsStoppedShare(takePct: number): number {
  const t = Math.min(1, Math.max(0, takePct))
  if (t <= CRIDER_SAFE_TAKE) return 0
  if (t >= CRIDER_TOTAL_TAKE) return 1
  return (t - CRIDER_SAFE_TAKE) / (CRIDER_TOTAL_TAKE - CRIDER_SAFE_TAKE)
}

/** Days before the grass starts growing again, from how hard it was taken. */
export function regrowthLagDays(takePct: number): number {
  return CRIDER_LAG_DAYS * rootsStoppedShare(takePct)
}

/**
 * What a plant grazed to the ground manages against one that was not.
 *
 * USDA CEAP 2006: over 50 % utilisation, sites produced 58 % of ungrazed ones.
 * Applied here from no penalty at Crider's safe take to this at a total one.
 * The softest number in the file — it is an annual-production figure being
 * read as a regrowth rate, and the satellite's own regrowth slope
 * (pasture_rotation_order.regrowth_per_day) is the thing that will eventually
 * replace it with something measured here.
 */
export const VIGOUR_AT_FULL_TAKE = 0.58

export function vigourAfterGrazing(takePct: number): number {
  const t = Math.min(1, Math.max(0, takePct))
  if (t <= CRIDER_SAFE_TAKE) return 1
  const over = (t - CRIDER_SAFE_TAKE) / (1 - CRIDER_SAFE_TAKE)
  return 1 - over * (1 - VIGOUR_AT_FULL_TAKE)
}

export type RegrowthInput = {
  /** The paddock's whole-season growth, lb an acre, BEFORE the utilisation rate. */
  seasonPotentialLb: number
  /** The day the cattle took it. */
  grazedOn: string
  /** The day they come back round to it. */
  backOn: string
  /** Share of the standing grass the cattle took, 0–1 (the ranch's utilisation rate). */
  takePct: number
  /** This stretch of weather against its long-term average; 1 when nothing is known. */
  rainFactor?: number
}

export type Regrowth = {
  /** Standing when the cattle went in, lb an acre: the season potential grown to that date. */
  standingLb: number
  removedLb: number
  residualLb: number
  takePct: number
  rootsStopped: number
  lagDays: number
  vigour: number
  /** The day growth starts again. */
  growingFrom: string
  /** Share of the year's growth still to come over the rest period, after the lag. */
  shareToCome: number
  /** What grows back, lb an acre, gross. */
  regrowthLb: number
  /** Residual plus regrowth: what is standing when they come back. */
  standingBackLb: number
  /** Days the paddock rested. */
  restDays: number
}

const addDays = (iso: string, n: number) =>
  new Date(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) + Math.round(n) * DAY_MS).toISOString().slice(0, 10)

export function regrowth(i: RegrowthInput): Regrowth {
  const potential = Math.max(0, i.seasonPotentialLb)
  const rain = i.rainFactor != null && Number.isFinite(i.rainFactor) ? Math.max(0, i.rainFactor) : 1
  const take = Math.min(1, Math.max(0, i.takePct))
  // What had actually grown by the day they went in — in June the year is not
  // finished growing, so the standing crop is not the season's whole figure.
  const standingLb = potential * seasonGrowthAt(i.grazedOn) * rain
  const removedLb = standingLb * take
  const rootsStopped = rootsStoppedShare(take)
  const lagDays = regrowthLagDays(take)
  const vigour = vigourAfterGrazing(take)
  const growingFrom = addDays(i.grazedOn, lagDays)
  const shareToCome = growthToCome(growingFrom, i.backOn)
  const regrowthLb = potential * shareToCome * rain * vigour
  const restDays = Math.max(0, Math.round((Date.parse(`${i.backOn.slice(0, 10)}T00:00:00Z`) - Date.parse(`${i.grazedOn.slice(0, 10)}T00:00:00Z`)) / DAY_MS))
  return {
    standingLb,
    removedLb,
    residualLb: standingLb - removedLb,
    takePct: take,
    rootsStopped,
    lagDays,
    vigour,
    growingFrom,
    shareToCome,
    regrowthLb,
    standingBackLb: standingLb - removedLb + regrowthLb,
    restDays,
  }
}

/**
 * This year's rain over a stretch of the calendar against the long-term
 * average for the same stretch.
 *
 * `series` is this year's daily rain and `cumulative` the average running
 * total by month-day (rain-normals.ts SeasonNormal). Past the last measured
 * day the weather is assumed normal, which is what `rainOutlook` does for the
 * season as a whole — so planning a move three weeks out reads 1 for the part
 * that has not happened rather than 0.
 */
export function windowRainFactor(
  series: { t: string; mm: number }[],
  cumulative: { md: string; mm: number }[] | null | undefined,
  from: string,
  to: string,
): number {
  if (!cumulative?.length || to <= from) return 1
  const at = (md: string) => {
    let last = 0
    for (const c of cumulative) {
      if (c.md > md) break
      last = c.mm
    }
    return last
  }
  const normal = at(to.slice(5, 10)) - at(from.slice(5, 10))
  if (!(normal > 0)) return 1
  const measuredThrough = series.length ? series[series.length - 1].t.slice(0, 10) : from
  const end = to < measuredThrough ? to : measuredThrough
  if (end <= from) return 1
  const fell = series.reduce((a, d) => (d.t.slice(0, 10) > from && d.t.slice(0, 10) <= end ? a + d.mm : a), 0)
  // The stretch that has not happened yet is credited at the average.
  const unmeasured = Math.max(0, at(to.slice(5, 10)) - at(end.slice(5, 10)))
  return Math.max(0, (fell + unmeasured) / normal)
}
