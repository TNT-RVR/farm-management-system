import { lbPerAuDay } from './forage-yield'
import { addDays } from './grazing-plan'
import { regrowth } from './forage-regrowth'

/**
 * Strip grazing behind a virtual fence (Sam, 12 Nov 2026).
 *
 * A collar fence turns one paddock into as many small ones as you like. The
 * question that then needs answering is not "how long will this paddock last"
 * — the Grazing tab already says that — but "how big do I make each fence".
 * Say how many days the mob should sit behind one fence and the arithmetic
 * runs the other way:
 *
 *   lb a rotation = animal units × 26 or 33.3 lb × days behind the fence
 *   acres         = lb a rotation ÷ the paddock's lb an acre
 *   rotations     = whole fences the paddock's grass holds
 *   total days    = all the paddock's grass ÷ what the mob eats a day
 *
 * Everything here is pure: the same figures the screen shows can be checked in
 * a test, and the lb an acre handed in is already net of the utilisation rate,
 * so nothing is taken off twice.
 */

/** Days behind one fence. Three is where Sam starts. */
export const DEFAULT_DAYS_PER_ROTATION = 3

/** A mob of cattle, however it was put together, and what one head eats. */
export type FenceMob = {
  id: string
  name: string
  head: number
  /** Animal units a head: a 1,400 lb cow is 1.4, her calf at side another 0.5. */
  auPerHead: number
}

/** What the mobs picked eat, together. */
export type FenceDemand = {
  head: number
  au: number
  lbPerDay: number
  /** Animal-unit months the mobs make up, for comparing with lease capacity. */
  aumsPerMonth: number
}

/**
 * `countWaste` matches the ranch's setting (ranches.grazing_count_waste), so
 * the mob's daily draw is in the same pounds as the paddock's supply. Demand in
 * intake-only pounds against supply in waste-inclusive pounds would read a
 * strip as lasting a fifth longer than it does.
 *
 * aumsPerMonth is just `au`: a month of animal-unit days IS the animal units.
 * It was written as (au × 26 × 30) ÷ 780, which cancels — and which would now
 * look like it had to pick one of the two pound figures.
 */
export function fenceDemand(mobs: FenceMob[], countWaste: boolean = true): FenceDemand {
  const head = mobs.reduce((a, m) => a + Math.max(0, m.head), 0)
  const au = mobs.reduce((a, m) => a + Math.max(0, m.head) * Math.max(0, m.auPerHead), 0)
  return { head, au, lbPerDay: au * lbPerAuDay(countWaste), aumsPerMonth: au }
}

/** One surface inside a paddock: its native grass, or the crop fields in the fence. */
export type FenceSurface = {
  label: string
  acres: number
  /** Grazeable pounds this surface grows, after utilisation. */
  lb: number
}

/** A paddock as the forage estimate leaves it, all figures net of utilisation. */
export type FencePaddockInput = {
  id: string
  name: string
  grazeableAc: number
  /** Pounds an acre, averaged over the grazeable acres. */
  lbPerAc: number
  totalLb: number
  /** Native grass and crop fields separately, where a paddock has both. */
  surfaces: FenceSurface[]
}

/** What one surface gives at this mob and this many days behind the fence. */
export type FenceSurfacePlan = FenceSurface & {
  lbPerAc: number
  /** Acres of THIS surface one rotation needs. */
  acresPerRotation: number
  /**
   * Days this surface alone feeds the mobs. Not a rotation count: flooring
   * each surface's fences on its own gave 2 and 1 under a paddock showing 4,
   * which reads like an error. Days add up; whole fences do not.
   */
  days: number
}

export type FencePaddockPlan = {
  id: string
  name: string
  grazeableAc: number
  lbPerAc: number
  totalLb: number
  /** Acres one fence has to hold, at the paddock's average pounds an acre. */
  acresPerRotation: number
  /** Whole rotations the paddock's grass holds. */
  rotations: number
  /** Days all of the paddock's grass feeds the mob — the part rotation included. */
  totalDays: number
  /** Head an acre inside one fence, which is what the ground sees. */
  headPerAcre: number
  /** Animal units an acre inside one fence. */
  auPerAcre: number
  surfaces: FenceSurfacePlan[]
}

/**
 * `rotations` is the whole number of fences the paddock holds and `totalDays`
 * is every pound of its grass, so the two rarely multiply out: a paddock with
 * 103 days of grass at 3 days a fence is 34 rotations, and the last one comes
 * up a day short. Reporting the floor of the fences and the true total days is
 * the honest pair — rounding the fences up would plan a move onto grass that
 * is not there.
 */
export function fencePlan(p: FencePaddockInput, demand: FenceDemand, daysPerRotation: number): FencePaddockPlan {
  const days = Math.max(0, daysPerRotation)
  const lbPerRotation = demand.lbPerDay * days
  const acresPerRotation = p.lbPerAc > 0 && lbPerRotation > 0 ? lbPerRotation / p.lbPerAc : 0
  const totalDays = demand.lbPerDay > 0 ? Math.max(0, p.totalLb) / demand.lbPerDay : 0
  const rotations = days > 0 ? Math.floor(totalDays / days) : 0
  return {
    id: p.id,
    name: p.name,
    grazeableAc: p.grazeableAc,
    lbPerAc: p.lbPerAc,
    totalLb: p.totalLb,
    acresPerRotation,
    rotations,
    totalDays,
    headPerAcre: acresPerRotation > 0 ? demand.head / acresPerRotation : 0,
    auPerAcre: acresPerRotation > 0 ? demand.au / acresPerRotation : 0,
    surfaces: p.surfaces
      .filter((s) => s.acres > 0 && s.lb > 0)
      .map((s) => {
        const lbPerAc = s.lb / s.acres
        return {
          ...s,
          lbPerAc,
          acresPerRotation: lbPerRotation > 0 ? lbPerRotation / lbPerAc : 0,
          days: demand.lbPerDay > 0 ? s.lb / demand.lbPerDay : 0,
        }
      }),
  }
}

/**
 * Days the short last fence lasts, in the whole days shown: the paddock's
 * total days as printed less its whole fences. `rotations × days + this` is
 * the total days on screen, so the two columns add up ("11 + 2 d" at 3 days,
 * 35 days) instead of reading as 11 × 3 = 33 against 35.
 */
export function shortFenceDays(p: Pick<FencePaddockPlan, 'rotations' | 'totalDays'>, daysPerRotation: number): number {
  if (daysPerRotation <= 0) return 0
  return Math.max(0, Math.round(p.totalDays) - p.rotations * daysPerRotation)
}

export type FenceTotals = { grazeableAc: number; totalLb: number; rotations: number; totalDays: number; lbPerAc: number }

/**
 * Every paddock added up. The pounds an acre is weighted by acres rather than
 * averaged across the rows: a 900 acre paddock and a 35 acre one do not count
 * the same.
 */
export function fenceTotals(plans: FencePaddockPlan[]): FenceTotals {
  const grazeableAc = plans.reduce((a, p) => a + p.grazeableAc, 0)
  const totalLb = plans.reduce((a, p) => a + p.totalLb, 0)
  return {
    grazeableAc,
    totalLb,
    rotations: plans.reduce((a, p) => a + p.rotations, 0),
    totalDays: plans.reduce((a, p) => a + p.totalDays, 0),
    lbPerAc: grazeableAc > 0 ? totalLb / grazeableAc : 0,
  }
}

// ---------------------------------------------------------------- second pass

/**
 * What the fence finds when it comes back round to its first strip.
 *
 * The plan above counts a paddock's grass once. In practice the fence walks
 * the paddock and arrives back at strip one a whole cycle later, and that
 * strip has been growing the whole time — so the paddock is worth more days
 * than `totalDays` says, and how many more depends on when in the year it was
 * grazed, what it rained, and how hard it was taken (lib/forage-regrowth.ts).
 *
 * Each strip is costed on its own dates, because a 20-strip pass can start in
 * May and finish in August: strip 1 regrows most of a season, the last strip
 * regrows nothing.
 */
export type SecondPassInput = {
  /** Whole-season growth an acre, BEFORE the utilisation rate. */
  seasonPotentialLbPerAc: number
  /** Share of the standing grass the cattle take — the ranch's utilisation rate. */
  takePct: number
  /** The day the mob goes into this paddock. */
  turnIn: string
  /** This stretch of weather against its long-term average; 1 everywhere by default. */
  rainFactorFor?: (from: string, to: string) => number
}

export type SecondPass = {
  /** The day the fence gets back to strip one. */
  backOn: string
  /** Days a strip rests: one whole pass through the paddock. */
  restDays: number
  /** Acres the pass actually covers: the whole fences, not the paddock. */
  coveredAc: number
  /** Pounds the paddock grows back over that pass, before the utilisation rate. */
  grossLb: number
  /**
   * Those pounds over the acres the pass covers — what the model predicts for
   * the ground behind the fence. Over the whole paddock's acres instead, it
   * would read low by whatever the part fence at the end leaves out, and would
   * not square with the strips it is the total of.
   */
  grossLbPerAc: number
  /** Grazeable pounds of it: the share the cattle take, as the first pass is counted. */
  lb: number
  /** Those grazeable pounds over the acres the pass covers. */
  lbPerAc: number
  /** Extra days of grazing they are worth to the mobs. */
  days: number
  /** Strip by strip, oldest first. */
  strips: { grazedOn: string; backOn: string; lb: number }[]
}

/** Strip one is grazed on the turn-in day; strip k starts `daysPerRotation` later each time. */
export function secondPass(
  p: FencePaddockPlan,
  demand: FenceDemand,
  daysPerRotation: number,
  i: SecondPassInput,
): SecondPass {
  const days = Math.max(0, daysPerRotation)
  const restDays = p.rotations * days
  const empty: SecondPass = { backOn: i.turnIn, restDays, coveredAc: 0, grossLb: 0, grossLbPerAc: 0, lb: 0, lbPerAc: 0, days: 0, strips: [] }
  if (p.rotations <= 0 || days <= 0 || p.acresPerRotation <= 0) return empty
  const take = Math.min(1, Math.max(0, i.takePct))
  const strips: SecondPass['strips'] = []
  let grossLb = 0
  for (let k = 0; k < p.rotations; k++) {
    const grazedOn = addDays(i.turnIn, k * days)
    const backOn = addDays(grazedOn, restDays)
    const r = regrowth({
      seasonPotentialLb: i.seasonPotentialLbPerAc,
      grazedOn,
      backOn,
      takePct: take,
      rainFactor: i.rainFactorFor?.(grazedOn, backOn) ?? 1,
    })
    const stripLb = r.regrowthLb * p.acresPerRotation
    strips.push({ grazedOn, backOn, lb: stripLb })
    grossLb += stripLb
  }
  /*
   * Only the share they will actually take off it is feed, the same way the
   * first pass is counted. Note which way this cuts: a harder take grows LESS
   * back (grossLb falls) but harvests more of what there is, so the extra days
   * of a single second pass can still come out higher. The cost of taking it
   * hard is in the grass, not in this year's days — and in next year, which
   * nothing here models.
   */
  const lb = grossLb * take
  const coveredAc = p.rotations * p.acresPerRotation
  return {
    backOn: addDays(i.turnIn, restDays),
    restDays,
    coveredAc,
    grossLb,
    grossLbPerAc: coveredAc > 0 ? grossLb / coveredAc : 0,
    lb,
    lbPerAc: coveredAc > 0 ? lb / coveredAc : 0,
    days: demand.lbPerDay > 0 ? lb / demand.lbPerDay : 0,
    strips,
  }
}
