import { gdd5 } from './aimm-season'

/**
 * When will this crop be ready? Seeding date plus the crop's days to maturity,
 * moved as the season goes by the field's own weather and its hail.
 *
 * DAYS TO MATURITY ARE A NORMAL YEAR. A variety rated 100 days takes 100 days
 * when the summer is the station's long-term normal. So the rating becomes a
 * heat target: the heat units the normals give from the seeding day over that
 * many days. The crop is mature on the day the field's real heat reaches it —
 * measured weather to today, the forecast after that, normals beyond. A normal
 * year lands exactly on seeding + days; a cool one later, a hot one earlier.
 *
 * Heat units: corn heat units (Ontario CHU) for corn, soybeans, dry beans and
 * sorghum, which are rated in them in Canada; growing degree days above 5 °C
 * (AIMM's, the same the irrigation balance counts) for everything else. The
 * target comes from the same formula as the count, so the units cancel.
 *
 * SUN. Each day's heat units are scaled by that day's solar radiation against
 * the normal for the date — Caprio's solar-thermal units (Caprio, J.M. 1974,
 * "The solar-thermal unit concept in problems related to plant development and
 * potential evapotranspiration", in Lieth (ed.) Phenology and Seasonality
 * Modeling, Springer, pp 353–364). A day's ratio is held to 0.6–1.4 so one
 * dark, smoky or mis-reported day cannot swing the date. Missing solar counts
 * as normal. Heat and sun are reported apart: heat is the date with every
 * ratio at 1, sun is what the ratios then add.
 *
 * HAIL. Hail before the crop is filling seed sets it back: it regrows and
 * branches or tillers again, and matures later and less evenly (Canola Council
 * of Canada, Canola Watch "Hail from emergence to harvest", 14 May 2021;
 * Alberta Agriculture, "Barley Production in Alberta: Crop Damage" — extra time
 * to replace damaged tissue). Once seed is filling the plant can no longer
 * compensate, so later hail costs yield, not days. Neither publishes a day
 * count, so the rule here is ours and stated: hail before 60% of the heat
 * target (about the end of flowering) adds 15 days × loss fraction × the
 * share of the field it hit — a total loss that regrows is set back about two
 * weeks, still short of a reseed — and all hail together adds at most 21 days.
 */

export type HeatKind = 'chu' | 'gdd'

/** Corn, soybeans, dry beans and sorghum are rated in corn heat units. */
export function heatKindFor(cropName: string | null | undefined): HeatKind {
  return /corn|soy|bean|sorghum/i.test(cropName ?? '') ? 'chu' : 'gdd'
}

/** Ontario corn heat units for one day (each half floored at zero). */
export function chuDay(tmax: number, tmin: number): number {
  const ymax = Math.max(0, 3.33 * (tmax - 10) - 0.084 * (tmax - 10) ** 2)
  const ymin = Math.max(0, 1.8 * (tmin - 4.4))
  return (ymax + ymin) / 2
}

export const heatUnits = (kind: HeatKind, tmax: number, tmin: number) =>
  kind === 'chu' ? chuDay(tmax, tmin) : gdd5(tmax, tmin)

/** One day of station weather; a future date is the forecast. */
export type WxDay = { tmax: number | null; tmin: number | null; solarMj: number | null }
/** Long-term normals by 'MM-DD'. */
export type NormalDay = { tmax: number; tmin: number; solarMj: number | null }

export type HailHit = { date: string; lossPct: number | null; /** 0–1 of the crop's acres; null = all of it. */ share: number | null }

export type HailEffect = { date: string; lossPct: number; days: number; /** 0–1 of the way to maturity when it hit. */ stage: number }

export type Estimate = {
  seeded: string
  days: number
  kind: HeatKind
  /** Seeding + days to maturity. */
  baseline: string
  /** With heat, sun and hail. */
  mature: string
  heatDays: number
  sunDays: number
  hailDays: number
  hail: HailEffect[]
  /** Last day of measured weather used, and last forecast day. */
  measuredTo: string | null
  forecastTo: string | null
  /** False when the station has no normals: the date is seeding + days (+ hail) only. */
  weatherUsed: boolean
  /** The heat target was not reached by the end of the year. */
  notReached: boolean
}

export const HAIL_STAGE_LIMIT = 0.6
export const HAIL_FULL_LOSS_DAYS = 15
export const HAIL_MAX_DAYS = 21
const SUN_MIN = 0.6
const SUN_MAX = 1.4

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 864e5)
}

const normalFor = (normals: Map<string, NormalDay>, date: string) =>
  normals.get(date.slice(5)) ?? (date.slice(5) === '02-29' ? normals.get('02-28') : undefined)

/** Days of hail delay for one event, by the rule above. */
export function hailDelay(lossPct: number | null, share: number | null, stage: number): number {
  if (lossPct == null || lossPct <= 0 || stage >= HAIL_STAGE_LIMIT) return 0
  const s = share == null ? 1 : Math.max(0, Math.min(1, share))
  return Math.round(HAIL_FULL_LOSS_DAYS * Math.min(100, lossPct) / 100 * s)
}

export function estimateMaturity(args: {
  seeded: string
  days: number
  kind: HeatKind
  /** Station weather by date: measured to today, forecast after. */
  weather: Map<string, WxDay>
  normals: Map<string, NormalDay>
  today: string
  hail?: HailHit[]
}): Estimate {
  const { seeded, days, kind, weather, normals, today } = args
  const baseline = addDays(seeded, days)

  // The heat a normal year gives over the rated days.
  let target = 0
  let normalsComplete = normals.size > 0
  for (let i = 0; i < days && normalsComplete; i++) {
    const n = normalFor(normals, addDays(seeded, i))
    if (!n) normalsComplete = false
    else target += heatUnits(kind, n.tmax, n.tmin)
  }

  let measuredTo: string | null = null
  let forecastTo: string | null = null
  let heatOn: string | null = null
  let sunOn: string | null = null
  // Progress (0–1, solar-thermal) at the end of each day, for hail staging.
  const progress = new Map<string, number>()
  let walkedTo = baseline

  if (normalsComplete && target > 0) {
    let heat = 0
    let stu = 0
    const stop = addDays(seeded, Math.max(days * 2, 1))
    const yearEnd = `${seeded.slice(0, 4)}-12-31`
    const last = stop < yearEnd ? stop : yearEnd
    walkedTo = addDays(last, 1)
    for (let d = seeded; d <= last && !(heatOn && sunOn); d = addDays(d, 1)) {
      const n = normalFor(normals, d)
      const w = weather.get(d)
      let hu: number
      let ratio = 1
      if (w && w.tmax != null && w.tmin != null) {
        hu = heatUnits(kind, w.tmax, w.tmin)
        if (d <= today) measuredTo = d
        else forecastTo = d
        if (w.solarMj != null && n?.solarMj) ratio = Math.max(SUN_MIN, Math.min(SUN_MAX, w.solarMj / n.solarMj))
      } else if (n) {
        hu = heatUnits(kind, n.tmax, n.tmin)
      } else {
        hu = 0
      }
      heat += hu
      stu += hu * ratio
      progress.set(d, stu / target)
      // Mature the day after the day that completes the target, so a normal
      // year lands on seeding + days exactly.
      if (!heatOn && heat >= target - 1e-9) heatOn = addDays(d, 1)
      if (!sunOn && stu >= target - 1e-9) sunOn = addDays(d, 1)
    }
  }

  const weatherUsed = normalsComplete && target > 0
  const notReached = weatherUsed && (!heatOn || !sunOn)
  const heatDate = weatherUsed ? (heatOn ?? walkedTo) : baseline
  const sunDate = weatherUsed ? (sunOn ?? walkedTo) : baseline

  const hail: HailEffect[] = []
  for (const h of args.hail ?? []) {
    if (h.date < seeded || h.date >= sunDate) continue
    const stage = progress.get(h.date) ?? daysBetween(seeded, h.date) / days
    const d = hailDelay(h.lossPct, h.share, stage)
    hail.push({ date: h.date, lossPct: h.lossPct ?? 0, days: d, stage })
  }
  hail.sort((a, b) => a.date.localeCompare(b.date))
  const hailDays = Math.min(HAIL_MAX_DAYS, hail.reduce((s, h) => s + h.days, 0))

  return {
    seeded,
    days,
    kind,
    baseline,
    mature: addDays(sunDate, hailDays),
    heatDays: daysBetween(baseline, heatDate),
    sunDays: daysBetween(heatDate, sunDate),
    hailDays,
    hail,
    measuredTo,
    forecastTo,
    weatherUsed,
    notReached,
  }
}

/** "12 Sep" */
export function shortDate(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

const signed = (n: number) => `${n > 0 ? '+' : '−'}${Math.abs(n)} day${Math.abs(n) === 1 ? '' : 's'}`

/** The reasons, in the order they apply: "seeded 2 May, 110 days; +4 days cooler than normal, +5 days hail 2 Aug". */
export function estimateReasons(e: Estimate): string {
  const parts: string[] = []
  if (e.heatDays) parts.push(`${signed(e.heatDays)} ${e.heatDays > 0 ? 'cooler' : 'warmer'} than normal`)
  if (e.sunDays) parts.push(`${signed(e.sunDays)} ${e.sunDays > 0 ? 'cloudier' : 'sunnier'} than normal`)
  for (const h of e.hail) if (h.days) parts.push(`${signed(h.days)} hail ${shortDate(h.date)}`)
  if (e.hailDays < e.hail.reduce((s, h) => s + h.days, 0)) parts.push(`hail held to ${HAIL_MAX_DAYS} days`)
  const head = `seeded ${shortDate(e.seeded)}, ${e.days} days`
  return parts.length ? `${head}; ${parts.join(', ')}` : head
}

/** The basis, for a tooltip. */
export function estimateBasis(e: Estimate, station: string | null): string {
  const unit = e.kind === 'chu' ? 'corn heat units' : 'growing degree days (base 5 °C)'
  const lines = [
    `${e.days} days to maturity from ${shortDate(e.seeded)} is ${shortDate(e.baseline)} in a normal year.`,
  ]
  if (e.weatherUsed) {
    const src = [
      e.measuredTo ? `measured to ${shortDate(e.measuredTo)}` : null,
      e.forecastTo ? `forecast to ${shortDate(e.forecastTo)}` : null,
      'normals after',
    ].filter(Boolean).join(', ')
    lines.push(`Moved by ${unit}${station ? ` at ${station}` : ''} (${src}), each day scaled by its sunshine against normal.`)
    if (e.notReached) lines.push('Normal heat does not reach maturity this year; the date is a floor.')
  } else {
    lines.push('No weather normals for this field’s station, so the weather does not move it.')
  }
  const late = e.hail.filter((h) => !h.days)
  if (e.hail.some((h) => h.days)) lines.push(`Hail before seed fill: up to ${HAIL_FULL_LOSS_DAYS} days for a total loss, by loss % and share of the field.`)
  if (late.length) lines.push(`Hail ${late.map((h) => shortDate(h.date)).join(', ')} came during seed fill or had no loss %: no delay.`)
  return lines.join(' ')
}
