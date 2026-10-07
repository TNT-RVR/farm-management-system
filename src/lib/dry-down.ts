/**
 * When will this crop be dry enough to combine? Learned from this farm's own
 * moisture tests and its own weather — nothing else.
 *
 * NO OUTSIDE CROP DATA (Sam, 7 Oct 2026). The first version took published
 * moisture curves for canola, corn and beans from lab studies elsewhere. They
 * are gone: a curve fitted to someone else's seed in an oven is not this
 * farm's field. What is left is a shape and the farm's numbers in it:
 *
 *   each day the crop loses a share of its moisture,
 *     m_next = m × e^(−rate) + rain × β_rain
 *   and the share depends on that day's weather,
 *     rate = β0 + β_vpd·VPD + β_wind·wind + β_sun·sunshine
 *
 * VPD (vapour pressure deficit) is how dry the afternoon air is, worked out
 * from the station's own temperature and humidity. Wind and sunshine are the
 * station's own readings. The β's are fitted to this farm's tests and nothing
 * else: every pair of meter readings on one field on different days says how
 * much came off in the weather between them.
 *
 * LITTLE DATA, SIMPLE ANSWER. With one pair the fit cannot tell wind from sun
 * from dry air, so the weather weights are held back (a ridge penalty) and
 * the pair sets a plain daily rate. As pairs accumulate, the data overrides
 * the penalty and wind, sun and dry air take the weight they actually have on
 * this farm. A crop with no pair yet gets no prediction at all.
 *
 * Each crop learns on its own (BASF Canola is not Corteva Canola), from every
 * field and every year of it. A crop with nothing to learn from yet borrows
 * the whole farm's model, so a field gets an idea from its first sample.
 *
 * TIME OF DAY COUNTS. Drying happens in daylight, so the clock the model runs
 * on is daylight hours (8 am to 6 pm). Two samples from one day — a morning
 * and an afternoon — are a pair like any other: they say how much came off in
 * those hours of that day's weather. The 2026 pinto tests were all taken in
 * same-day pairs and taught nothing to a once-a-day model.
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

/** Daylight, when drying happens: 8 am to 6 pm farm time. */
export const DAY_START = 8
export const DAY_END = 18
/** The hour a prediction is for: mid-afternoon, when the meter is read and the combine runs. */
export const PREDICT_HOUR = 15

/** Share of a day's drying between two hours of it. */
export const daylight = (fromHour: number, toHour: number) => {
  const c = (h: number) => Math.min(DAY_END, Math.max(DAY_START, h))
  return Math.max(0, c(toHour) - c(fromHour)) / (DAY_END - DAY_START)
}
const hourOf = (t: Test) => t.hour ?? PREDICT_HOUR

function saturation(tC: number) {
  return 0.6108 * Math.exp((17.27 * tC) / (tC + 237.3))
}

/**
 * The afternoon's vapour pressure deficit, kPa: how much more water the air
 * could hold at the day's high. From the day's own temperature and humidity;
 * with no humidity, the day's low is taken as its dew point (the FAO-56
 * fallback), and the card says so.
 */
export function vpd(d: WeatherDay): { kPa: number; estimated: boolean } | null {
  if (d.tmaxC == null) return null
  const es = saturation(d.tmaxC)
  if (d.rhMin != null) return { kPa: es * (1 - d.rhMin / 100), estimated: false }
  if (d.tminC == null) return null
  return { kPa: Math.max(0, es - saturation(d.tminC)), estimated: true }
}

/** One day's weather as the model sees it. Null when a day lacks what it needs. */
export function features(d: WeatherDay): { vpd: number; wind: number; sun: number; rain: number } | null {
  const v = vpd(d)
  if (!v || d.windMs == null || d.solarMj == null) return null
  return { vpd: v.kPa, wind: d.windMs, sun: d.solarMj, rain: d.rainMm ?? 0 }
}

export type Model = {
  b0: number
  vpd: number
  wind: number
  sun: number
  rain: number
  /** The weather the readings it learned from were taken in. Outside it, the model does not guess. */
  seen?: Seen
}

/** The range of each condition across the days a model learned from. */
export type Seen = { vpd: [number, number]; rain: [number, number]; tmax: [number, number] }

/**
 * Whether a day's weather is outside anything the model has learned from.
 *
 * A model fitted only on dry, sunny days has no idea what a day of rain does,
 * and the first one it met — 2.4 mm and near freezing, 10 Oct 2026 — it
 * kept drying straight through. Nothing from outside the farm may say what
 * rain does, so on such a day the model says nothing: the crop is held where
 * it was and the day is marked. A test taken after the rain teaches it.
 */
export function unseen(m: Model, d: WeatherDay): boolean {
  const s = m.seen
  const f = features(d)
  if (!s || !f) return false
  // Rain only. A cooler or damper day changes how FAST the crop dries, which
  // the steady rate carries well enough; rain puts water back, which is a
  // different thing, and guessing at it is exactly what the farm ruled out.
  // (Checking temperature too flagged every day under 20 °C, because the only
  // canola pair was taken on two 25 °C days, and the prediction went flat.)
  return f.rain > s.rain[1] + 0.5
}

export const ZERO_MODEL: Model = { b0: 0, vpd: 0, wind: 0, sun: 0, rain: 0 }

export function rateOf(m: Model, f: NonNullable<ReturnType<typeof features>>) {
  // A day can be wet enough to stop drying; it cannot dry a negative amount.
  return Math.max(0, m.b0 + m.vpd * f.vpd + m.wind * f.wind + m.sun * f.sun)
}

/**
 * Moisture from one reading to a later moment, through the weather between.
 *
 * Each day dries for the share of its daylight that falls inside the span;
 * a day's rain lands once the span has run past that day's daylight. A day
 * missing its weather holds the crop where it was.
 */
export function moistureAt(m: Model, byDate: Map<string, WeatherDay>, from: Test, toDate: string, toHour: number): Pct {
  let pct = from.pct
  for (let d = from.date; d <= toDate; d = nextDate(d)) {
    const f = byDate.has(d) ? features(byDate.get(d)!) : null
    const start = d === from.date ? hourOf(from) : 0
    const end = d === toDate ? toHour : 24
    if (!f || unseen(m, byDate.get(d)!)) continue
    pct *= Math.exp(-rateOf(m, f) * daylight(start, end))
    // Rain on a day the span covers to its end; the day the span starts on only if it started before the rain could fall.
    if (end >= DAY_END && start < DAY_END) pct += m.rain * f.rain
  }
  return pct
}

const nextDate = (d: string) => {
  const t = new Date(`${d}T12:00:00Z`)
  t.setUTCDate(t.getUTCDate() + 1)
  return t.toISOString().slice(0, 10)
}

const indexByDate = (days: WeatherDay[]) => new Map(days.map((d) => [d.date, d]))

/** From a reading through `days`, each later day's predicted mid-afternoon moisture. */
export function runFrom(m: Model, days: WeatherDay[], from: Test) {
  const byDate = indexByDate(days)
  const out = new Map<string, Pct>()
  for (const d of days) {
    if (d.date <= from.date) continue
    out.set(d.date, moistureAt(m, byDate, from, d.date, PREDICT_HOUR))
  }
  return out
}

/** Two meter readings on one field, a day or more apart, and the weather between. */
export type Pair = { from: Test; to: Test; days: WeatherDay[] }

/**
 * Consecutive readings on one field, made into pairs — same-day readings
 * included, fifteen minutes or more apart. Pairs more than ten days apart are left
 * out: by then rain and re-wetting have happened in ways one rate cannot carry.
 */
export function pairsFrom(tests: Test[], days: WeatherDay[]): Pair[] {
  const at = (t: Test) => Date.parse(`${t.date}T00:00:00Z`) + hourOf(t) * 3_600_000
  const sorted = [...tests].sort((a, b) => at(a) - at(b))
  const out: Pair[] = []
  for (let i = 1; i < sorted.length; i++) {
    const from = sorted[i - 1]
    const to = sorted[i]
    const hours = (at(to) - at(from)) / 3_600_000
    // Fifteen minutes is enough to be two samples, not one sample read twice.
    // It was an hour, which threw out both same-day pinto pairs in 2026
    // (39 and 57 minutes apart) and left the crop one pair to learn from.
    if (hours < 0.25 || hours > 240) continue
    // Two readings in the night or early morning saw no daylight between them: nothing to learn.
    if (from.date === to.date && daylight(hourOf(from), hourOf(to)) === 0) continue
    out.push({ from, to, days: days.filter((d) => d.date >= from.date && d.date <= to.date) })
  }
  return out
}

/** How strongly the weather weights are held back until the data says otherwise. */
export const RIDGE = 0.5

/** The model's error on a set of pairs, plus the penalty on the weather weights. */
function loss(m: Model, pairs: Pair[], scale: { vpd: number; wind: number; sun: number; rain: number }) {
  let err = 0
  for (const p of pairs) {
    const got = moistureAt(m, indexByDate(p.days), p.from, p.to.date, hourOf(p.to))
    err += (got - p.to.pct) ** 2
  }
  // Penalised in standardised units, so a weight is not cheap just because its input is large.
  const pen = (m.vpd * scale.vpd) ** 2 + (m.wind * scale.wind) ** 2 + (m.sun * scale.sun) ** 2 + (m.rain * scale.rain) ** 2
  return err + RIDGE * pen
}

/**
 * The model that best explains this crop's pairs.
 *
 * Coordinate descent with shrinking steps: five numbers and a handful of
 * pairs, so a plain search is exact enough and has no dependency to go wrong.
 */
export function fit(pairs: Pair[]): { model: Model; rmse: number; pairs: number } | null {
  const usable = pairs.filter((p) => p.days.some((d) => features(d)))
  if (!usable.length) return null
  // Typical size of each input, for the penalty's scale.
  const all = usable.flatMap((p) => p.days.map(features).filter((f): f is NonNullable<typeof f> => f != null))
  const sd = (xs: number[]) => {
    const mean = xs.reduce((s, x) => s + x, 0) / xs.length
    return Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length) || 1
  }
  const scale = { vpd: sd(all.map((f) => f.vpd)), wind: sd(all.map((f) => f.wind)), sun: sd(all.map((f) => f.sun)), rain: sd(all.map((f) => f.rain)) }

  let m: Model = { ...ZERO_MODEL, b0: 0.1 }
  let best = loss(m, usable, scale)
  type Coef = Exclude<keyof Model, 'seen'>
  const keys: Coef[] = ['b0', 'vpd', 'wind', 'sun', 'rain']
  // Starting steps, each about one standardised unit of its input.
  const stepOf: Record<Coef, number> = { b0: 0.1, vpd: 0.1 / scale.vpd, wind: 0.1 / scale.wind, sun: 0.1 / scale.sun, rain: 0.5 / scale.rain }
  for (let round = 0; round < 40; round++) {
    let improved = false
    for (const k of keys) {
      for (const dir of [1, -1]) {
        const trial = { ...m, [k]: m[k] + dir * stepOf[k] }
        const l = loss(trial, usable, scale)
        if (l < best - 1e-12) {
          m = trial
          best = l
          improved = true
        }
      }
    }
    if (!improved) for (const k of keys) stepOf[k] /= 2
  }
  let sq = 0
  for (const p of usable) sq += (moistureAt(m, indexByDate(p.days), p.from, p.to.date, hourOf(p.to)) - p.to.pct) ** 2
  const seenDays = usable.flatMap((p) => p.days).filter((d) => features(d))
  const span = (xs: number[]): [number, number] => [Math.min(...xs), Math.max(...xs)]
  const seen: Seen = {
    vpd: span(seenDays.map((d) => features(d)!.vpd)),
    rain: span(seenDays.map((d) => features(d)!.rain)),
    tmax: span(seenDays.map((d) => d.tmaxC ?? 0)),
  }
  return { model: { ...m, seen }, rmse: Math.sqrt(sq / usable.length), pairs: usable.length }
}

export type Forecast = {
  desiccatedOn?: string | null
  /** How many test pairs, across every field of this crop, the model learned from. */
  pairs: number
  /** How many of this field's tests the prediction starts from. */
  tests: number
  rmse: number | null
  model: Model
  /** Predicted afternoon moisture for each day after the last test. */
  days: { date: string; pct: Pct; low: Pct; high: Pct; forecast: boolean; unseen: boolean }[]
  /** The first day predicted at or below dryMax, if any in range. */
  readyOn: string | null
  dryMax: number
}

/**
 * The field's prediction, from its latest reading forward, on its crop's model.
 *
 * The band starts from the model's own error on its pairs (a point when there
 * are too few to say) and widens a point a day, more on forecast days.
 */
export function predict(opts: {
  tests: Test[]
  weather: WeatherDay[]
  dryMax: number
  learned: { model: Model; rmse: number; pairs: number } | null
  /** The last day of a desiccant pass, if the crop was sprayed. */
  desiccatedOn?: string | null
}): Forecast | null {
  const tests = opts.desiccatedOn ? opts.tests.filter((t) => t.date >= opts.desiccatedOn!) : opts.tests
  if (!opts.learned || !tests.length) return null
  const days = [...opts.weather].sort((a, b) => a.date.localeCompare(b.date))
  const last = [...tests].sort((a, b) => b.date.localeCompare(a.date) || hourOf(b) - hourOf(a))[0]
  const run = runFrom(opts.learned.model, days, last)
  const base = opts.learned.pairs >= 3 ? Math.max(0.3, opts.learned.rmse) : 1
  let n = 0
  // Once a day the model has not seen is passed, every day after it is less certain too.
  let widen = 0
  const out: Forecast['days'] = []
  for (const d of days) {
    if (d.date <= last.date || !run.has(d.date)) continue
    n++
    const odd = unseen(opts.learned.model, d)
    if (odd) widen += 3
    const spread = base + widen + n * (d.forecast ? 0.8 : 0.5)
    const pct = run.get(d.date)!
    out.push({ date: d.date, pct, low: Math.max(0, pct - spread), high: pct + spread, forecast: d.forecast, unseen: odd })
  }
  const ready = last.pct <= opts.dryMax ? last.date : (out.find((d) => d.pct <= opts.dryMax)?.date ?? null)
  return {
    desiccatedOn: opts.desiccatedOn ?? null,
    pairs: opts.learned.pairs,
    tests: tests.length,
    rmse: opts.learned.pairs >= 3 ? opts.learned.rmse : null,
    model: opts.learned.model,
    days: out,
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
