import { describe, expect, it } from 'vitest'
import { firstCheck, formDate, fullLegal, growerBinLabel, isCheckDue, kgText, levelsFromTop, longDate, nextCheck, sensorCell, sensorLabels, topPositions, weatherText } from './format'

describe('fullLegal', () => {
  it('keeps the meridian, tidies the spaces', () => {
    expect(fullLegal('  W1/2 SE-9-40-26-W4 ')).toBe('W1/2 SE-9-40-26-W4')
    // Not a real description: the public copy's stand-ins would move it.
    expect(fullLegal('Quarter  A   of  B')).toBe('Quarter A of B')
    expect(fullLegal(' ')).toBeNull()
    expect(fullLegal(null)).toBeNull()
  })
})


describe('labels and numbers', () => {
  it('shortens a bin name to what is painted on it', () => {
    expect(growerBinLabel('Main Yard- #20 (Fertilizer Bin)')).toBe('Main Yard #20')
    expect(growerBinLabel('#7')).toBe('#7')
  })
  it('writes kg whole, dates long and short', () => {
    expect(kgText(12345.6)).toBe('12,346')
    expect(kgText(null)).toBe('')
    expect(longDate('2026-10-19')).toBe('October 19, 2026')
    expect(formDate('2026-10-05')).toBe('10/05/26')
  })
})

describe('weatherText', () => {
  const base = { rh: 50, wind_dir_deg: 270, gust_kmh: null, hours: 7, from: '', to: '' }
  it('reads the sky off the sunshine', () => {
    expect(weatherText({ ...base, temp_c: 14.4, wind_kmh: 12.2, precip_mm: 0, solar_wm2: 520 })).toBe('Sunny, 14 °C, dry, wind 12 km/h')
    expect(weatherText({ ...base, temp_c: 8, wind_kmh: 30, precip_mm: 2.36, solar_wm2: 120 })).toBe('Cloudy, 8 °C, rain 2.4 mm, wind 30 km/h')
    expect(weatherText({ ...base, temp_c: 10, wind_kmh: null, precip_mm: null, solar_wm2: 300 })).toBe('Partly cloudy, 10 °C, dry')
  })
  it('says nothing without a temperature', () => {
    expect(weatherText(null)).toBeNull()
    expect(weatherText({ ...base, temp_c: null, wind_kmh: 1, precip_mm: 0, solar_wm2: 500 })).toBeNull()
  })
})

describe('generic sensors, top first', () => {
  const lv = (level: number, temp_c: number, o: { air?: boolean; rh?: number } = {}) => ({
    level,
    temp_c,
    rh_pct: o.rh ?? null,
    moisture_pct: o.rh == null ? temp_c / 2 : null,
    moisture_from: 'table' as const,
    air: o.air,
  })
  it('takes every grain sensor, however long the cable, top first', () => {
    const levels = [lv(3, 11), lv(1, 30, { air: true }), lv(2, 12), lv(4, 10), lv(5, 9), lv(6, 8), lv(7, 7), lv(8, 6)]
    expect(topPositions(levels).map((p) => p.temp_c)).toEqual([12, 11, 10, 9, 8, 7, 6])
  })
  it('numbers the headings from the top', () => {
    expect(sensorLabels(3)).toEqual(['1 (top)', '2', '3 (bottom)'])
    expect(sensorLabels(1)).toEqual(['1'])
  })
  it('writes moisture, or humidity where that was read', () => {
    expect(sensorCell({ temp_c: 9.24, moisture_pct: 6.14 })).toBe('9.2°C 6.1%')
    expect(sensorCell({ temp_c: 9.2, moisture_pct: null, rh_pct: 55.4 })).toBe('9.2°C 55% RH')
    expect(sensorCell({ temp_c: null, moisture_pct: null })).toBe('')
    expect(sensorCell(undefined)).toBe('')
  })
  it('round-trips a typed reading', () => {
    const typed = [1, 2, 3, 4, 5, 6, 7].map((v) => ({ temp_c: v, moisture_pct: v + 0.5, rh_pct: null }))
    const levels = levelsFromTop(typed)
    expect(levels[0]).toMatchObject({ level: 1, temp_c: 1, moisture_from: 'sensor' })
    expect(topPositions(levels)).toEqual(typed)
  })
})


describe('when readings are due', () => {
  // Harvest finished Wednesday 1 Oct 2026; the first Monday after is 5 Oct.
  const harvest = '2026-10-01'
  it('starts the Monday after harvest', () => {
    expect(firstCheck(harvest)).toBe('2026-10-05')
    expect(firstCheck('2026-10-05')).toBe('2026-10-12') // a Monday harvest counts from the next
    expect(firstCheck('2026-10-04')).toBe('2026-10-05') // Sunday
  })
  it('is weekly for four Mondays, then every second Monday', () => {
    const mondays = Array.from({ length: 10 }, (_, i) => new Date(Date.UTC(2026, 9, 5 + 7 * i)).toISOString().slice(0, 10))
    expect(mondays.filter((d) => isCheckDue(harvest, d))).toEqual(['2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26', '2026-11-09', '2026-11-23', '2026-12-07'])
    expect(isCheckDue(harvest, '2026-10-06')).toBe(false) // not a Monday
    expect(isCheckDue(harvest, '2026-09-28')).toBe(false) // before harvest
    expect(isCheckDue(null, '2026-10-05')).toBe(false)
  })
  it('stops after 40 weeks', () => {
    expect(isCheckDue(harvest, '2027-06-21')).toBe(true) // week 37
    expect(isCheckDue(harvest, '2027-07-12')).toBe(false) // week 40
  })
  it('finds the next one', () => {
    expect(nextCheck(harvest, '2026-10-20')).toBe('2026-10-26')
    expect(nextCheck(harvest, '2026-10-27')).toBe('2026-11-09')
    expect(nextCheck(harvest, '2026-09-01')).toBe('2026-10-05')
  })
})
