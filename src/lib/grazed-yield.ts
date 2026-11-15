import { mobClass } from './pasture-move'

/**
 * What the cattle have actually taken off this ranch, as a check on what the
 * forage table says it grows — and, where the table is low, as the figure that
 * replaces it.
 *
 * Sam, 13 Nov 2026, on a Grazing tab reading 156 cows over: "in the past we
 * have easily been able to run this size of herd or bigger... we should be
 * able to increase our herd size by 50 head over the ranch not have to drop it
 * by 140 animals." He was right, and the collars prove it: the Home Ranch
 * mobs took about 84,000 animal-unit days off ground the model says holds
 * 62,000, and left grass standing.
 *
 * Three things had pushed the estimate down, and only this one can be measured
 * rather than argued about:
 *
 *   - the precipitation zone moved from 379 mm measured to 300 mm off the soil
 *     map, dropping the ranch a whole row of the estimator;
 *   - the grass rating is RELATIVE (a paddock against its ranch's median), and
 *     the estimator reads those words as absolute pounds, so the median paddock
 *     is pinned at "Fair" however good the ranch is;
 *   - "the average is around fair" was a fair statement about one ranch's
 *     paddocks relative to each other, and it ended up setting the pounds.
 *
 * So the rating keeps the job it is good at — which paddock is better than
 * which — and this supplies the part it never could: the absolute level, from
 * the only instrument on the farm that measures it, which is the cattle.
 *
 * WHAT THIS IS NOT. A grazing record is a FLOOR, not a ceiling. It says what
 * the grass carried, not what it could have carried, and a paddock nobody put
 * cattle on says nothing at all. So the factor below is clamped at 1: evidence
 * can raise the estimate to what was proven, never lower it on the strength of
 * a paddock that was simply left alone.
 */

/** A herd row, as much of one as this needs. */
export type UnitRow = { feed_class?: string | null; class_name?: string | null }

/**
 * The AU per head to read each kind of mob at, from the ranch's own herd.
 *
 * Falls back to a 1,000 lb cow, a 1,200 lb bred heifer and an 1,800 lb bull on
 * the metabolic scale where the class is not on file.
 */
export function mobUnits(rows: UnitRow[], auOf: (row: UnitRow) => number): MobUnits {
  const pick = (test: (r: UnitRow) => boolean, fallback: number) => {
    const row = rows.find(test)
    const au = row ? auOf(row) : NaN
    return Number.isFinite(au) && au > 0 ? au : fallback
  }
  return {
    cows: pick((r) => r.feed_class === 'cow' || /cow/i.test(r.class_name ?? ''), 1),
    heifers: pick((r) => r.feed_class === 'bred_heifer' || /heifer/i.test(r.class_name ?? ''), 1.1465),
    bulls: pick((r) => r.feed_class === 'bull' || /bull/i.test(r.class_name ?? ''), 1.5542),
  }
}

/** One activation: a mob in a paddock between two dates. */
export type GrazedRow = {
  mob: string
  pasture_id: string | null
  started_at: string
  ended_at: string | null
  head_count: number | null
}

/**
 * AU per head for each kind of mob.
 *
 * Cows only -- the collars are on the cows, and the calves at side are left
 * out rather than estimated. They eat, so this makes the figure lower than the
 * truth, which is the direction a floor should be wrong in.
 */
export type MobUnits = {
  cows: number
  heifers: number
  bulls: number
}

const DAY_MS = 86_400_000

const auFor = (mob: string, u: MobUnits): number => {
  switch (mobClass(mob)) {
    case 'Bulls':
      return u.bulls
    case 'Replacement heifers':
      return u.heifers
    default:
      return u.cows
  }
}

export type GrazedSeason = {
  season: number
  /** Animal-unit days taken off the ranch's paddocks. */
  auds: number
  /** Paddocks with any record at all. */
  paddocks: number
  /** Calendar days from the first turn-in to the last turn-out. */
  days: number
}

/**
 * Animal-unit days the collars say came off each season, by paddock.
 *
 * A mob is counted once per paddock per day. One mob can show in two paddocks
 * on one day — a virtual fence moves inside a paddock as well as between
 * them — and summing the activations straight would then count the same
 * cattle twice: at Home Ranch that inflated 56,000 animal-days to 106,000.
 *
 * `until` bounds an unfinished activation, which is every mob still out.
 */
export function grazedSeasons(rows: GrazedRow[], units: MobUnits, until: Date = new Date()): GrazedSeason[] {
  // season -> pasture|mob|day, so a day is counted once however it was logged.
  const seen = new Map<number, Map<string, number>>()
  const span = new Map<number, { from: number; to: number; paddocks: Set<string> }>()
  for (const r of rows) {
    if (!r.pasture_id || !r.head_count) continue
    const from = Date.parse(r.started_at)
    const to = Math.min(r.ended_at ? Date.parse(r.ended_at) : until.getTime(), until.getTime())
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) continue
    const au = auFor(r.mob, units) * r.head_count
    for (let t = from; t < to; t += DAY_MS) {
      const d = new Date(t)
      const season = d.getUTCFullYear()
      const key = `${r.pasture_id}|${r.mob}|${d.toISOString().slice(0, 10)}`
      const days = seen.get(season) ?? new Map<string, number>()
      // The heaviest count logged for that mob on that day in that paddock.
      days.set(key, Math.max(days.get(key) ?? 0, au))
      seen.set(season, days)
      const s = span.get(season) ?? { from: t, to: t, paddocks: new Set<string>() }
      s.from = Math.min(s.from, t)
      s.to = Math.max(s.to, t)
      s.paddocks.add(r.pasture_id)
      span.set(season, s)
    }
  }
  return [...seen.entries()]
    .map(([season, days]) => ({
      season,
      auds: Math.round([...days.values()].reduce((a, b) => a + b, 0)),
      paddocks: span.get(season)?.paddocks.size ?? 0,
      days: Math.round(((span.get(season)!.to - span.get(season)!.from) / DAY_MS) + 1),
    }))
    .sort((a, b) => b.season - a.season)
}

/** Enough of a season to calibrate on: a real grazing season, not a trial. */
export const MIN_GRAZED_DAYS = 90
export const MIN_GRAZED_PADDOCKS = 3

export type ForageCalibration = {
  /** What to multiply the table's lb/acre by. 1 when there is nothing to go on. */
  factor: number
  /** The season it was measured in. */
  season: number | null
  /** Animal-unit days taken that season. */
  grazedAuds: number
  /** The same season's take, read as an ordinary year. */
  normalisedAuds: number
  /** What the model says the ranch supplies in an ordinary year. */
  modelledAuds: number
  paddocks: number
}

export const NO_CALIBRATION: ForageCalibration = {
  factor: 1,
  season: null,
  grazedAuds: 0,
  normalisedAuds: 0,
  modelledAuds: 0,
  paddocks: 0,
}

/**
 * How far the table is out, as a multiplier, from the most recent season with
 * a real grazing record behind it.
 *
 * The season's take is divided by that season's rain factor first, so a wet
 * year is not baked in as the new normal, and compared with what the model
 * says the ranch grows in an ordinary year. Clamped at 1 and at 3: a record
 * can only raise the estimate, and a factor past three times is a sign
 * something is wrong with the inputs rather than with the table.
 */
export function forageCalibration(
  seasons: GrazedSeason[],
  modelledNormalAuds: number,
  rainFactorFor: (season: number) => number,
): ForageCalibration {
  const usable = seasons.find((s) => s.days >= MIN_GRAZED_DAYS && s.paddocks >= MIN_GRAZED_PADDOCKS)
  if (!usable || !(modelledNormalAuds > 0)) return NO_CALIBRATION
  const rain = rainFactorFor(usable.season)
  const normalised = usable.auds / (rain > 0 ? rain : 1)
  return {
    factor: Math.min(3, Math.max(1, normalised / modelledNormalAuds)),
    season: usable.season,
    grazedAuds: usable.auds,
    normalisedAuds: Math.round(normalised),
    modelledAuds: Math.round(modelledNormalAuds),
    paddocks: usable.paddocks,
  }
}
