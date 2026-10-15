import { describe, expect, it } from 'vitest'
import {
  compass,
  fmtHours,
  handDayByField,
  handWorkDays,
  machineHours,
  meanDirection,
  nearestHour,
  possibleDuplicates,
  summariseWeather,
  weatherDue,
  weatherLine,
  weatherSpan,
  workHours,
  workTypeLabel,
  workTypeList,
  workWindow,
  type DeerePassLite,
  type HourReading,
} from './field-work'
import { readingsFromOpenMeteo } from './work-record-weather'
import { effectiveHarvestDate } from './harvest-date'

// Made-up data throughout: field "f1", times in UTC.
const rec = (o: Partial<Parameters<typeof possibleDuplicates>[0]> = {}) => ({
  field_id: 'f1',
  counts_as: 'harvest' as const,
  started_at: null as string | null,
  finished_at: null as string | null,
  hours: null as number | null,
  not_duplicate_of: [] as string[],
  ...o,
})

describe('work types', () => {
  it('puts manager-added types before Other and skips repeats of built-ins', () => {
    const list = workTypeList([
      { label: 'Root picking', counts_as: null, active: true },
      { label: 'baling', counts_as: null, active: true },
      { label: 'Old thing', counts_as: null, active: false },
    ])
    expect(list.at(-1)?.key).toBe('other')
    expect(list.at(-2)?.label).toBe('Root picking')
    expect(list.filter((t) => t.label.toLowerCase() === 'baling')).toHaveLength(1)
    expect(list.some((t) => t.label === 'Old thing')).toBe(false)
  })
  it('names a record by its type, or what was typed for Other', () => {
    expect(workTypeLabel({ work_type: 'harvesting', work_type_other: null })).toBe('Harvesting / Combining')
    expect(workTypeLabel({ work_type: 'other', work_type_other: 'Picking roots' })).toBe('Picking roots')
    expect(workTypeLabel({ work_type: 'Root picking', work_type_other: null })).toBe('Root picking')
  })
})

describe('duration maths', () => {
  it('uses typed hours over start to finish', () => {
    expect(workHours({ started_at: '2026-08-01T14:00:00Z', finished_at: '2026-08-01T20:00:00Z', hours: 5 })).toEqual({ hours: 5, from: 'typed' })
  })
  it('falls back to start to finish', () => {
    expect(workHours({ started_at: '2026-08-01T14:00:00Z', finished_at: '2026-08-01T16:30:00Z', hours: null })).toEqual({ hours: 2.5, from: 'times' })
  })
  it('is null with nothing to go on, or a finish before the start', () => {
    expect(workHours({ started_at: null, finished_at: '2026-08-01T16:30:00Z', hours: null }).hours).toBeNull()
    expect(workHours({ started_at: '2026-08-01T18:00:00Z', finished_at: '2026-08-01T16:30:00Z', hours: null }).hours).toBeNull()
  })
  it('counts machine time for several machines at once', () => {
    expect(machineHours(5, 2)).toBe(10)
    expect(machineHours(5, null)).toBe(5)
    expect(machineHours(null, 3)).toBeNull()
  })
  it('formats hours', () => {
    expect(fmtHours(2.5)).toBe('2 h 30 m')
    expect(fmtHours(0.75)).toBe('45 m')
    expect(fmtHours(3)).toBe('3 h')
    expect(fmtHours(52)).toBe('2 d 4 h')
    expect(fmtHours(0)).toBeNull()
  })
  it('works out a window from a finish and the hours it took', () => {
    expect(workWindow({ started_at: null, finished_at: '2026-08-01T20:00:00Z', hours: 3 })).toEqual({ from: '2026-08-01T17:00:00.000Z', to: '2026-08-01T20:00:00Z' })
    expect(workWindow({ started_at: null, finished_at: '2026-08-01T20:00:00Z', hours: null })).toEqual({ from: '2026-08-01T20:00:00Z', to: '2026-08-01T20:00:00Z' })
    expect(workWindow({ started_at: null, finished_at: null, hours: 2 })).toBeNull()
  })
})

describe('weather hour picking', () => {
  const hours: HourReading[] = [
    { ts: '2026-08-01T14:00:00.000Z', temp_c: 20, rh: 50, wind_kmh: 10, wind_dir_deg: 350, gust_kmh: 20, precip_mm: 0, solar_wm2: 600 },
    { ts: '2026-08-01T15:00:00.000Z', temp_c: 22, rh: 40, wind_kmh: 14, wind_dir_deg: 10, gust_kmh: 31, precip_mm: 0.4, solar_wm2: 700 },
    { ts: '2026-08-01T16:00:00.000Z', temp_c: 24, rh: 30, wind_kmh: 18, wind_dir_deg: 20, gust_kmh: 25, precip_mm: 0, solar_wm2: 500 },
  ]
  it('picks the nearest hour within 90 minutes', () => {
    expect(nearestHour(hours, '2026-08-01T15:20:00Z')?.ts).toBe('2026-08-01T15:00:00.000Z')
    expect(nearestHour(hours, '2026-08-01T18:00:00Z')).toBeNull()
  })
  it('summarises a window: averages, highest gust, total rain', () => {
    const w = summariseWeather(hours, { from: '2026-08-01T14:00:00Z', to: '2026-08-01T17:00:00Z' })!
    expect(w.hours).toBe(3)
    expect(w.temp_c).toBe(22)
    expect(w.rh).toBe(40)
    expect(w.gust_kmh).toBe(31)
    expect(w.precip_mm).toBe(0.4)
    expect(w.wind_dir_deg).toBe(7)
  })
  it('takes an hour that started before the window but covers part of it', () => {
    const w = summariseWeather(hours, { from: '2026-08-01T14:30:00Z', to: '2026-08-01T15:10:00Z' })!
    expect(w.hours).toBe(2)
  })
  it('uses the nearest hour for an instant', () => {
    const w = summariseWeather(hours, { from: '2026-08-01T16:10:00Z', to: '2026-08-01T16:10:00Z' })!
    expect(w.hours).toBe(1)
    expect(w.temp_c).toBe(24)
  })
  it('is null when nothing is close enough', () => {
    expect(summariseWeather(hours, { from: '2026-08-02T10:00:00Z', to: '2026-08-02T10:00:00Z' })).toBeNull()
  })
  it('averages wind direction across north', () => {
    expect(meanDirection([350, 10])).toBe(0)
    expect(meanDirection([])).toBeNull()
    expect(compass(315)).toBe('NW')
    expect(compass(359)).toBe('N')
  })
  it('keeps a long job to the finish hour', () => {
    expect(weatherSpan({ started_at: '2026-08-01T14:00:00Z', finished_at: '2026-08-01T17:00:00Z', hours: null })).toEqual({ from: '2026-08-01T14:00:00Z', to: '2026-08-01T17:00:00Z' })
    expect(weatherSpan({ started_at: '2026-08-01T08:00:00Z', finished_at: '2026-08-03T17:00:00Z', hours: null })).toEqual({ from: '2026-08-03T17:00:00Z', to: '2026-08-03T17:00:00Z' })
  })
  it('asks for weather only once the time has passed, and not again too soon', () => {
    const now = Date.parse('2026-08-01T20:00:00Z')
    const base = { started_at: null, hours: null, weather: null, weather_tried_at: null }
    expect(weatherDue({ ...base, finished_at: '2026-08-01T17:00:00Z' }, now)).toBe(true)
    expect(weatherDue({ ...base, finished_at: '2026-08-01T22:00:00Z' }, now)).toBe(false)
    expect(weatherDue({ ...base, finished_at: '2026-08-01T17:00:00Z', weather_tried_at: '2026-08-01T19:00:00Z' }, now)).toBe(false)
    expect(weatherDue({ ...base, finished_at: '2026-08-01T17:00:00Z', weather: { temp_c: 1 } }, now)).toBe(false)
  })
  it('reads Open-Meteo arrays as UTC readings', () => {
    const r = readingsFromOpenMeteo({ time: ['2026-08-01T15:00'], temperature_2m: [22], wind_speed_10m: [null] })
    expect(r[0].ts).toBe('2026-08-01T15:00:00.000Z')
    expect(r[0].temp_c).toBe(22)
    expect(r[0].wind_kmh).toBeNull()
  })
  it('writes a compact line', () => {
    expect(
      weatherLine({ temp_c: 14.4, rh: 45, wind_kmh: 18, wind_dir_deg: 315, gust_kmh: 31, precip_mm: 0, solar_wm2: 520, hours: 1, from: '', to: '' }),
    ).toBe('14°C · RH 45% · wind 18 km/h NW, gusts 31 · no rain · 520 W/m²')
    expect(weatherLine(null)).toBeNull()
  })
})

describe('duplicate detection', () => {
  const pass = (o: Partial<DeerePassLite>): DeerePassLite => ({
    id: 'p1',
    field_id: 'f1',
    operation_type: 'harvest',
    started_at: '2026-09-10T15:00:00Z',
    ended_at: '2026-09-10T22:00:00Z',
    ...o,
  })
  const r = rec({ started_at: '2026-09-10T16:00:00Z', finished_at: '2026-09-10T21:00:00Z' })

  it('flags a Deere pass of the same kind on the same field at the same time', () => {
    expect(possibleDuplicates(r, [pass({})]).map((p) => p.id)).toEqual(['p1'])
  })
  it('allows six hours of slack for a time typed from memory', () => {
    expect(possibleDuplicates(r, [pass({ started_at: '2026-09-11T01:00:00Z', ended_at: '2026-09-11T02:00:00Z' })])).toHaveLength(1)
    expect(possibleDuplicates(r, [pass({ started_at: '2026-09-11T05:00:00Z', ended_at: '2026-09-11T06:00:00Z' })])).toHaveLength(0)
  })
  it('ignores other fields, other kinds, and types Deere has no match for', () => {
    expect(possibleDuplicates(r, [pass({ field_id: 'f2' })])).toHaveLength(0)
    expect(possibleDuplicates(r, [pass({ operation_type: 'seeding' })])).toHaveLength(0)
    expect(possibleDuplicates({ ...r, counts_as: null }, [pass({})])).toHaveLength(0)
  })
  it('reads the sittings when Deere rolled several days into one pass', () => {
    const rolled = pass({
      started_at: '2026-09-01T15:00:00Z',
      ended_at: '2026-09-20T22:00:00Z',
      sessions: [
        { start: '2026-09-01T15:00:00Z', end: '2026-09-01T22:00:00Z' },
        { start: '2026-09-20T15:00:00Z', end: '2026-09-20T22:00:00Z' },
      ],
    })
    // The span covers the 10th; neither sitting does.
    expect(possibleDuplicates(r, [rolled])).toHaveLength(0)
    expect(possibleDuplicates(r, [pass({ started_at: '2026-09-01T15:00:00Z', ended_at: '2026-09-20T22:00:00Z' })])).toHaveLength(1)
  })
  it('stops flagging a pass somebody called a different job', () => {
    expect(possibleDuplicates({ ...r, not_duplicate_of: ['p1'] }, [pass({})])).toHaveLength(0)
  })
})

describe('seeding and harvest days from hand records', () => {
  const rows = [
    { field_id: 'f1', crop_year: 2026, counts_as: 'harvest' as const, started_at: '2026-09-10T16:00:00Z', finished_at: '2026-09-12T23:00:00Z' },
    { field_id: 'f1', crop_year: 2026, counts_as: 'harvest' as const, started_at: null, finished_at: '2026-09-15T20:00:00Z' },
    { field_id: 'f1', crop_year: 2025, counts_as: 'harvest' as const, started_at: null, finished_at: '2025-09-15T20:00:00Z' },
    { field_id: 'f2', crop_year: 2026, counts_as: 'seeding' as const, started_at: '2026-05-02T15:00:00Z', finished_at: null },
  ]
  it('gives the first start and the last finish per field, in farm days', () => {
    const h = handWorkDays(rows, 'harvest', 2026, 'America/Edmonton')
    expect(handDayByField(h, 'first').get('f1')).toBe('2026-09-10')
    // 23:00 UTC on the 12th is still the 12th in Alberta; the last finish is the 15th.
    expect(handDayByField(h, 'last').get('f1')).toBe('2026-09-15')
    expect(handDayByField(handWorkDays(rows, 'seeding', 2026, 'America/Edmonton'), 'first').get('f2')).toBe('2026-05-02')
  })
  it('a hand harvest gives the harvest date when it is later than Deere, and only after a last load', () => {
    expect(effectiveHarvestDate({ typed: null, lastLoadOn: null, jdLastPassOn: '2026-09-12', handLastPassOn: '2026-09-15' })).toEqual({ date: '2026-09-15', source: 'hand' })
    expect(effectiveHarvestDate({ typed: null, lastLoadOn: null, jdLastPassOn: '2026-09-18', handLastPassOn: '2026-09-15' })).toEqual({ date: '2026-09-18', source: 'john_deere' })
    expect(effectiveHarvestDate({ typed: null, lastLoadOn: '2026-09-14', jdLastPassOn: null, handLastPassOn: '2026-09-15' })).toEqual({ date: '2026-09-14', source: 'last_load' })
    expect(effectiveHarvestDate({ typed: null, lastLoadOn: null, jdLastPassOn: null, handLastPassOn: '2026-04-01' }, { plantingDate: '2026-05-01' })).toEqual({ date: null, source: null })
  })
})
