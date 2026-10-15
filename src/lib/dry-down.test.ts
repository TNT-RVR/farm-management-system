import { describe, expect, it } from 'vitest'
import { airAt, compareReadiness, daylight, fit, moistureAt, pairsFrom, predict, readinessKey, runFrom, scoreFrom, shapeHours, startingModel, type Hours, type WeatherDay } from './dry-down'
import { emc, emcGroupFor } from './grain-emc'

// Westfield, the station 7.7 km from Dale Lindgren Jr. Home, Oct 2026.
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
const canola = startingModel('canola')

describe('what grain settles at in the air', () => {
  it('reads PAMI’s canola chart', () => {
    expect(emc('canola', 22, 50)).toBeCloseTo(6.7, 1)
    expect(emc('canola', 10, 70)).toBeCloseTo(10.5, 1)
    // Between rows and columns it reads in between.
    expect(emc('canola', 20, 52.5)).toBeGreaterThan(6.7)
    expect(emc('canola', 20, 52.5)).toBeLessThan(7.6)
  })
  it('works out corn from the ASABE equation', () => {
    expect(emc('corn', 20, 60)).toBeGreaterThan(11.5)
    expect(emc('corn', 20, 60)).toBeLessThan(13.5)
  })
  it('is low in a dry afternoon and high in a damp night', () => {
    expect(emc('canola', 22, 25)).toBeLessThan(5)
    expect(emc('canola', 3, 90)).toBeGreaterThan(14)
  })
  it('gives each crop its chart, beans the peas chart, potatoes none', () => {
    expect(emcGroupFor('Corteva Canola')).toBe('canola')
    expect(emcGroupFor('Beans-Pinto')).toBe('peas')
    expect(emcGroupFor('Durum')).toBe('wheat')
    expect(emcGroupFor('High-Moisture Corn')).toBe('corn')
    expect(emcGroupFor('Potatoes')).toBeNull()
  })
})

describe('the air at an hour', () => {
  it('is the high and the low humidity by day, the low and the high humidity at night', () => {
    expect(airAt(october[1], 14)).toEqual({ tC: 26.4, rh: 23, estimated: false })
    expect(airAt(october[1], 3)).toEqual({ tC: 7.3, rh: 90, estimated: false })
  })
  it('estimates the day’s humidity from its low when there is none, and says so', () => {
    const a = airAt({ ...october[1], rhMin: null }, 14)!
    expect(a.estimated).toBe(true)
    expect(a.rh).toBeGreaterThan(0)
    expect(a.rh).toBeLessThan(40)
  })
  it('counts daylight 8 am to 6 pm', () => {
    expect(daylight(6, 20)).toBe(1)
    expect(daylight(13, 18)).toBe(0.5)
  })
})

describe('the crop follows the air', () => {
  it('dries through a dry afternoon', () => {
    expect(moistureAt(canola, byDate, { date: '2026-10-05', hour: 9, pct: 12 }, '2026-10-05', 17)).toBeLessThan(11)
  })
  it('takes moisture back overnight, so a morning can read higher than the afternoon before', () => {
    const evening = moistureAt(canola, byDate, { date: '2026-10-05', hour: 9, pct: 8 }, '2026-10-05', 18)
    const morning = moistureAt(canola, byDate, { date: '2026-10-05', hour: 9, pct: 8 }, '2026-10-06', 8)
    expect(morning).toBeGreaterThan(evening)
  })
  it('never dries below what the afternoon air would leave it at', () => {
    const run = runFrom(canola, october, { date: '2026-10-04', hour: 15, pct: 9 })
    for (const v of run.values()) expect(v).toBeGreaterThan(3)
  })
  it('adds rain at the end of the day', () => {
    const wet = new Map([['2026-10-05', { ...october[1], rainMm: 6 }]])
    const dry = new Map([['2026-10-05', october[1]]])
    const from = { date: '2026-10-05', hour: 12, pct: 9 }
    expect(moistureAt(canola, wet, from, '2026-10-05', 19)).toBeGreaterThan(moistureAt(canola, dry, from, '2026-10-05', 19) + 1)
  })
  it('holds the crop where it was through a day with no temperatures', () => {
    const blank = new Map([['2026-10-07', { ...october[3], tmaxC: null, tminC: null }]])
    expect(moistureAt(canola, blank, { date: '2026-10-07', hour: 9, pct: 10 }, '2026-10-07', 17)).toBe(10)
  })
})

describe('pairs of readings', () => {
  it('pairs the 2026 pinto samples: 39 and 57 minutes apart on the same day count', () => {
    const pairs = pairsFrom(
      [
        { date: '2026-09-21', hour: 14.8, pct: 14.2 },
        { date: '2026-09-21', hour: 15.45, pct: 14.7 },
        { date: '2026-09-24', hour: 12.9, pct: 14.6 },
        { date: '2026-09-24', hour: 13.85, pct: 13.9 },
      ],
      october,
    )
    expect(pairs).toHaveLength(3)
  })
  it('does not pair one sample read twice a few minutes apart', () => {
    expect(pairsFrom([{ date: '2026-10-05', hour: 14, pct: 10 }, { date: '2026-10-05', hour: 14.1, pct: 10.2 }], october)).toHaveLength(0)
  })
  it('pairs an evening and the next morning: what comes back overnight is part of it', () => {
    expect(pairsFrom([{ date: '2026-10-05', hour: 19, pct: 9 }, { date: '2026-10-06', hour: 7, pct: 10 }], october)).toHaveLength(1)
  })
})

describe('tuned by the farm’s own readings', () => {
  it('with no readings, is the starting point', () => {
    const f = fit([], 'canola')
    expect(f.pairs).toBe(0)
    expect(f.rmse).toBeNull()
    expect(f.model.kDay).toBe(canola.kDay)
  })
  it('moves towards faster drying when the readings dried faster than it guessed', () => {
    const quick = { ...canola, kDay: canola.kDay + 1 }
    const tests = [{ date: '2026-10-04', hour: 13, pct: 16 }]
    for (const d of ['2026-10-05', '2026-10-06']) tests.push({ date: d, hour: 13, pct: moistureAt(quick, byDate, tests.at(-1)!, d, 13) })
    const learned = fit(pairsFrom(tests, october), 'canola')
    expect(learned.model.kDay).toBeGreaterThan(canola.kDay + 0.3)
  })
  it('one noisy pair moves it only part of the way', () => {
    // A rise on a dry day, as Lindgren read on 9 Oct: not enough on its own to undo drying.
    const learned = fit(pairsFrom([{ date: '2026-10-05', hour: 11, pct: 7.3 }, { date: '2026-10-05', hour: 16, pct: 8.2 }], october), 'canola')
    expect(Math.exp(learned.model.kDay)).toBeGreaterThan(0.005)
  })
})

describe('predict', () => {
  const learned = fit([], 'canola')
  it('gives a first guess from one reading and the weather alone, with a wide range', () => {
    const f = predict({ tests: [{ date: '2026-10-06', hour: 14, pct: 12 }], weather: october, dryMax: 10, learned })!
    expect(f.days.map((d) => d.date)).toEqual(['2026-10-07', '2026-10-08'])
    expect(f.days[0].pct).toBeLessThan(12)
    expect(f.days[0].high - f.days[0].low).toBeGreaterThan(3)
    expect(f.days[1].high - f.days[1].low).toBeGreaterThan(f.days[0].high - f.days[0].low)
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
  it('marks forecast rain and is less sure after it', () => {
    const wet = [...october, day('2026-10-09', 12, 2, 60, 4, 6, 5, true), day('2026-10-10', 14, 2, 45, 4, 10, 0, true)]
    const f = predict({ tests: [{ date: '2026-10-06', hour: 14, pct: 10 }], weather: wet, dryMax: 8, learned })!
    expect(f.days.find((d) => d.date === '2026-10-09')!.rain).toBe(true)
    const w = (date: string) => f.days.find((d) => d.date === date)!
    expect(w('2026-10-10').high - w('2026-10-10').low).toBeGreaterThan(w('2026-10-08').high - w('2026-10-08').low + 1.5)
  })
})

describe('hour by hour', () => {
  // A made-up day of hours: cool damp night, warm dry afternoon.
  const raw: Hours = new Map()
  for (let h = 0; h < 24; h++) {
    const warm = h >= 10 && h <= 17
    raw.set(`2026-10-05|${h}`, { tC: warm ? 20 : 8, rh: warm ? 30 : 80, rainMm: h === 14 ? 1 : 0, windMs: 3, solarWm2: warm ? 500 : 0 })
  }
  const shaped = shapeHours(october, raw)
  it('scales the hours to the station’s own high, low, humidity and rain', () => {
    const temps = [...shaped.values()].map((h) => h.tC!)
    expect(Math.max(...temps)).toBeCloseTo(26.4, 5)
    expect(Math.min(...temps)).toBeCloseTo(7.3, 5)
    const rhs = [...shaped.values()].map((h) => h.rh!)
    expect(Math.min(...rhs)).toBeCloseTo(23, 5)
    expect(Math.max(...rhs)).toBeCloseTo(90, 5)
    // The station saw no rain that day, so the model's shower is dropped.
    expect([...shaped.values()].reduce((s, h) => s + (h.rainMm ?? 0), 0)).toBe(0)
  })
  it('dries only while the sun is up in the hours', () => {
    const at7 = moistureAt(canola, byDate, { date: '2026-10-05', hour: 6, pct: 10 }, '2026-10-05', 9, { hours: shaped })
    const at17 = moistureAt(canola, byDate, { date: '2026-10-05', hour: 11, pct: 10 }, '2026-10-05', 14, { hours: shaped })
    // Early morning in damp air it creeps up; the afternoon takes it down.
    expect(at7).toBeGreaterThan(10)
    expect(at17).toBeLessThan(10)
  })
})

describe('swathed and desiccated', () => {
  const from = { date: '2026-10-05', hour: 9, pct: 14 }
  it('dries a swath quicker than a standing crop', () => {
    const standing = moistureAt(canola, byDate, from, '2026-10-05', 17, { ctx: { swathed: false, desiccatedOn: null } })
    const swath = moistureAt(canola, byDate, from, '2026-10-05', 17, { ctx: { swathed: true, desiccatedOn: null } })
    expect(swath).toBeLessThan(standing - 0.5)
  })
  it('dries a crop quicker from the day its desiccant went on', () => {
    const live = moistureAt(canola, byDate, from, '2026-10-05', 17, { ctx: { swathed: false, desiccatedOn: '2026-10-09' } })
    const killed = moistureAt(canola, byDate, from, '2026-10-05', 17, { ctx: { swathed: false, desiccatedOn: '2026-10-01' } })
    expect(killed).toBeLessThan(live)
  })
})

describe('by the hour', () => {
  it('runs every hour on the hour from the last test to the end of the weather', () => {
    const f = predict({ tests: [{ date: '2026-10-06', hour: 14.5, pct: 10 }], weather: october, dryMax: 8, learned: fit([], 'canola') })!
    expect(f.hourly[0]).toMatchObject({ date: '2026-10-06', hour: 15 })
    expect(f.hourly.at(-1)).toMatchObject({ date: '2026-10-08', hour: 23 })
    expect(f.hourly).toHaveLength(9 + 48)
    // It agrees with the daily figure at 3 pm.
    const d7 = f.days.find((d) => d.date === '2026-10-07')!.pct
    expect(f.hourly.find((h) => h.date === '2026-10-07' && h.hour === 15)!.pct).toBeCloseTo(d7, 6)
  })
})

describe('the record', () => {
  it('predicts each reading from the one before, with only what was known then', () => {
    const tests = [
      { date: '2026-10-04', hour: 14, pct: 14 },
      { date: '2026-10-05', hour: 14, pct: 12 },
      { date: '2026-10-06', hour: 14, pct: 10.5 },
    ]
    const sc = scoreFrom(pairsFrom(tests, october), 'canola')!
    expect(sc.n).toBe(2)
    expect(sc.mae).toBeGreaterThan(0)
    expect(sc.recent[0].date).toBe('2026-10-06')
    expect(sc.recent[0].actual).toBe(10.5)
  })
  it('has nothing to say with no pairs', () => {
    expect(scoreFrom([], 'canola')).toBeNull()
  })
})

describe('closest to ready first', () => {
  const f = (readyOn: string | null, lastPct: number, dryMax = 10) => ({
    forecast: {
      pairs: 2,
      tests: 2,
      rmse: null,
      model: canola,
      days: [{ date: '2026-10-10', pct: lastPct, low: lastPct, high: lastPct, forecast: true, rain: false }],
      hourly: [],
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
    const order = Object.entries(rows)
      .sort((a, b) => compareReadiness(a[1], b[1]))
      .map(([k]) => k)
    expect(order).toEqual(['soon', 'later', 'near', 'far', 'untested', 'loading'])
  })
})
