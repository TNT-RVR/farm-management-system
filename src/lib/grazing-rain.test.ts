import { describe, expect, it } from 'vitest'
import { grazingRain, type RanchPrecip } from './grazing'

/*
 * Which rainfall figure does which job (Sam, 12 Nov 2026).
 *
 * The Forage Yield Estimator's rows are long-term ANNUAL precipitation zones
 * — p.205 of the Alberta Forage Manual heads them so, and its worked examples
 * pick the row off the soil climatic zone rather than off a gauge. So the zone
 * picks the row and does not move with the weather, and how this season is
 * going scales what that row yields. These are Home Ranch's real figures: a
 * 382 mm annual normal, a 270 mm normal season.
 */
const measured = (over: Partial<RanchPrecip> = {}): RanchPrecip => ({
  total_mm: 150,
  days: 100,
  through: '2026-07-09',
  series: [],
  normal: { years: [], avg_season_mm: 270, avg_to_date_mm: 150, cumulative: [] },
  annual_normal_mm: 382,
  ...over,
})

const ranch = { precip_auto: true, grazing_precip_mm: 300, forage_zone_mm: null }

describe('grazingRain', () => {
  it("takes the ranch's own classification over any measurement", () => {
    // Every soil polygon under both ranches is a Brown Chernozem, and the
    // manual reads the Brown soil climatic zone at 300 mm. The Open-Meteo
    // reanalysis says 382 mm, which would read as Dark Brown and lift the
    // forage a whole row. The soil map wins: it is what the table was built
    // around, and a reanalysis grid point is not a rain gauge.
    const r = grazingRain({ ...ranch, forage_zone_mm: 300 }, measured())
    expect(r.zoneMm).toBe(300)
    expect(r.zoneSource).toBe('soil')
    // The season still scales it, exactly as before.
    expect(r.rainFactor).toBeCloseTo(1, 6)
  })

  it('falls back to the annual average for a ranch nobody has classified', () => {
    const r = grazingRain(ranch, measured())
    expect(r.zoneMm).toBe(382)
    expect(r.zoneSource).toBe('annual')
    // The season figures are still there, doing their own job.
    expect(r.forecastMm).toBe(270)
  })

  it('scales by the projected season against a normal one', () => {
    // 150 mm to date, and a normal rest of season is 270 - 150 = 120, so the
    // projection is 270: an ordinary year, and no scaling.
    expect(grazingRain(ranch, measured()).rainFactor).toBeCloseTo(1, 6)
    // 220 to date by the same day is well ahead: projected 340 of 270.
    const wet = grazingRain(ranch, measured({ total_mm: 220 }))
    expect(wet.rainFactor).toBeCloseTo(340 / 270, 6)
    expect(wet.zoneMm).toBe(382)
  })

  it('a wet year does not move the ranch to a wetter zone', () => {
    const dry = grazingRain(ranch, measured({ total_mm: 40 }))
    const wet = grazingRain(ranch, measured({ total_mm: 320 }))
    expect(dry.zoneMm).toBe(wet.zoneMm)
    expect(dry.rainFactor).toBeLessThan(wet.rainFactor)
  })

  it('lets a typed figure pin the zone by hand, with no scaling', () => {
    const r = grazingRain({ precip_auto: false, grazing_precip_mm: 325 }, measured())
    expect(r.zoneMm).toBe(325)
    expect(r.zoneSource).toBe('manual')
    expect(r.rainFactor).toBe(1)
  })

  it('keeps the season figure as the zone when the archive gave no annual', () => {
    const r = grazingRain(ranch, measured({ annual_normal_mm: null }))
    expect(r.zoneMm).toBe(270)
    expect(r.zoneSource).toBe('season')
  })

  it('falls back to the typed figure when there is no archive at all', () => {
    const r = grazingRain(ranch, null)
    expect(r.zoneMm).toBe(300)
    expect(r.rainFactor).toBe(1)
  })
})
