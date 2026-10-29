import { describe, expect, it } from 'vitest'
import {
  ADVICE_SETTINGS,
  RULES,
  SOURCE_LABELS,
  THRESHOLDS,
  conditionsCropOf,
  dewPointC,
  dewSpread,
  directionWords,
  hourLabel,
  latestLook,
  moistureAtHour,
  nextMoistureHours,
  peakLook,
  referenceOf,
  settingsCropFor,
  shareAbove,
  suggest,
  thicknessOf,
  type ConditionsInput,
  type NdviLook,
  type WxHour,
} from './combine-conditions'
import type { MoistureBands } from './moisture'

// Invented figures throughout: no farm's numbers.
const look = (date: string, mean: number, p10: number | null = null, p90: number | null = null, validFraction = 1): NdviLook => ({
  date,
  mean,
  p10,
  p90,
  sd: null,
  validFraction,
  quality: 'full',
  ndre: null,
})

const hour = (time: string, tempC: number, rh: number, wind = 10, gust = 15): WxHour => ({
  time,
  tempC,
  rh,
  dewC: null,
  windKmh: wind,
  gustKmh: gust,
  windDir: 200,
})

const bands: MoistureBands = { dry_max: 10, tough_max: 12}

const base = (over: Partial<ConditionsInput> = {}): ConditionsInput => ({
  crop: 'wheat',
  swathed: false,
  thickness: null,
  moisture: { now: { pct: 9, source: 'test' }, next: [], bands },
  weather: { now: hour('2030-09-01T14:00', 20, 50), next: [] },
  ...over,
})

const dirOf = (a: ReturnType<typeof suggest>, s: (typeof ADVICE_SETTINGS)[number]) => a.suggestions.find((x) => x.setting === s)!.direction

describe('crops', () => {
  it('maps names, with peas on the book’s peas-and-beans row', () => {
    expect(conditionsCropOf('Some Canola')).toBe('canola')
    expect(conditionsCropOf('Field Peas')).toBe('peas')
    expect(conditionsCropOf('Durum Wheat')).toBe('durum')
    expect(conditionsCropOf('Beans-Pinto')).toBe('beans')
    expect(conditionsCropOf('Alfalfa')).toBeNull()
    expect(settingsCropFor('peas')).toBe('beans')
    expect(settingsCropFor('canola')).toBe('canola')
  })
})

describe('NDVI spread', () => {
  const l = look('2030-07-20', 0.7, 0.6, 0.8)
  it('reads p10, mean and p90 as 90, 50 and 10 % above', () => {
    expect(shareAbove(l, 0.6)).toBeCloseTo(0.9)
    expect(shareAbove(l, 0.7)).toBeCloseTo(0.5)
    expect(shareAbove(l, 0.8)).toBeCloseTo(0.1)
    expect(shareAbove(l, 0.65)).toBeCloseTo(0.7)
  })
  it('runs on past the ends and stays between 0 and 1', () => {
    expect(shareAbove(l, 0.55)).toBeCloseTo(1)
    expect(shareAbove(l, 0.2)).toBe(1)
    expect(shareAbove(l, 0.99)).toBe(0)
  })
  it('falls back to the standard deviation, then to the mean alone', () => {
    expect(shareAbove({ ...look('2030-07-20', 0.7), sd: 0.05 }, 0.7)).toBeCloseTo(0.5)
    expect(shareAbove(look('2030-07-20', 0.7), 0.6)).toBe(1)
    expect(shareAbove(look('2030-07-20', 0.7), 0.75)).toBe(0)
  })
  it('picks the peak and the latest from clear looks only', () => {
    const looks = [look('2030-07-10', 0.6), look('2030-07-20', 0.9, null, null, 0.3), look('2030-07-25', 0.75), look('2030-09-01', 0.3), look('2030-09-05', 0.2, null, null, 0.1)]
    expect(peakLook(looks)?.date).toBe('2030-07-25')
    expect(latestLook(looks)?.date).toBe('2030-09-01')
    expect(peakLook([])).toBeNull()
  })
  it('needs three same-crop fields for a farm median', () => {
    expect(referenceOf([0.6, 0.7])).toBeNull()
    expect(referenceOf([0.7, 0.6, 0.8])).toEqual({ median: 0.7, fields: 3 })
    expect(referenceOf([0.5, 0.6, 0.7, 0.8])?.median).toBeCloseTo(0.65)
  })
})

describe('thickness', () => {
  const ref = { median: 0.65, fields: 5 }
  it('calls a field heavy when most of it is above the crop’s farm median', () => {
    const t = thicknessOf({ looks: [look('2030-07-20', 0.75, 0.68, 0.82)], reference: ref, today: '2030-09-01', swathed: false })!
    expect(t.overall).toBe('heavy')
    expect(t.heavyShare).toBeGreaterThanOrEqual(THRESHOLDS.areaShare)
    expect(t.against).toBe('farm')
  })
  it('calls it thin the other way', () => {
    expect(thicknessOf({ looks: [look('2030-07-20', 0.55, 0.5, 0.6)], reference: ref, today: '2030-09-01', swathed: false })!.overall).toBe('thin')
  })
  it('without a farm median it can only say uneven or average', () => {
    expect(thicknessOf({ looks: [look('2030-07-20', 0.75, 0.6, 0.85)], reference: null, today: '2030-09-01', swathed: false })!.overall).toBe('uneven')
    expect(thicknessOf({ looks: [look('2030-07-20', 0.75, 0.72, 0.78)], reference: null, today: '2030-09-01', swathed: false })!.overall).toBe('average')
  })
  it('reads green from a recent look after the peak, and not on a swath', () => {
    const looks = [look('2030-07-20', 0.75, 0.7, 0.8), look('2030-08-28', 0.55)]
    expect(thicknessOf({ looks, reference: ref, today: '2030-09-01', swathed: false })!.green).toBe('green')
    expect(thicknessOf({ looks, reference: ref, today: '2030-09-01', swathed: true })!.green).toBeNull()
    expect(thicknessOf({ looks, reference: ref, today: '2030-09-30', swathed: false })!.green).toBeNull()
    const ripe = [look('2030-07-20', 0.75, 0.7, 0.8), look('2030-08-30', 0.25)]
    expect(thicknessOf({ looks: ripe, reference: ref, today: '2030-09-01', swathed: false })!.green).toBe('ripe')
  })
})

describe('weather helpers', () => {
  it('works out a dew point and the spread to it', () => {
    expect(dewPointC(20, 100)).toBeCloseTo(20, 1)
    expect(dewPointC(20, 50)).toBeCloseTo(9.3, 0)
    expect(dewSpread(hour('2030-09-01T22:00', 10, 95))).toBeLessThan(THRESHOLDS.dewSpreadC)
    expect(dewSpread({ ...hour('2030-09-01T22:00', 10, 50), dewC: 7 })).toBe(3)
  })
  it('labels hours the way people say them', () => {
    expect(hourLabel('2030-09-01T20:00')).toBe('8 pm')
    expect(hourLabel('2030-09-01T09:00')).toBe('9 am')
    expect(hourLabel('2030-09-01T00:00')).toBe('midnight')
    expect(hourLabel('2030-09-01T12:00')).toBe('noon')
  })
})

describe('the rules', () => {
  it('suggest nothing on an ordinary afternoon in a dry, average crop', () => {
    const a = suggest(base())
    expect(a.suggestions.every((s) => s.direction === 'none')).toBe(true)
    expect(a.later).toHaveLength(0)
  })

  it('heavy crop: slower, concave and upper sieve open', () => {
    const thickness = thicknessOf({ looks: [look('2030-07-20', 0.8, 0.72, 0.88)], reference: { median: 0.65, fields: 4 }, today: '2030-09-01', swathed: false })
    const a = suggest(base({ thickness }))
    expect(dirOf(a, 'ground_speed_mph')).toBe('down')
    expect(dirOf(a, 'concave_mm')).toBe('up')
    expect(dirOf(a, 'chaffer_mm')).toBe('up')
    expect(a.suggestions.find((s) => s.setting === 'ground_speed_mph')!.reasons[0].text).toMatch(/Heavy crop \(NDVI high in \d+% of the field\)/)
  })

  it('tough grain: rotor up, concave closed', () => {
    const a = suggest(base({ moisture: { now: { pct: 11, source: 'test' }, next: [], bands } }))
    expect(dirOf(a, 'rotor_rpm')).toBe('up')
    expect(dirOf(a, 'concave_mm')).toBe('down')
  })

  it('dry brittle straw: rotor down, concave open — but not in corn', () => {
    const dry = { now: hour('2030-09-01T15:00', 26, 22), next: [] }
    const a = suggest(base({ weather: dry }))
    expect(dirOf(a, 'rotor_rpm')).toBe('down')
    expect(dirOf(a, 'concave_mm')).toBe('up')
    const corn = suggest(base({ crop: 'corn', weather: dry, moisture: { now: { pct: 16, source: 'test' }, next: [], bands: { dry_max: 15.5, tough_max: 17.5} } }))
    expect(corn.fired).not.toContain('brittle-straw')
  })

  it('a heavy crop that is tough holds the concave: the rules pull both ways', () => {
    const thickness = thicknessOf({ looks: [look('2030-07-20', 0.8, 0.72, 0.88)], reference: { median: 0.65, fields: 4 }, today: '2030-09-01', swathed: false })
    const a = suggest(base({ thickness, moisture: { now: { pct: 11, source: 'model' }, next: [], bands } }))
    expect(dirOf(a, 'concave_mm')).toBe('hold')
    expect(directionWords('concave_mm', 'hold')).toMatch(/both ways/)
  })

  it('strong wind lowers the fan for a light seed and only asks for a look in wheat', () => {
    const windy = { now: hour('2030-09-01T14:00', 20, 50, 35, 55), next: [] }
    expect(dirOf(suggest(base({ crop: 'canola', weather: windy, moisture: { now: { pct: 7, source: 'test' }, next: [], bands: { dry_max: 8, tough_max: 10} } })), 'fan_rpm')).toBe('down')
    expect(dirOf(suggest(base({ weather: windy })), 'fan_rpm')).toBe('check')
    expect(suggest(base({ crop: 'corn', weather: windy })).fired).not.toContain('wind')
  })

  it('green canola: slower, rotor up, concave closed; other crops only slower', () => {
    const looks = [look('2030-07-20', 0.7, 0.66, 0.74), look('2030-08-28', 0.6)]
    const thickness = thicknessOf({ looks, reference: null, today: '2030-09-01', swathed: false })
    const canola = suggest(base({ crop: 'canola', thickness, moisture: { now: null, next: [], bands: null } }))
    expect(dirOf(canola, 'rotor_rpm')).toBe('up')
    expect(dirOf(canola, 'concave_mm')).toBe('down')
    expect(dirOf(canola, 'ground_speed_mph')).toBe('down')
    const barley = suggest(base({ crop: 'barley', thickness, moisture: { now: null, next: [], bands: null } }))
    expect(dirOf(barley, 'rotor_rpm')).toBe('none')
    expect(dirOf(barley, 'ground_speed_mph')).toBe('down')
  })

  it('very dry grain opens the concave and slows the rotor; durum says rotor first', () => {
    const now = { pct: 6.5, source: 'test' as const }
    const a = suggest(base({ moisture: { now, next: [], bands } }))
    expect(dirOf(a, 'concave_mm')).toBe('up')
    expect(dirOf(a, 'rotor_rpm')).toBe('down')
    const durum = suggest(base({ crop: 'durum', moisture: { now, next: [], bands } }))
    expect(durum.suggestions.find((s) => s.setting === 'rotor_rpm')!.reasons[0].text).toMatch(/rotor −1 step first/)
  })

  it('beans below their floor count as very dry; tough beans are not threshed harder', () => {
    const beanBands: MoistureBands = { dry_max: 16, tough_max: 16.5, dry_min: 14 }
    const dry = suggest(base({ crop: 'beans', moisture: { now: { pct: 13, source: 'test' }, next: [], bands: beanBands } }))
    expect(dry.fired).toContain('over-dry')
    expect(dirOf(dry, 'rotor_rpm')).toBe('down')
    const tough = suggest(base({ crop: 'beans', moisture: { now: { pct: 16.4, source: 'test' }, next: [], bands: beanBands } }))
    expect(tough.fired).not.toContain('tough-grain')
  })

  it('peas drying under 17 % ask for a slower rotor', () => {
    const a = suggest(base({ crop: 'peas', moisture: { now: { pct: 15, source: 'test' }, next: [], bands: null } }))
    expect(dirOf(a, 'rotor_rpm')).toBe('down')
  })

  it('damp evening air: slower, and the rotor only checked', () => {
    const a = suggest(base({ weather: { now: hour('2030-09-01T21:00', 12, 80), next: [] } }))
    expect(dirOf(a, 'ground_speed_mph')).toBe('down')
    expect(dirOf(a, 'rotor_rpm')).toBe('check')
  })

  it('looks ahead: RH climbing, dew, and grain going tough are notes, not changes', () => {
    const next = [hour('2030-09-01T17:00', 18, 55), hour('2030-09-01T19:00', 14, 72), hour('2030-09-01T22:00', 9, 94)]
    const a = suggest(
      base({
        weather: { now: hour('2030-09-01T15:00', 20, 45), next },
        moisture: { now: { pct: 9, source: 'model' }, next: [{ time: '2030-09-01T21:00', pct: 10.4 }], bands },
      }),
    )
    expect(a.later.map((l) => l.rule)).toEqual(['later-damp', 'later-dew', 'later-tough'])
    expect(a.later[0].text).toMatch(/7 pm/)
    expect(a.later[2].text).toMatch(/9 pm/)
    expect(a.suggestions.every((s) => s.direction === 'none')).toBe(true)
  })

  it('cool humid canola is a note to check more often', () => {
    const a = suggest(base({ crop: 'canola', weather: { now: hour('2030-09-01T11:00', 15, 60), next: [] }, moisture: { now: null, next: [], bands: null } }))
    expect(a.notes.map((n) => n.rule)).toContain('canola-cool-humid')
  })

  it('every rule names a known source and says what it looks at', () => {
    for (const r of RULES) {
      expect(r.sources.length).toBeGreaterThan(0)
      for (const s of r.sources) expect(SOURCE_LABELS[s]).toBeTruthy()
      expect(r.when).toBeTruthy()
      expect(r.then).toBeTruthy()
    }
    expect(new Set(RULES.map((r) => r.id)).size).toBe(RULES.length)
  })

  it('never puts a number on a setting: directions only', () => {
    for (const s of ADVICE_SETTINGS) for (const d of ['up', 'down'] as const) expect(directionWords(s, d)).not.toMatch(/\d{2,}|mm|rpm|mph/)
  })
})

describe('moisture hours', () => {
  const hourly = [
    { date: '2030-09-01', hour: 14, pct: 9 },
    { date: '2030-09-01', hour: 15, pct: 8.8 },
    { date: '2030-09-01', hour: 23, pct: 9.9 },
    { date: '2030-09-02', hour: 2, pct: 10.3 },
    { date: '2030-09-02', hour: 4, pct: 10.6 },
  ]
  it('takes the next twelve hours and the hour now', () => {
    const now = { date: '2030-09-01', hour: 14 }
    expect(moistureAtHour(hourly, now)).toBe(9)
    expect(nextMoistureHours(hourly, now).map((h) => h.time)).toEqual(['2030-09-01T15:00', '2030-09-01T23:00', '2030-09-02T02:00'])
  })
})
