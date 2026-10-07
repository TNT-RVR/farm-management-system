import type { ForecastDay, ForecastHour } from './ranchWeather'

/**
 * What the forecast means for the work: can we spray, when is it safe for the
 * bees, and is it a day to put nitrogen on.
 *
 * All times are the ranch's local clock, as Open-Meteo returns them with
 * timezone=auto ('2026-09-28T21:00'). They are compared as naive minutes, so
 * no timezone conversion can move an hour.
 */

export type Rating = 'good' | 'fair' | 'poor'

const minutesOf = (local: string) => Date.parse(`${local.length === 16 ? local : local.slice(0, 16)}:00Z`) / 60_000
const pad = (n: number) => String(n).padStart(2, '0')
const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/**
 * Delta T: air temperature less the wet-bulb temperature (Stull 2011). The
 * sprayer's number for evaporation — droplets shrink and drift when it is
 * high, hang in the air when it is very low. 2–8 is the working range.
 */
export function deltaT(tempC: number, rh: number): number {
  const wb =
    tempC * Math.atan(0.151977 * Math.sqrt(rh + 8.313659)) +
    Math.atan(tempC + rh) -
    Math.atan(rh - 1.676331) +
    0.00391838 * Math.pow(rh, 1.5) * Math.atan(0.023101 * rh) -
    4.686035
  return tempC - wb
}

export type SprayHour = {
  time: string
  /** Fit to spray, on weather alone. */
  ok: boolean
  /** Fit, but something is near its limit. */
  marginal: boolean
  /** Bees are likely flying: daylight, warm enough, dry, not too windy. */
  bees: boolean
  reasons: string[]
}

/** Honey bees forage from about 13 °C; below it they stay in. */
export const BEE_FLIGHT_C = 13

/**
 * One hour, judged for spraying and for bees.
 *
 * Limits are the usual Prairie label and extension ones: wind 3–20 km/h
 * (under 3 is an inversion risk, over 20 is drift), gusts under 30,
 * 5–28 °C, Delta T 2–10, no rain in the hour or the two after (rainfast).
 */
export function judgeHour(h: ForecastHour, next: ForecastHour[], sun: { rise: string | null; set: string | null }): SprayHour {
  const reasons: string[] = []
  let ok = true
  let marginal = false
  const wet = (x: ForecastHour) => (x.precip ?? 0) >= 0.2 || (x.pop ?? 0) >= 60
  if (wet(h)) {
    ok = false
    reasons.push('rain')
  } else if (next.slice(0, 2).some(wet)) {
    ok = false
    reasons.push('rain within 2 h')
  }
  const wind = h.wind
  if (wind != null) {
    if (wind < 3) {
      ok = false
      reasons.push('calm — inversion risk')
    } else if (wind > 20) {
      ok = false
      reasons.push(`wind ${Math.round(wind)} km/h`)
    } else if (wind > 16) {
      marginal = true
      reasons.push(`wind ${Math.round(wind)} km/h`)
    }
  }
  if (h.gust != null && h.gust > 30) {
    ok = false
    reasons.push(`gusts ${Math.round(h.gust)}`)
  }
  if (h.temp != null) {
    if (h.temp < 5) {
      ok = false
      reasons.push(`${Math.round(h.temp)}° — too cold`)
    } else if (h.temp > 28) {
      ok = false
      reasons.push(`${Math.round(h.temp)}° — too hot`)
    } else if (h.temp > 25) {
      marginal = true
      reasons.push(`${Math.round(h.temp)}°`)
    }
  }
  if (h.temp != null && h.rh != null) {
    const dt = deltaT(h.temp, h.rh)
    if (dt > 10) {
      ok = false
      reasons.push(`dry air (ΔT ${dt.toFixed(0)})`)
    } else if (dt > 8) {
      marginal = true
      reasons.push(`ΔT ${dt.toFixed(0)}`)
    } else if (dt < 2 && ok) {
      marginal = true
      reasons.push('very humid')
    }
  }
  // Bees: flying from an hour after sunrise until sunset, when it is warm
  // and dry enough and not blowing hard.
  const mid = minutesOf(h.time) + 30
  const daylight =
    sun.rise != null && sun.set != null ? mid >= minutesOf(sun.rise) + 60 && mid <= minutesOf(sun.set) : Number(h.time.slice(11, 13)) >= 8 && Number(h.time.slice(11, 13)) < 20
  const bees = daylight && (h.temp ?? 0) >= BEE_FLIGHT_C && !wet(h) && (h.wind ?? 0) < 25
  return { time: h.time, ok, marginal: ok && marginal, bees, reasons }
}

export type SprayWindow = {
  /** First hour of the window (local ISO), and the hour it ends (exclusive). */
  start: string
  end: string
  hours: number
  quality: 'good' | 'fair'
}

export type SprayDay = {
  date: string
  rating: Rating
  summary: string
  /** Every hour from 9 am to 7 am next morning, for the strip. */
  hours: SprayHour[]
  /** The broad bee-safe window, or null when there is none worth using. */
  window: SprayWindow | null
  /** Why the rest of the span is out. */
  limits: string[]
}

/** The span a spray day covers: 9 am that day to 7 am the next. */
export const WINDOW_FROM_H = 9
export const WINDOW_TO_H = 7

/**
 * The day's spray call and its bee-safe window.
 *
 * The window is the longest unbroken run of hours between 9 am and 7 am the
 * next morning that are fit to spray AND have the bees home — deliberately
 * broad, because it has to cover several fields, so it is stated as "after
 * this, before that" rather than a time. Under two hours is not a window.
 */
export function sprayDay(date: string, hourly: ForecastHour[], sun: { rise: string | null; set: string | null }): SprayDay {
  const from = `${date}T${pad(WINDOW_FROM_H)}:00`
  const to = `${addDays(date, 1)}T${pad(WINDOW_TO_H)}:00`
  const idx = hourly.map((h, i) => ({ h, i })).filter(({ h }) => h.time >= from && h.time < to)
  const hours = idx.map(({ h, i }) => judgeHour(h, hourly.slice(i + 1, i + 3), sun))

  let best: { s: number; e: number; marginal: number } | null = null
  let s = -1
  let marg = 0
  const close = (e: number) => {
    if (s >= 0 && (!best || e - s > best.e - best.s)) best = { s, e, marginal: marg }
    s = -1
    marg = 0
  }
  hours.forEach((h, i) => {
    if (h.ok && !h.bees) {
      if (s < 0) s = i
      if (h.marginal) marg++
    } else close(i)
  })
  close(hours.length)

  let window: SprayWindow | null = null
  const b = best as { s: number; e: number; marginal: number } | null
  if (b && b.e - b.s >= 2) {
    const last = hours[b.e - 1].time
    const endMin = minutesOf(last) + 60
    const end = new Date(endMin * 60_000).toISOString().slice(0, 16)
    window = { start: hours[b.s].time, end, hours: b.e - b.s, quality: b.marginal > (b.e - b.s) / 3 ? 'fair' : 'good' }
  }

  // What rules out the rest, most common first.
  const kind = (r: string) =>
    r.startsWith('wind') ? 'wind over 20 km/h' : r.startsWith('gusts') ? 'gusty' : r.includes('too cold') ? 'too cold' : r.includes('too hot') ? 'too hot' : r.startsWith('dry air') ? 'dry air' : r
  const counts = new Map<string, number>()
  for (const h of hours) {
    if (h.bees && h.ok) counts.set('bees flying', (counts.get('bees flying') ?? 0) + 1)
    if (!h.ok) for (const r of h.reasons) counts.set(kind(r), (counts.get(kind(r)) ?? 0) + 1)
  }
  const limits = [...counts.entries()].sort((a, c) => c[1] - a[1]).slice(0, 3).map(([k]) => k)

  const okHours = hours.filter((h) => h.ok).length
  let rating: Rating
  let summary: string
  if (!hours.length) {
    rating = 'poor'
    summary = 'No hourly forecast this far out.'
  } else if (window && window.hours >= 4 && window.quality === 'good') {
    rating = 'good'
    summary = `${okHours} sprayable hours; a ${window.hours}-hour bee-safe window.`
  } else if (window || okHours >= 3) {
    rating = 'fair'
    summary = !window
      ? `${okHours} sprayable hours, but only while bees are flying.`
      : window.hours < 4
        ? `Short window — ${window.hours} h.`
        : `${window.hours}-hour window, but near the limits (humid air or wind) for part of it.`
  } else {
    rating = 'poor'
    summary = limits.length ? `Not a spray day: ${limits.join(', ')}.` : 'Not a spray day.'
  }
  return { date, rating, summary, hours, window, limits }
}

/** "8 pm", "5 am Tue" — the end is named with its day when it is the next one. */
export function clockLabel(local: string, relativeTo?: string): string {
  const h = Number(local.slice(11, 13))
  const m = Number(local.slice(14, 16))
  const hr12 = h % 12 === 0 ? 12 : h % 12
  const ampm = h < 12 ? 'am' : 'pm'
  const base = `${hr12}${m ? `:${pad(m)}` : ''} ${ampm}`
  if (relativeTo && local.slice(0, 10) !== relativeTo) {
    const wd = new Date(`${local.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-CA', { weekday: 'short', timeZone: 'UTC' })
    return `${base} ${wd}`
  }
  return base
}

export type FertDay = { rating: Rating; summary: string; reasons: string[] }

/**
 * Surface-applied nitrogen (broadcast urea, dribbled UAN): is today a day for it?
 *
 * Urea left on the surface loses nitrogen to the air, fastest when it is warm,
 * breezy and the ground is damp but no rain follows. About 10 mm (0.4 in) of
 * rain or irrigation within two days works it in; a downpour over 25 mm moves
 * it off or down. Frozen ground and strong wind (a ragged spread pattern)
 * rule a day out.
 */
export function fertDay(day: ForecastDay, following: ForecastDay[]): FertDay {
  const reasons: string[] = []
  const rainAhead = [day, ...following.slice(0, 2)].reduce((a, d) => a + (d.precip ?? 0), 0)
  const downpour = [day, ...following.slice(0, 2)].some((d) => (d.precip ?? 0) > 25)
  const hi = day.hi ?? 15
  const wind = day.windMax ?? 0
  const gust = day.gustMax ?? wind
  if ((day.hi ?? 5) <= 0 || ((day.lo ?? 0) <= -5 && (day.precip ?? 0) > 0 && hi < 3)) {
    return { rating: 'poor', summary: 'Frozen or snow-covered ground — nitrogen would sit and run off.', reasons: ['frozen ground'] }
  }
  if (downpour) {
    return { rating: 'poor', summary: 'A downpour over 25 mm in the next three days — runoff and leaching risk.', reasons: ['heavy rain coming'] }
  }
  if (wind > 40 || gust > 60) {
    return { rating: 'poor', summary: `Wind to ${Math.round(Math.max(wind, gust))} km/h — the spread pattern will be ragged.`, reasons: ['wind'] }
  }
  let rating: Rating = 'fair'
  if (rainAhead >= 10) {
    rating = 'good'
    reasons.push(`${Math.round(rainAhead)} mm of rain in the next 3 days to work it in`)
  } else if (rainAhead >= 5) {
    reasons.push(`only ${Math.round(rainAhead)} mm of rain coming — a light incorporation`)
  } else {
    reasons.push('no rain to work it in')
    if (hi >= 20) {
      rating = 'poor'
      reasons.push(`warm (${Math.round(hi)}°) — urea on the surface loses N fast`)
    } else if (hi < 10) {
      reasons.push('cool, so losses are slow')
    }
  }
  if (wind > 30) {
    if (rating === 'good') rating = 'fair'
    reasons.push(`breezy (${Math.round(wind)} km/h) for spreading`)
  }
  const summary =
    rating === 'good'
      ? 'Good day to spread — rain will carry it in.'
      : rating === 'poor'
        ? 'Hold off on surface urea unless it has an inhibitor (Agrotain) or gets 0.5 in of irrigation within 2 days.'
        : rainAhead < 5
          ? 'Workable with a urease inhibitor, banding, or 0.5 in of pivot water within 2 days.'
          : 'Workable — some rain to help it in.'
  return { rating, summary, reasons }
}
