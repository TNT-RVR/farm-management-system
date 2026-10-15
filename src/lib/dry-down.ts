import { emc, type EmcGroup } from './grain-emc'

/**
 * When will this crop be dry enough to combine? A first guess from the
 * weather, made better by every meter reading the farm takes.
 *
 * GRAIN FOLLOWS THE AIR (Sam, 9 Oct 2026). Each hour the crop's moisture
 * moves part of the way towards the moisture it would settle at in that
 * hour's air, its equilibrium moisture content (grain-emc.ts):
 *
 *   m_next = E + (m − E) × e^(−k)
 *
 * By day E comes from the afternoon high and its humidity, which for canola
 * at 22 °C and 25% is about 4%, so the crop dries. By night it comes from the
 * overnight low and its humidity, about 15% for canola, so the crop takes some
 * back. That is why a morning sample can read higher than the afternoon
 * before, which the first version could only treat as a mistake. Rain lands
 * at the end of the day and adds moisture outright.
 *
 * k, how fast the crop follows the air, is the part that is learned. It
 * starts from a cautious figure for the crop group (PRIORS) and wind and sun
 * speed it up in daylight. Every pair of meter readings on a field pulls the
 * numbers towards what this farm's crop actually did. With no readings the
 * starting point is the answer and the range on the chart is wide; as pairs
 * accumulate they outweigh it. Fitting is a penalised least squares: misses
 * against readings (a meter is good to about a point) plus distance from the
 * starting figures.
 *
 * Replaces the 7 Oct version, which learned only from the farm's readings
 * with nothing to start from: noisy early readings went up as often as down,
 * it learned no drying at all, and Moreau W ½ showed a level line (9 Oct).
 *
 * TIME OF DAY COUNTS. The clock runs hour by hour, so two samples from one
 * day pair like any other, and so do an evening and a morning one.
 *
 * HOURLY WEATHER (9 Oct 2026). Where the station has hours (weather_hourly,
 * Open-Meteo's hourly model at the station), each hour is its own air, its own
 * wind and its own rain, and daylight is when the sun is actually up. The
 * hours are rescaled so the day still matches the station's own observed
 * high, low, humidity range and rain (shapeHours): the model gives the shape
 * of the day, the station its size. A day without hours falls back to the
 * daily high by day and low by night.
 *
 * SWATHED AND DESICCATED. A swath dries (and re-wets) faster than a standing
 * crop, and a crop killed with Reglone faster than a live one. Each is a
 * learned multiplier on the rate, starting at 1.6× and 1.3×, so the farm's
 * readings on swathed and sprayed fields tune their own speed.
 *
 * HOW IT IS DOING (scoreFrom). Every reading after the first on a field is
 * also a test of the model: what would it have said, from the reading before
 * and only the pairs known by then? The running miss per crop group is on the
 * card, beside what the starting figures alone would have missed by.
 *
 * DESICCATION STARTS THE CLOCK: a field's tests from before its Reglone pass
 * were taken on a live plant and are not drying data.
 */

/** A product that kills the crop to dry it down. Matched on the names Deere records. */
export const DESICCANT = /reglone|diquat|desiccat/i

/** Percent, wet basis — what a moisture meter reads. */
type Pct = number

export type HarvestMethod = 'swathed' | 'straight'

export type WeatherDay = {
  date: string
  tmaxC: number | null
  tminC: number | null
  rhMin: number | null
  rhMax: number | null
  rainMm: number | null
  /** Daily mean wind, m/s. */
  windMs: number | null
  /** Daily solar radiation, MJ/m². */
  solarMj: number | null
  /** From a forecast, not a measurement. */
  forecast: boolean
}

/** A reading: its farm-local date, the hour it was taken (0-24, fractional), and the meter's figure. */
export type Test = { date: string; hour?: number; pct: Pct }

/** Daylight, when the afternoon air is doing the drying: 8 am to 6 pm farm time. */
export const DAY_START = 8
export const DAY_END = 18
/** The hour a prediction is for: mid-afternoon, when the meter is read and the combine runs. */
export const PREDICT_HOUR = 15

/** Share of a day's daylight between two hours of it. */
export const daylight = (fromHour: number, toHour: number) => {
  const c = (h: number) => Math.min(DAY_END, Math.max(DAY_START, h))
  return Math.max(0, c(toHour) - c(fromHour)) / (DAY_END - DAY_START)
}
const hourOf = (t: Test) => t.hour ?? PREDICT_HOUR
const isDay = (h: number) => h >= DAY_START && h < DAY_END

function saturation(tC: number) {
  return 0.6108 * Math.exp((17.27 * tC) / (tC + 237.3))
}

/**
 * The air at an hour of a day: by day the high and its (lowest) humidity, by
 * night the low and its (highest). Missing humidity is worked out from the
 * day's low as its dew point by day (the FAO-56 fallback) and taken as 90%
 * at night, and says so. Null when the day has no temperatures.
 */
export function airAt(d: WeatherDay, hour: number): { tC: number; rh: number; estimated: boolean } | null {
  if (isDay(hour)) {
    if (d.tmaxC == null) return null
    if (d.rhMin != null) return { tC: d.tmaxC, rh: d.rhMin, estimated: false }
    if (d.tminC == null) return null
    return { tC: d.tmaxC, rh: Math.min(100, (100 * saturation(Math.min(d.tminC, d.tmaxC))) / saturation(d.tmaxC)), estimated: true }
  }
  if (d.tminC == null) return null
  return { tC: d.tminC, rh: d.rhMax ?? 90, estimated: d.rhMax == null }
}

/**
 * How fast the crop follows the air, and what rain does. kDay and kNight are
 * natural logs of a per-hour share; swath and desic are natural logs of the
 * multiplier on both for a swathed crop and for one after its desiccant pass.
 */
export type Params = { kDay: number; kNight: number; wind: number; sun: number; rain: number; swath: number; desic: number }
export type Model = Params & { group: EmcGroup }

/** One hour's weather at the station, after shapeHours. */
export type Hour = { tC: number | null; rh: number | null; rainMm: number | null; windMs: number | null; solarWm2: number | null }
/** Hours keyed `${farm date}|${hour 0-23}`. */
export type Hours = Map<string, Hour>
/** What is true of the field the readings came off. */
export type FieldCtx = { swathed: boolean; desiccatedOn: string | null }
export type StepOpts = { hours?: Hours; ctx?: FieldCtx }
/** Above this the sun is up for drying, W/m². */
const SUN_UP = 50

/** A typical day's wind (m/s) and sunshine (MJ/m²): the starting kDay is for a day like this. */
const WIND0 = 3
const SUN0 = 12
/** No more than this many points from one day's rain. */
const RAIN_CAP = 5

/**
 * Where each crop group starts. kDay is the share of the gap to the
 * afternoon air's moisture closed per daylight hour, kNight the same at
 * night; wind and sun are per m/s and per MJ/m² on the log of kDay; rain is
 * points per mm. Cautious figures for a mature crop in the field — canola
 * and pulses quick, cereals slower, standing corn slowest — that the farm's
 * own readings then move.
 */
const RATES: Record<EmcGroup, Omit<Params, 'swath' | 'desic'>> = {
  canola: { kDay: Math.log(0.025), kNight: Math.log(0.004), wind: 0.04, sun: 0.03, rain: 0.3 },
  peas: { kDay: Math.log(0.02), kNight: Math.log(0.004), wind: 0.04, sun: 0.03, rain: 0.3 },
  wheat: { kDay: Math.log(0.015), kNight: Math.log(0.003), wind: 0.04, sun: 0.03, rain: 0.25 },
  barley: { kDay: Math.log(0.015), kNight: Math.log(0.003), wind: 0.04, sun: 0.03, rain: 0.25 },
  oats: { kDay: Math.log(0.015), kNight: Math.log(0.003), wind: 0.04, sun: 0.03, rain: 0.25 },
  corn: { kDay: Math.log(0.006), kNight: Math.log(0.0015), wind: 0.03, sun: 0.02, rain: 0.1 },
}
/** A swath 1.6× as quick as a standing crop, a desiccated crop 1.3× a live one, to start. */
export const PRIORS = Object.fromEntries(
  Object.entries(RATES).map(([g, r]) => [g, { ...r, swath: Math.log(1.6), desic: Math.log(1.3) }]),
) as Record<EmcGroup, Params>
/** How far the readings may pull each figure before it costs as much as a point's miss. */
const PRIOR_SD: Params = { kDay: 0.7, kNight: 0.7, wind: 0.04, sun: 0.03, rain: 0.3, swath: 0.5, desic: 0.5 }
/** A meter is good to about a point. */
const METER_SD = 1
const KEYS: (keyof Params)[] = ['kDay', 'kNight', 'wind', 'sun', 'rain', 'swath', 'desic']

export function startingModel(group: EmcGroup): Model {
  return { ...PRIORS[group], group }
}

const nextDate = (d: string) => {
  const t = new Date(`${d}T12:00:00Z`)
  t.setUTCDate(t.getUTCDate() + 1)
  return t.toISOString().slice(0, 10)
}

const indexByDate = (days: WeatherDay[]) => new Map(days.map((d) => [d.date, d]))

/**
 * Raw station hours, rescaled day by day to the station's own daily figures:
 * temperature stretched to its observed low and high, humidity to its
 * observed range, rain to its observed total (all of it at 5 pm when the
 * hours had none). A day with fewer than 20 hours is left to the daily step.
 */
export function shapeHours(days: WeatherDay[], raw: Hours): Hours {
  const out: Hours = new Map()
  const byDay = new Map<string, [number, Hour][]>()
  for (const [key, h] of raw) {
    const [date, hr] = key.split('|')
    const list = byDay.get(date) ?? []
    list.push([Number(hr), h])
    byDay.set(date, list)
  }
  const daily = indexByDate(days)
  const stretch = (v: number, lo: number, hi: number, toLo: number, toHi: number) => (hi > lo ? toLo + ((v - lo) * (toHi - toLo)) / (hi - lo) : (toLo + toHi) / 2)
  for (const [date, list] of byDay) {
    if (list.length < 20) continue
    const d = daily.get(date)
    const temps = list.map(([, h]) => h.tC).filter((v): v is number => v != null)
    const rhs = list.map(([, h]) => h.rh).filter((v): v is number => v != null)
    const tLo = Math.min(...temps), tHi = Math.max(...temps)
    const rLo = Math.min(...rhs), rHi = Math.max(...rhs)
    const rainSum = list.reduce((s, [, h]) => s + (h.rainMm ?? 0), 0)
    for (const [hr, h] of list) {
      const tC = h.tC == null ? null : d?.tmaxC != null && d.tminC != null && temps.length ? stretch(h.tC, tLo, tHi, d.tminC, d.tmaxC) : h.tC
      const rh = h.rh == null ? null : d?.rhMin != null && d.rhMax != null && rhs.length ? Math.min(100, Math.max(0, stretch(h.rh, rLo, rHi, d.rhMin, d.rhMax))) : h.rh
      let rainMm = h.rainMm
      if (d?.rainMm != null) rainMm = rainSum > 0 ? ((h.rainMm ?? 0) * d.rainMm) / rainSum : hr === 17 ? d.rainMm : 0
      out.set(`${date}|${hr}`, { ...h, tC, rh, rainMm })
    }
  }
  return out
}

/**
 * Moisture from one reading to a later moment, hour by hour through the
 * weather between. An hour of a day with no temperatures holds the crop
 * where it was; a day's rain lands at the end of its daylight.
 */
export function moistureAt(m: Model, byDate: Map<string, WeatherDay>, from: Test, toDate: string, toHour: number, opts: StepOpts = {}): Pct {
  let pct = from.pct
  let date = from.date
  let h = hourOf(from)
  const ctx = opts.ctx
  while (date < toDate || (date === toDate && h < toHour)) {
    const end = date === toDate ? Math.min(toHour, Math.floor(h) + 1) : Math.floor(h) + 1
    const w = byDate.get(date)
    const hr = opts.hours?.get(`${date}|${Math.floor(h)}`)
    // The field's state multiplies the rate, day and night.
    const state = (ctx?.swathed ? m.swath : 0) + (ctx?.desiccatedOn && date >= ctx.desiccatedOn ? m.desic : 0)
    if (hr && hr.tC != null && hr.rh != null) {
      const sunUp = hr.solarWm2 != null ? hr.solarWm2 > SUN_UP : isDay(h)
      const k = sunUp
        ? Math.exp(m.kDay + state + m.wind * ((hr.windMs ?? w?.windMs ?? WIND0) - WIND0) + m.sun * ((w?.solarMj ?? SUN0) - SUN0))
        : Math.exp(m.kNight + state)
      const e = emc(m.group, hr.tC, hr.rh)
      pct = e + (pct - e) * Math.exp(-k * (end - h))
      pct += Math.min(RAIN_CAP, Math.max(0, m.rain) * (hr.rainMm ?? 0) * (end - h))
    } else {
      const air = w ? airAt(w, h) : null
      if (w && air) {
        const k = isDay(h)
          ? Math.exp(m.kDay + state + m.wind * ((w.windMs ?? WIND0) - WIND0) + m.sun * ((w.solarMj ?? SUN0) - SUN0))
          : Math.exp(m.kNight + state)
        const e = emc(m.group, air.tC, air.rh)
        pct = e + (pct - e) * Math.exp(-k * (end - h))
      }
      if (w && h < DAY_END && end >= DAY_END) pct += Math.min(RAIN_CAP, Math.max(0, m.rain) * (w.rainMm ?? 0))
    }
    h = end
    if (h >= 24) {
      h = 0
      date = nextDate(date)
    }
  }
  return pct
}

/** From a reading through `days`, each later day's predicted mid-afternoon moisture. */
export function runFrom(m: Model, days: WeatherDay[], from: Test, opts: StepOpts = {}) {
  const byDate = indexByDate(days)
  const out = new Map<string, Pct>()
  for (const d of days) {
    if (d.date <= from.date) continue
    out.set(d.date, moistureAt(m, byDate, from, d.date, PREDICT_HOUR, opts))
  }
  return out
}

/** Two meter readings on one field, the weather between, and the field's state. */
export type Pair = { from: Test; to: Test; days: WeatherDay[]; hours?: Hours; ctx?: FieldCtx }

/**
 * Consecutive readings on one field, made into pairs, fifteen minutes or more
 * apart. Night pairs count now: what the crop takes back overnight is part of
 * the model. Pairs more than ten days apart are left out.
 */
export function pairsFrom(tests: Test[], days: WeatherDay[], opts: StepOpts = {}): Pair[] {
  const at = (t: Test) => Date.parse(`${t.date}T00:00:00Z`) + hourOf(t) * 3_600_000
  const sorted = [...tests].sort((a, b) => at(a) - at(b))
  const out: Pair[] = []
  for (let i = 1; i < sorted.length; i++) {
    const from = sorted[i - 1]
    const to = sorted[i]
    const hours = (at(to) - at(from)) / 3_600_000
    // Fifteen minutes is enough to be two samples, not one sample read twice.
    if (hours < 0.25 || hours > 240) continue
    out.push({ from, to, days: days.filter((d) => d.date >= from.date && d.date <= to.date), hours: opts.hours, ctx: opts.ctx })
  }
  return out
}

export type Learned = { model: Model; rmse: number | null; pairs: number }

/**
 * The crop group's model: the starting figures, moved as far as its pairs of
 * readings justify. Coordinate descent with shrinking steps; five numbers
 * and a handful of pairs, so a plain search is exact enough.
 */
export function fit(pairs: Pair[], group: EmcGroup): Learned {
  const prior = PRIORS[group]
  const usable = pairs.filter((p) => p.days.length).map((p) => ({ ...p, byDate: indexByDate(p.days) }))
  const miss = (m: Model) => usable.map((p) => moistureAt(m, p.byDate, p.from, p.to.date, hourOf(p.to), p) - p.to.pct)
  const loss = (q: Params) => {
    const m = { ...q, group }
    let l = 0
    for (const e of miss(m)) l += (e / METER_SD) ** 2
    for (const k of KEYS) l += ((q[k] - prior[k]) / PRIOR_SD[k]) ** 2
    return l
  }
  let q: Params = { ...prior }
  if (usable.length) {
    let best = loss(q)
    const step: Params = { kDay: 0.35, kNight: 0.35, wind: 0.02, sun: 0.015, rain: 0.15, swath: 0.25, desic: 0.25 }
    for (let round = 0; round < 40; round++) {
      let improved = false
      for (const k of KEYS) {
        for (const dir of [1, -1]) {
          const trial = { ...q, [k]: q[k] + dir * step[k] }
          const l = loss(trial)
          if (l < best - 1e-9) {
            q = trial
            best = l
            improved = true
          }
        }
      }
      if (!improved) for (const k of KEYS) step[k] /= 2
    }
  }
  const model = { ...q, group }
  const errs = miss(model)
  return { model, rmse: errs.length ? Math.sqrt(errs.reduce((s, e) => s + e * e, 0) / errs.length) : null, pairs: usable.length }
}

export type Score = {
  /** Readings it was tested on. */
  n: number
  /** Average miss, points, predicting each reading from the one before with what was known then. */
  mae: number
  /** The same for the starting figures alone, never tuned. */
  maeStart: number
  /** Average signed miss: above 0 it guesses wetter than the meter reads. */
  bias: number
  /** The latest few, newest first. */
  recent: { date: string; predicted: number; actual: number }[]
}

/**
 * How well the model has done, honestly: each pair's second reading predicted
 * from its first on a model fitted only to pairs finished before it began.
 * Null with no pairs.
 */
export function scoreFrom(pairs: Pair[], group: EmcGroup, limit = 25): Score | null {
  const at = (t: Test) => Date.parse(`${t.date}T00:00:00Z`) + hourOf(t) * 3_600_000
  const sorted = [...pairs].filter((p) => p.days.length).sort((a, b) => at(a.to) - at(b.to)).slice(-limit)
  if (!sorted.length) return null
  const start = startingModel(group)
  const rows = sorted.map((p) => {
    const known = sorted.filter((q) => at(q.to) <= at(p.from))
    const m = known.length ? fit(known, group).model : start
    const byDate = indexByDate(p.days)
    const predicted = moistureAt(m, byDate, p.from, p.to.date, hourOf(p.to), p)
    const fromStart = moistureAt(start, byDate, p.from, p.to.date, hourOf(p.to), p)
    return { date: p.to.date, predicted, actual: p.to.pct, startMiss: Math.abs(fromStart - p.to.pct) }
  })
  const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length
  return {
    n: rows.length,
    mae: avg(rows.map((r) => Math.abs(r.predicted - r.actual))),
    maeStart: avg(rows.map((r) => r.startMiss)),
    bias: avg(rows.map((r) => r.predicted - r.actual)),
    recent: rows
      .slice(-5)
      .reverse()
      .map(({ date, predicted, actual }) => ({ date, predicted, actual })),
  }
}

export type Forecast = {
  desiccatedOn?: string | null
  /** How many pairs of readings, across every field of this crop group, tuned the model. */
  pairs: number
  /** How many of this field's tests the prediction starts from. */
  tests: number
  rmse: number | null
  model: Model
  /** Predicted afternoon moisture for each day after the last test. */
  days: { date: string; pct: Pct; low: Pct; high: Pct; forecast: boolean; rain: boolean }[]
  /** The same, every hour on the hour from the last test (Sam, 10 Oct 2026): the chart's "By hour". */
  hourly: { date: string; hour: number; pct: Pct; low: Pct; high: Pct; forecast: boolean }[]
  /** The first day predicted at or below dryMax, if any in range. */
  readyOn: string | null
  dryMax: number
}

/**
 * The field's prediction, from its latest reading forward.
 *
 * The range starts at a point and a half on the starting figures alone, or
 * the model's own miss on its pairs once there are three, and widens each
 * day, more on forecast days and after forecast rain.
 */
export function predict(opts: {
  tests: Test[]
  weather: WeatherDay[]
  dryMax: number
  learned: Learned | null
  /** The last day of a desiccant pass, if the crop was sprayed. */
  desiccatedOn?: string | null
  /** The station's hours, shaped (shapeHours). */
  hours?: Hours
  swathed?: boolean
}): Forecast | null {
  const tests = opts.desiccatedOn ? opts.tests.filter((t) => t.date >= opts.desiccatedOn!) : opts.tests
  if (!opts.learned || !tests.length) return null
  const days = [...opts.weather].sort((a, b) => a.date.localeCompare(b.date))
  const last = [...tests].sort((a, b) => b.date.localeCompare(a.date) || hourOf(b) - hourOf(a))[0]
  const run = runFrom(opts.learned.model, days, last, { hours: opts.hours, ctx: { swathed: Boolean(opts.swathed), desiccatedOn: opts.desiccatedOn ?? null } })
  const base = opts.learned.pairs >= 3 && opts.learned.rmse != null ? Math.max(0.5, opts.learned.rmse) : 1.5
  let n = 0
  let wet = 0
  const out: Forecast['days'] = []
  for (const d of days) {
    if (d.date <= last.date || !run.has(d.date)) continue
    n++
    const rain = (d.rainMm ?? 0) > 1
    if (rain && d.forecast) wet += 1
    const spread = base + wet + n * (d.forecast ? 0.4 : 0.25)
    const pct = run.get(d.date)!
    out.push({ date: d.date, pct, low: Math.max(0, pct - spread), high: pct + spread, forecast: d.forecast, rain })
  }
  // Hour by hour from the last test, each hour stepped on from the one
  // before; the range grows through the day the way the daily one does.
  const stepOpts = { hours: opts.hours, ctx: { swathed: Boolean(opts.swathed), desiccatedOn: opts.desiccatedOn ?? null } }
  const byDate = indexByDate(days)
  const lastDay = days.at(-1)?.date
  const hourly: Forecast['hourly'] = []
  if (lastDay) {
    let cur: Test = { date: last.date, hour: hourOf(last), pct: last.pct }
    let date = last.date
    let hour = Math.floor(hourOf(last)) + 1
    let wetH = 0
    let elapsed: number
    let rainDay: string | null = null
    while (date < lastDay || (date === lastDay && hour <= 23)) {
      if (hour >= 24) {
        hour = 0
        date = nextDate(date)
        continue
      }
      const pctH = moistureAt(opts.learned.model, byDate, cur, date, hour, stepOpts)
      elapsed = (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${last.date}T00:00:00Z`)) / 3_600_000 + hour - hourOf(last)
      const w = byDate.get(date)
      if (w?.forecast && (w.rainMm ?? 0) > 1 && rainDay !== date) {
        wetH += 1
        rainDay = date
      }
      const spread = base + wetH + (elapsed / 24) * (w?.forecast ? 0.4 : 0.25)
      hourly.push({ date, hour, pct: pctH, low: Math.max(0, pctH - spread), high: pctH + spread, forecast: Boolean(w?.forecast) })
      cur = { date, hour, pct: pctH }
      hour++
    }
  }
  const ready = last.pct <= opts.dryMax ? last.date : (out.find((d) => d.pct <= opts.dryMax)?.date ?? null)
  return {
    desiccatedOn: opts.desiccatedOn ?? null,
    pairs: opts.learned.pairs,
    tests: tests.length,
    rmse: opts.learned.pairs >= 3 ? opts.learned.rmse : null,
    model: opts.learned.model,
    days: out,
    hourly,
    readyOn: ready,
    dryMax: opts.dryMax,
  }
}

/**
 * Where a field sits in "closest to being ready" order (Sam, 7 Oct 2026),
 * lower first: dry now or the soonest predicted dry day; then fields not dry
 * within the forecast, by how far the last predicted day is above dry; then
 * fields with no prediction yet (a test to take), by their last reading.
 */
export function readinessKey(d: { forecast: Forecast | null; tests: { date: string; pct: number }[] } | undefined): [number, string | number] {
  if (!d) return [3, 0]
  const f = d.forecast
  if (f?.readyOn) return [0, f.readyOn]
  if (f) {
    const lastDay = f.days.at(-1)
    return [1, lastDay ? Number(lastDay.pct) - f.dryMax : Number.MAX_SAFE_INTEGER]
  }
  return [2, d.tests.at(-1)?.pct ?? Number.MAX_SAFE_INTEGER]
}

export function compareReadiness(a: [number, string | number], b: [number, string | number]): number {
  if (a[0] !== b[0]) return a[0] - b[0]
  return typeof a[1] === 'string' && typeof b[1] === 'string' ? a[1].localeCompare(b[1]) : Number(a[1]) - Number(b[1])
}
