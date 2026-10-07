/**
 * AIMM improvements that sit around the daily checkbook (1 Oct 2026):
 * self-calibration from measured soil moisture, the balance per wedge of the
 * pivot circle, and the rest-of-season outlook. Pure, so the server run and
 * the tests share them.
 */
import { aimmInfiltration, aimmSoilFactor, aimmStep } from './et'

// ---------------------------------------------------------------------------
// 5. Self-calibration
// ---------------------------------------------------------------------------

/** One measured reading against what the model had for that morning. */
export type CalibrationPoint = {
  /** The model's available water on the reading's day, before correction. */
  predicted: number
  measured: number
  /** Crop water use the model counted since the previous reading. */
  etSincePrev: number
}

/**
 * The factor that would have made the model's water use match the soil.
 * Between two readings the soil lost (prev + inputs - measured); the model
 * said it lost (prev + inputs - predicted). So the model's water use was off
 * by (predicted - measured), and the implied scale is
 *   (et + predicted - measured) / et.
 * Pooled over every pair weighted by water use, shrunk toward 1 until there is
 * ~150 mm of water use behind it (one dry spell should not rewrite a field),
 * and held to 0.7-1.3.
 */
export function calibrationFactor(points: CalibrationPoint[], current = 1): { factor: number; basisMm: number } {
  const usable = points.filter((p) => p.etSincePrev >= 10)
  const basis = usable.reduce((a, p) => a + p.etSincePrev, 0)
  if (!usable.length || basis <= 0) return { factor: current, basisMm: 0 }
  const implied = usable.reduce((a, p) => a + (p.etSincePrev + p.predicted - p.measured), 0) / basis
  const raw = current * Math.max(0.5, Math.min(1.5, implied))
  const weight = Math.min(1, basis / 150)
  const factor = 1 + (raw - 1) * weight
  return { factor: Math.round(Math.max(0.7, Math.min(1.3, factor)) * 100) / 100, basisMm: Math.round(basis) }
}

// ---------------------------------------------------------------------------
// 4. Balance per wedge
// ---------------------------------------------------------------------------

export const WEDGES = 36

/** Mean of a day's 1-degree bins over each 10-degree wedge. */
export function binsToWedges(bins: number[]): number[] {
  const out = new Array<number>(WEDGES).fill(0)
  for (let w = 0; w < WEDGES; w++) {
    let s = 0
    for (let k = 0; k < 10; k++) s += Number(bins[w * 10 + k]) || 0
    out[w] = s / 10
  }
  return out
}

export type WedgeDay = {
  date: string
  /** The field's crop water use before the dry-soil slowdown (scale and calibration applied). */
  etcTable: number
  /** Kc floor x ET0: the least a wedge loses (bare soil / after harvest). */
  etcFloor: number
  rain: number
  /** Effective irrigation per wedge (mm); null = use the field figure on every wedge. */
  irrWedges: number[] | null
  irrField: number
  /** A measured reading as a fraction of field capacity, applied to every wedge. */
  measuredFrac?: number | null
}

/**
 * The same checkbook as the field, run on each wedge with its own capacity
 * and its own share of the pivot's water. Rain and the crop's demand are the
 * same across the circle; what differs is where the water landed and how much
 * the soil there holds.
 */
export function wedgeBalance(days: WedgeDay[], fc: number[], startFrac: number): { date: string; avail: number[]; irr: number[] }[] {
  let avail = fc.map((f) => f * startFrac)
  const irrTotal = new Array<number>(WEDGES).fill(0)
  const out: { date: string; avail: number[]; irr: number[] }[] = []
  for (const d of days) {
    avail = avail.map((a, i) => {
      const irr = d.irrWedges ? d.irrWedges[i] : d.irrField
      irrTotal[i] += irr
      const { infiltrated } = aimmInfiltration(d.rain, a, fc[i])
      const etc = Math.max(d.etcFloor, d.etcTable * aimmSoilFactor(a, fc[i]))
      const next = aimmStep({ prev: a, fc: fc[i], etc, precip: infiltrated, netIrrigation: irr }).avail
      return d.measuredFrac != null ? d.measuredFrac * fc[i] : next
    })
    out.push({ date: d.date, avail: avail.map((v) => Math.round(v * 10) / 10), irr: irrTotal.map((v) => Math.round(v * 10) / 10) })
  }
  return out
}

// ---------------------------------------------------------------------------
// 7. Rest of the season
// ---------------------------------------------------------------------------

/** Growing degree days, base 5 C, AIMM's way (none on a day the low is below freezing). */
export function gdd5(tmax: number, tmin: number): number {
  if (tmin < 0) return 0
  return Math.max(0, (tmax + tmin) / 2 - 5)
}

export type OutlookDay = { date: string; gdd: number; etcTable: number; etcFloor: number; rain: number }

/**
 * From today's soil and the season so far, walk the normals forward to
 * maturity with no more irrigation and ask: how much more water does the crop
 * need, and when is the last day a full refill still carries it through?
 *
 * Late in the season the crop can be let down further than the irrigation
 * threshold — finishing at 60% depleted (40% of capacity left) is common
 * practice once the crop is past its peak — so the floor at maturity is
 * 0.4 x field capacity.
 */
export function seasonOutlook(args: {
  today: string
  gddToDate: number
  maturityGdd: number | null
  harvestDate: string | null
  avail: number
  fc: number
  ahead: OutlookDay[]
  netPerPassMm: number
}): { maturityOn: string | null; needMoreMm: number; passesLeft: number; lastIrrigationBy: string | null; note: string } {
  const floor = 0.4 * args.fc
  let gdd = args.gddToDate
  let maturityOn: string | null = args.harvestDate && args.harvestDate >= args.today ? args.harvestDate : null
  let et = 0
  let avail = args.avail
  let deficit = 0
  const used: number[] = []
  if (args.harvestDate && args.harvestDate < args.today)
    return { maturityOn: args.harvestDate, needMoreMm: 0, passesLeft: 0, lastIrrigationBy: null, note: 'Harvested — no more irrigation.' }
  if (!maturityOn && args.maturityGdd != null && gdd >= args.maturityGdd)
    return { maturityOn: args.today, needMoreMm: 0, passesLeft: 0, lastIrrigationBy: null, note: 'At maturity by heat units — no more irrigation needed.' }
  for (const d of args.ahead) {
    if (maturityOn && d.date > maturityOn) break
    gdd += d.gdd
    const e = Math.max(d.etcFloor, d.etcTable * aimmSoilFactor(avail, args.fc))
    et += e
    used.push(e)
    avail = Math.min(args.fc * 1.1, avail - e + d.rain)
    if (avail < floor) {
      deficit += floor - avail
      avail = floor
    }
    if (!maturityOn && args.maturityGdd != null && gdd >= args.maturityGdd) maturityOn = d.date
  }
  const needMoreMm = Math.round(deficit)
  if (!maturityOn) maturityOn = args.ahead.at(-1)?.date ?? null
  if (needMoreMm <= 0)
    return { maturityOn, needMoreMm: 0, passesLeft: 0, lastIrrigationBy: null, note: 'The soil carries the crop to maturity on normal weather — no more irrigation needed.' }
  // The last refill must hold from then to maturity: count back from maturity
  // the days a full profile (capacity down to the floor) lasts at the coming
  // water use.
  const carry = args.fc - floor
  let acc = 0
  let back = 0
  for (let i = used.length - 1; i >= 0; i--) {
    acc += used[i]
    if (acc > carry) break
    back++
  }
  const last = maturityOn ? new Date(Date.parse(`${maturityOn}T12:00:00Z`) - back * 864e5).toISOString().slice(0, 10) : null
  return {
    maturityOn,
    needMoreMm,
    passesLeft: Math.round((needMoreMm / Math.max(1, args.netPerPassMm)) * 10) / 10,
    lastIrrigationBy: last && last < args.today ? args.today : last,
    note: `About ${needMoreMm} mm more (net) to carry it to maturity on normal weather.`,
  }
}
