import { describe, expect, it } from 'vitest'
import {
  ZERO_MODEL,
  compareReadiness,
  daylight,
  features,
  fit,
  moistureAt,
  pairsFrom,
  predict,
  readinessKey,
  runFrom,
  vpd,
  type Model,
  type WeatherDay,
} from './dry-down'

// Westfield, the station 7.7 km from Dave Lindgren Jr. Home, Oct 2026.
const day = (date: string, tmax: number, tmin: number, rhMin: number | null, wind: number, sun: number, rain = 0, forecast = false): WeatherDay => ({
  date,
  tmaxC: tmax,
  tminC: tmin,
  rhMin,
  rhMax: rhMin == null ? null : 90,
  rainMm: rain,
  windMs: wind,
  solarMj: sun,
  forecast,
})
const october = [
  day('2026-10-04', 22.9, 1.6, 34, 2.2, 12.5),
  day('2026-10-05', 26.4, 7.3, 23, 2.9, 11.6),
  day('2026-10-06', 24.9, 4.0, 19, 2.2, 12.3),
  day('2026-10-07', 15.7, 3.0, 41, 2.6, 11.2, 0, true),
  day('2026-10-08', 20.4, 3.3, 37, 5.2, 11.6, 0, true),
]
const byDate = new Map(october.map((d) => [d.date, d]))

describe('the weather the model reads', () => {
  it('works out how dry the afternoon air is from the station’s own temperature and humidity', () => {
    // Saturation at 26.4 °C is 3.44 kPa; at 23% RH the air is short 2.65 kPa of it.
    expect(vpd(october[1])!.kPa).toBeCloseTo(2.65, 1)
    expect(vpd(october[1])!.estimated).toBe(false)
  })
  it('estimates it from the overnight low when a day has no humidity, and says so', () => {
    const v = vpd({ ...october[0], rhMin: null })!
    expect(v.estimated).toBe(true)
    expect(v.kPa).toBeGreaterThan(0)
  })
  it('needs wind and sunshine: a day without them is not used', () => {
    expect(features({ ...october[0], windMs: null })).toBeNull()
    expect(features({ ...october[0], solarMj: null })).toBeNull()
  })
})

describe('time of day', () => {
  it('counts daylight only, 8 am to 6 pm', () => {
    expect(daylight(9, 15)).toBeCloseTo(0.6, 9)
    expect(daylight(0, 24)).toBe(1)
    expect(daylight(19, 23)).toBe(0)
  })
  it('dries a morning reading more by mid-afternoon than an afternoon one by evening', () => {
    const m: Model = { ...ZERO_MODEL, b0: 0.3 }
    const morning = moistureAt(m, byDate, { date: '2026-10-05', hour: 9, pct: 12 }, '2026-10-05', 15)
    const evening = moistureAt(m, byDate, { date: '2026-10-05', hour: 15, pct: 12 }, '2026-10-05', 21)
    expect(12 - morning).toBeGreaterThan(12 - evening)
  })
})

describe('pairs of readings', () => {
  it('pairs the 2026 pinto samples: 39 and 57 minutes apart on the same day count', () => {
    const cook = pairsFrom([{ date: '2026-10-05', hour: 14.85, pct: 14.2 }, { date: '2026-10-05', hour: 15.5, pct: 14.7 }], october)
    const kellers = pairsFrom(
      [
        { date: '2026-10-04', hour: 19.4, pct: 15.4 },
        { date: '2026-10-05', hour: 12.92, pct: 14.6 },
        { date: '2026-10-05', hour: 13.87, pct: 13.9 },
      ],
      october,
    )
    expect(cook.length + kellers.length).toBe(3)
  })
  it('does not pair one sample read twice a few minutes apart', () => {
    expect(pairsFrom([{ date: '2026-10-05', hour: 14, pct: 12 }, { date: '2026-10-05', hour: 14.1, pct: 12.1 }], october)).toHaveLength(0)
  })
  it('pairs readings from the same day, an hour or more apart', () => {
    const p = pairsFrom(
      [
        { date: '2026-10-05', hour: 9, pct: 12 },
        { date: '2026-10-05', hour: 14, pct: 11 },
        { date: '2026-10-06', hour: 14, pct: 9.8 },
      ],
      october,
    )
    expect(p).toHaveLength(2)
    expect(p[0].from.hour).toBe(9)
  })
  it('skips two readings with no daylight between them', () => {
    expect(pairsFrom([{ date: '2026-10-05', hour: 6, pct: 12 }, { date: '2026-10-05', hour: 7.5, pct: 12 }], october)).toHaveLength(0)
  })
})

describe('learning from the farm’s own readings', () => {
  it('recovers the drying it was shown', () => {
    const truth: Model = { ...ZERO_MODEL, b0: 0.05, vpd: 0.06 }
    const tests = [{ date: '2026-10-04', hour: 15, pct: 14 }]
    for (const d of ['2026-10-05', '2026-10-06']) tests.push({ date: d, hour: 15, pct: moistureAt(truth, byDate, tests.at(-1)!, d, 15) })
    const learned = fit(pairsFrom(tests, october))!
    expect(learned.pairs).toBe(2)
    expect(learned.rmse).toBeLessThan(0.15)
  })

  it('with one pair, leans on a steady rate and holds the weather weights back', () => {
    // Dave Lindgren Jr. Home: 10.9% at 1:39 pm on 5 Oct, 9.8% at 1:56 pm on 6 Oct.
    const learned = fit(pairsFrom([{ date: '2026-10-05', hour: 13.65, pct: 10.9 }, { date: '2026-10-06', hour: 13.93, pct: 9.8 }], october))!
    expect(learned.rmse).toBeLessThan(0.1)
    const weatherShare = Math.abs(learned.model.vpd * 2.5) + Math.abs(learned.model.wind * 2.5) + Math.abs(learned.model.sun * 12)
    expect(weatherShare).toBeLessThan(Math.abs(learned.model.b0) + 0.2)
  })

  it('learns nothing from nothing', () => {
    expect(fit([])).toBeNull()
  })
})

describe('predict', () => {
  const learned = { model: { ...ZERO_MODEL, b0: 0.1 }, rmse: 0, pairs: 1 }
  it('runs from the latest reading and widens on forecast days', () => {
    const f = predict({ tests: [{ date: '2026-10-06', hour: 14, pct: 9.8 }], weather: october, dryMax: 8.5, learned })!
    expect(f.days.map((d) => d.date)).toEqual(['2026-10-07', '2026-10-08'])
    expect(f.days[1].pct).toBeLessThan(f.days[0].pct)
    expect(f.days[1].high - f.days[1].low).toBeGreaterThan(f.days[0].high - f.days[0].low)
  })
  it('gives a prediction from a single reading, on a model learned elsewhere', () => {
    expect(predict({ tests: [{ date: '2026-10-06', hour: 14, pct: 12 }], weather: october, dryMax: 10, learned })).not.toBeNull()
  })
  it('says ready today when the last reading is already dry', () => {
    expect(predict({ tests: [{ date: '2026-10-06', hour: 14, pct: 8 }], weather: october, dryMax: 8.5, learned })!.readyOn).toBe('2026-10-06')
  })
  it('ignores readings from before the Reglone went on', () => {
    const f = predict({
      tests: [{ date: '2026-09-20', pct: 35 }, { date: '2026-10-06', hour: 14, pct: 9.8 }],
      weather: october,
      dryMax: 8.5,
      learned,
      desiccatedOn: '2026-09-25',
    })!
    expect(f.tests).toBe(1)
  })
  it('gives nothing without a model', () => {
    expect(predict({ tests: [{ date: '2026-10-06', pct: 9.8 }], weather: october, dryMax: 8.5, learned: null })).toBeNull()
  })
  it('keeps the crop where it was on a day with no weather', () => {
    const run = runFrom(learned.model, [{ ...october[3], windMs: null }], { date: '2026-10-06', hour: 15, pct: 10 })
    expect(run.get('2026-10-07')).toBe(10)
  })
})

describe('weather the farm has not seen', () => {
  // Learned on dry days only, as every 2026 reading was.
  const learned = fit(
    pairsFrom([{ date: '2026-10-05', hour: 13.65, pct: 10.9 }, { date: '2026-10-06', hour: 13.93, pct: 9.8 }], october),
  )!
  const wet = [...october, day('2026-10-09', 22.6, 5.1, 23, 10.8, 8.6, 0, true), day('2026-10-10', 3.9, 0.1, 64, 8.9, 4.3, 2.4, true)]

  it('does not dry the crop through rain it has never seen', () => {
    const f = predict({ tests: [{ date: '2026-10-06', hour: 13.93, pct: 9.8 }], weather: wet, dryMax: 8.5, learned })!
    const d9 = f.days.find((d) => d.date === '2026-10-09')!
    const d10 = f.days.find((d) => d.date === '2026-10-10')!
    expect(d10.unseen).toBe(true)
    // Only the last three daylight hours of the 9th (a seen day) dry it; the rainy 10th holds.
    const lastHoursOf9th = d9.pct * (1 - Math.exp(-learned.model.b0 * 0.3))
    expect(d9.pct - d10.pct).toBeLessThan(lastHoursOf9th + 0.01)
    expect(f.days.filter((d) => d.unseen).map((d) => d.date)).toEqual(['2026-10-10'])
    expect(d10.high - d10.low).toBeGreaterThan(d9.high - d9.low + 5)
  })
})

describe('closest to ready first', () => {
  const f = (readyOn: string | null, lastPct: number, dryMax = 10) => ({
    forecast: {
      pairs: 2,
      tests: 2,
      rmse: null,
      model: ZERO_MODEL,
      days: [{ date: '2026-10-10', pct: lastPct, low: lastPct, high: lastPct, forecast: true, unseen: false }],
      readyOn,
      dryMax,
    },
    tests: [{ date: '2026-10-05', pct: 14 }],
  })
  it('puts dry-soonest first, then nearest to dry, then fields waiting on a test', () => {
    const rows = {
      later: readinessKey(f('2026-10-12', 9)),
      soon: readinessKey(f('2026-10-08', 9)),
      far: readinessKey(f(null, 16)),
      near: readinessKey(f(null, 11)),
      untested: readinessKey({ forecast: null, tests: [] }),
      loading: readinessKey(undefined),
    }
    const order = Object.entries(rows).sort((a, b) => compareReadiness(a[1], b[1])).map(([k]) => k)
    expect(order).toEqual(['soon', 'later', 'near', 'far', 'untested', 'loading'])
  })
})
