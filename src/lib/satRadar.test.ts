import { describe, expect, it } from 'vitest'
import { toDecibels, RADAR_RESOLUTION_M } from '../../netlify/shared/sat-radar'
import {
  buildDailySeries,
  radarSaysStable,
  withRadarSupport,
  RADAR_STABLE_DB,
  RADAR_VOUCH_WINDOW_DAYS,
} from '../../netlify/shared/sat-daily'
import type { UsableObservation } from '../../netlify/shared/sat-daily'

describe('toDecibels', () => {
  it('converts linear power to dB', () => {
    expect(toDecibels(1)).toBe(0)
    expect(toDecibels(0.1)).toBe(-10)
    expect(toDecibels(0.01)).toBe(-20)
  })

  it('gives null rather than -Infinity for zero or negative power', () => {
    // log10(0) is -Infinity, which Postgres takes into a numeric column and
    // which then contaminates every average over it.
    expect(toDecibels(0)).toBeNull()
    expect(toDecibels(-0.5)).toBeNull()
    expect(toDecibels(null)).toBeNull()
    expect(toDecibels(Number.NaN)).toBeNull()
  })

  it('lands in the range real field backscatter occupies', () => {
    // Cropland gamma0 VV sits roughly -12 to -5 dB.
    const vv = toDecibels(0.1)!
    expect(vv).toBeGreaterThan(-30)
    expect(vv).toBeLessThan(0)
  })
})

describe('radar resolution', () => {
  it('samples at 20 m, not the 10 m pixel spacing', () => {
    // IW GRD resolves near 20 m and is merely sampled at 10. Asking for 10
    // quadruples the processing units to resolve detail that is not there.
    expect(RADAR_RESOLUTION_M).toBe(20)
  })
})

describe('radarSaysStable', () => {
  it('treats speckle-sized movement as no event', () => {
    expect(radarSaysStable({ day: '2026-08-06', changeDb: 0.8 })).toBe(true)
    expect(radarSaysStable({ day: '2026-08-06', changeDb: -1.5 })).toBe(true)
    expect(radarSaysStable({ day: '2026-08-06', changeDb: RADAR_STABLE_DB })).toBe(true)
  })

  it('declines to vouch when the field moved', () => {
    // Irrigation, rain, a cut or a harvest move VV by 4 to 6 dB.
    expect(radarSaysStable({ day: '2026-08-06', changeDb: 4.5 })).toBe(false)
    expect(radarSaysStable({ day: '2026-08-06', changeDb: -5 })).toBe(false)
  })

  it('declines to vouch when there is nothing to compare against', () => {
    // The first look of a season has no previous pass in its own orbit
    // direction. Absence of a change measurement is not evidence of calm.
    expect(radarSaysStable({ day: '2026-08-06', changeDb: null })).toBe(false)
  })
})

describe('withRadarSupport', () => {
  it('lifts a stale value one step when radar watched the gap quietly', () => {
    expect(withRadarSupport('low', 100, [99])).toBe('medium')
    expect(withRadarSupport('low', 100, [100 + RADAR_VOUCH_WINDOW_DAYS])).toBe('medium')
  })

  it('never manufactures high confidence from radar', () => {
    // Radar is not a vegetation index (spec §3.3). "Nothing dramatic happened"
    // is not a measurement of the canopy, so it can never mean 'high'.
    expect(withRadarSupport('low', 100, [100])).toBe('medium')
    expect(withRadarSupport('medium', 100, [100])).toBe('medium')
  })

  it('leaves an already-good value alone', () => {
    expect(withRadarSupport('high', 100, [100])).toBe('high')
    expect(withRadarSupport('high', 100, [])).toBe('high')
  })

  it('ignores a radar look too far from the day in question', () => {
    expect(withRadarSupport('low', 100, [100 + RADAR_VOUCH_WINDOW_DAYS + 1])).toBe('low')
    expect(withRadarSupport('low', 100, [])).toBe('low')
  })
})

describe('buildDailySeries with radar', () => {
  const obs = (sensedOn: string, ndvi: number): UsableObservation => ({
    sensedOn,
    ndvi,
    quality: 'full',
  })

  it('is unchanged when no radar is supplied', () => {
    const series = [obs('2026-08-02', 0.3), obs('2026-08-04', 0.5)]
    expect(buildDailySeries(series)).toEqual(buildDailySeries(series, []))
  })

  it('rescues the tail of a long gap that radar watched', () => {
    // Two looks 20 days apart: the middle of that gap is 'low' on age alone.
    const series = [obs('2026-08-01', 0.3), obs('2026-08-21', 0.5)]
    const bare = buildDailySeries(series)
    const watched = buildDailySeries(series, [{ day: '2026-08-12', changeDb: 0.4 }])

    const dayOf = (out: typeof bare, d: string) => out.find((x) => x.day === d)
    expect(dayOf(bare, '2026-08-12')?.confidence).toBe('low')
    expect(dayOf(watched, '2026-08-12')?.confidence).toBe('medium')
    // Days the radar look is too far from stay where they were.
    expect(dayOf(watched, '2026-08-18')?.confidence).toBe('low')
  })

  it('does not rescue a gap in which radar saw the field change', () => {
    const series = [obs('2026-08-01', 0.3), obs('2026-08-21', 0.5)]
    const moved = buildDailySeries(series, [{ day: '2026-08-12', changeDb: 5.5 }])
    expect(moved.find((x) => x.day === '2026-08-12')?.confidence).toBe('low')
  })

  it('never lets radar change the NDVI itself', () => {
    // §3.3: no NDVI-equivalent value may be derived from radar. It may only
    // move confidence.
    const series = [obs('2026-08-01', 0.3), obs('2026-08-21', 0.5)]
    const bare = buildDailySeries(series)
    const watched = buildDailySeries(series, [{ day: '2026-08-12', changeDb: 0.1 }])
    expect(watched.map((d) => d.ndvi)).toEqual(bare.map((d) => d.ndvi))
    expect(watched.map((d) => d.daysSinceObservation)).toEqual(
      bare.map((d) => d.daysSinceObservation),
    )
  })
})
