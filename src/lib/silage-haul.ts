/**
 * How far silage can be trucked before the haul stops making sense.
 *
 * Sam: "Also add a silage distance estimator to see how far you can haul
 * before it doesn't make sense." Silage is mostly water and bulky, so a load
 * is worth little and the trucking eats it quickly. The pieces:
 *
 *   fill        = the minutes under the chopper — never quicker than the
 *                 chopper can blow a load in (payload ÷ chopper t/h)
 *   cycle       = fill + drive out loaded + dump at the pit + drive back empty
 *   trucks to keep up = cycle ÷ fill, i.e. how many trucks must be on the road
 *                 so one is always under the spout
 *   t an hour   = the lesser of what the chopper cuts and what the trucks
 *                 running can carry (trucks × payload ÷ cycle)
 *   $ a tonne   = trucks running × (driver + truck $/h) ÷ t an hour
 *                 + the km × L/km × diesel ÷ payload
 *
 * Paying the whole fleet by the hour, not by the load, is deliberate: a truck
 * sitting at the chopper waiting its turn still has a driver in it, so extra
 * trucks on a short haul cost money, and too few on a long one slow the
 * chopper (the t an hour drops, the cost a tonne rises).
 *
 * Break-even is the one-way distance where that $ a tonne reaches the limit
 * chosen: a share of what the silage is worth, or the gap between buying
 * silage near the pit and the value of our own.
 */
export type SilageHaulInputs = {
  /** As-fed tonnes a truck carries. */
  payloadT: number
  /** Trucks hauling. */
  trucks: number
  /** km/h loaded and empty, averaged over the trip (field road and highway). */
  loadedKmh: number
  emptyKmh: number
  /** Litres a km, loaded out and empty back, averaged. */
  lPerKm: number
  /** Minutes under the chopper a load, swapping in included. */
  loadMin: number
  /** Minutes dumping at the pit a load. */
  unloadMin: number
  /** What the chopper cuts, as-fed tonnes an hour. */
  chopperTph: number
  /** The truck's own repairs and ownership, $ an hour (the driver is the Labour figure). */
  truckPerHour: number
  /** Dry matter, %. */
  dmPct: number
  /** What our silage is worth, $/t as fed. */
  valuePerT: number
  /** What silage costs bought near the pit, delivered, $/t as fed. */
  localPerT: number
  /** The haul may take this % of the silage's value before it stops paying. */
  sharePct: number
}

/**
 * Defaults. Value and dry matter are replaced by the app's own figures where
 * it has them (the crop price for Silage Corn; the feed plan's silage DM %).
 * The rest are round numbers for a tandem/tridem silage box behind a
 * self-propelled chopper in corn, and say "default" on screen until set.
 */
export const SILAGE_HAUL_DEFAULTS: SilageHaulInputs = {
  payloadT: 22,
  trucks: 3,
  loadedKmh: 50,
  emptyKmh: 65,
  lPerKm: 0.5,
  loadMin: 8,
  unloadMin: 8,
  chopperTph: 120,
  truckPerHour: 40,
  dmPct: 35,
  valuePerT: 68.25,
  localPerT: 80,
  sharePct: 25,
}

export type SilageCompare = 'share' | 'local'

/** Minutes a load spends under the chopper: the set minutes, or the chopper's pace if slower. */
export function fillMinutes(i: Pick<SilageHaulInputs, 'loadMin' | 'payloadT' | 'chopperTph'>): number {
  const chopperMin = i.chopperTph > 0 ? (i.payloadT / i.chopperTph) * 60 : 0
  return Math.max(i.loadMin, chopperMin)
}

/** Minutes for one truck's round: fill, out loaded, dump, back empty. */
export function cycleMinutes(i: SilageHaulInputs, oneWayKm: number): number {
  const out = i.loadedKmh > 0 ? (oneWayKm / i.loadedKmh) * 60 : 0
  const back = i.emptyKmh > 0 ? (oneWayKm / i.emptyKmh) * 60 : 0
  return fillMinutes(i) + out + i.unloadMin + back
}

/**
 * Trucks it takes so the chopper never waits, rounded up. A truck leaves the
 * chopper every `fill` minutes, so the round must be covered by that many.
 */
export function trucksNeeded(i: SilageHaulInputs, oneWayKm: number): number {
  const fill = fillMinutes(i)
  if (!(fill > 0)) return 0
  // A hair under a whole truck is a whole truck; float noise is not.
  return Math.ceil(cycleMinutes(i, oneWayKm) / fill - 1e-9)
}

export type SilageHaulCost = {
  oneWayKm: number
  cycleMin: number
  trucksNeeded: number
  /** As-fed tonnes an hour actually moved with the trucks running. */
  tonnesPerHour: number
  /** True when the trucks running cannot keep up and the chopper waits. */
  chopperWaits: boolean
  perT: { fuel: number; time: number; total: number }
  /** The same total, a tonne of dry matter. */
  perTDm: number
  /** Haul cost as a share of the silage's value, %. */
  shareOfValue: number
}

/** $ a tonne as fed, and what goes with it, at one one-way distance. */
export function silageHaulCost(i: SilageHaulInputs, oneWayKm: number, dieselPerL: number, wage: number): SilageHaulCost {
  const km = Math.max(0, oneWayKm)
  const cycleMin = cycleMinutes(i, km)
  const needed = trucksNeeded(i, km)
  const trucks = Math.max(0, i.trucks)
  const truckTph = cycleMin > 0 ? (trucks * i.payloadT * 60) / cycleMin : 0
  const tonnesPerHour = Math.min(Math.max(0, i.chopperTph), truckTph)
  const fuel = i.payloadT > 0 ? (2 * km * i.lPerKm * dieselPerL) / i.payloadT : 0
  const time = tonnesPerHour > 0 ? (trucks * (wage + i.truckPerHour)) / tonnesPerHour : 0
  const total = fuel + time
  const dm = i.dmPct / 100
  return {
    oneWayKm: km,
    cycleMin,
    trucksNeeded: needed,
    tonnesPerHour,
    chopperWaits: trucks < needed,
    perT: { fuel, time, total },
    perTDm: dm > 0 ? total / dm : 0,
    shareOfValue: i.valuePerT > 0 ? (total / i.valuePerT) * 100 : 0,
  }
}

/** The most the haul may cost a tonne (as fed) before it stops paying, by the comparison chosen. */
export function haulLimitPerT(i: SilageHaulInputs, compare: SilageCompare): number {
  return compare === 'share' ? (i.sharePct / 100) * i.valuePerT : i.localPerT - i.valuePerT
}

/**
 * The one-way km where the haul's $ a tonne reaches `limitPerT`.
 *
 * 0 when even a zero-km haul costs more than the limit; `maxKm` (and
 * `beyond`) when it never gets there inside the range looked at. Cost only
 * rises with distance (more fuel, longer rounds, never more tonnes an hour),
 * so halving the gap finds it.
 */
export function breakEvenKm(
  i: SilageHaulInputs,
  limitPerT: number,
  dieselPerL: number,
  wage: number,
  maxKm = 500,
): { km: number; beyond: boolean } {
  const cost = (km: number) => silageHaulCost(i, km, dieselPerL, wage).perT.total
  if (cost(0) > limitPerT) return { km: 0, beyond: false }
  if (cost(maxKm) <= limitPerT) return { km: maxKm, beyond: true }
  let lo = 0
  let hi = maxKm
  for (let n = 0; n < 60; n++) {
    const mid = (lo + hi) / 2
    if (cost(mid) <= limitPerT) lo = mid
    else hi = mid
  }
  return { km: lo, beyond: false }
}

/** Cost points for the chart, 0 to `toKm` one way. */
export function costCurve(i: SilageHaulInputs, dieselPerL: number, wage: number, toKm: number, steps = 40) {
  const out: { km: number; perT: number; perTDm: number; trucks: number }[] = []
  for (let s = 0; s <= steps; s++) {
    const km = (toKm * s) / steps
    const c = silageHaulCost(i, km, dieselPerL, wage)
    out.push({ km: Math.round(km * 10) / 10, perT: c.perT.total, perTDm: c.perTDm, trucks: c.trucksNeeded })
  }
  return out
}
