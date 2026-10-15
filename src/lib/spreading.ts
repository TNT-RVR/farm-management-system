/**
 * What it costs us to spread our own dry fertilizer, an acre.
 *
 * Sam: "We would need to do some analysis on that, tell me what pieces we
 * would need. I am guessing speed, width of spread, which piece of equipment,
 * fuel costs, etc." These are the pieces:
 *
 *   acres an hour = width × speed × field efficiency
 *                   (width in m × km/h ÷ 10 = ha/h; efficiency is the share of
 *                   the hour actually spreading — turns, overlaps, stops)
 *   plus the stops to refill: rate × acres ÷ what the spreader holds, each
 *                   taking the fill minutes
 *   $ an hour     = fuel (L/h × diesel) + operator (wage) + repairs
 *                   + ownership (what the spreader and tractor cost to own)
 *   $ an acre     = $ an hour ÷ acres an hour, plus the drive to the field
 *
 * Everything is an input; the defaults are typical for a pull-type spinner
 * spreader behind a mid-size tractor and say so.
 */
export type SpreaderInputs = {
  /** Spread width, feet. */
  widthFt: number
  /** Spreading speed, km/h. */
  speedKmh: number
  /** Share of the hour actually spreading, 0–1. */
  efficiency: number
  /** What the spreader holds, tonnes. */
  capacityT: number
  /** Minutes to refill it, including the drive to the tender. */
  fillMin: number
  /** Product rate, lb/ac. */
  rateLbAc: number
  /** Tractor diesel while spreading, L/h. */
  fuelLph: number
  /** Repairs and maintenance, $/h (tractor + spreader). */
  repairsPerHour: number
  /** Ownership (depreciation, interest, insurance, shedding), $/h. */
  ownershipPerHour: number
  /** What a custom applicator or the retailer charges, $/ac, to compare. */
  customPerAc: number
}

export const SPREADER_DEFAULTS: SpreaderInputs = {
  widthFt: 60,
  speedKmh: 16,
  efficiency: 0.7,
  capacityT: 6,
  fillMin: 15,
  rateLbAc: 250,
  fuelLph: 22,
  repairsPerHour: 18,
  ownershipPerHour: 35,
  customPerAc: 7,
}

const AC_PER_HA = 2.4710538146716536
const M_PER_FT = 0.3048
const LB_PER_T = 2204.62262185

export type SpreadingCost = {
  acresPerHour: number
  /** Acres an hour once refills are counted. */
  effectiveAcresPerHour: number
  fillsPerAcre: number
  hoursPerAcre: number
  perHour: { fuel: number; labour: number; repairs: number; ownership: number; total: number }
  perAcre: { fuel: number; labour: number; repairs: number; ownership: number; travel: number; total: number }
  /** Ours minus custom, $/ac: negative means ours is cheaper. */
  vsCustom: number
}

/**
 * $/ac for one field. `travel` is the drive there and back for the job, in
 * dollars (fuel and the operator's time), spread over the field's acres.
 */
export function spreadingCost(i: SpreaderInputs, dieselPerL: number, wage: number, field?: { acres: number; travelDollars: number }): SpreadingCost {
  const acresPerHour = ((i.widthFt * M_PER_FT * i.speedKmh) / 10) * Math.max(0, Math.min(1, i.efficiency)) * AC_PER_HA
  const fillsPerAcre = i.capacityT > 0 ? i.rateLbAc / (i.capacityT * LB_PER_T) : 0
  const hoursPerAcre = (acresPerHour > 0 ? 1 / acresPerHour : 0) + (fillsPerAcre * i.fillMin) / 60
  const effectiveAcresPerHour = hoursPerAcre > 0 ? 1 / hoursPerAcre : 0
  const perHour = {
    fuel: i.fuelLph * dieselPerL,
    labour: wage,
    repairs: i.repairsPerHour,
    ownership: i.ownershipPerHour,
    total: 0,
  }
  perHour.total = perHour.fuel + perHour.labour + perHour.repairs + perHour.ownership
  const travel = field && field.acres > 0 ? field.travelDollars / field.acres : 0
  const perAcre = {
    fuel: perHour.fuel * hoursPerAcre,
    labour: perHour.labour * hoursPerAcre,
    repairs: perHour.repairs * hoursPerAcre,
    ownership: perHour.ownership * hoursPerAcre,
    travel,
    total: 0,
  }
  perAcre.total = perAcre.fuel + perAcre.labour + perAcre.repairs + perAcre.ownership + perAcre.travel
  return { acresPerHour, effectiveAcresPerHour, fillsPerAcre, hoursPerAcre, perHour, perAcre, vsCustom: perAcre.total - i.customPerAc }
}
