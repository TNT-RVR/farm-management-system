import { describe, expect, it } from 'vitest'
import {
  buildDailySeries,
  confidenceFor,
  savitzkyGolay,
  MAX_EXTRAPOLATION_DAYS,
  SG_COEFFICIENTS,
} from '../../netlify/shared/sat-daily'
import type { UsableObservation } from '../../netlify/shared/sat-daily'

const obs = (sensedOn: string, ndvi: number, quality: 'full' | 'partial' = 'full'): UsableObservation => ({
  sensedOn,
  ndvi,
  quality,
})

describe('savitzkyGolay', () => {
  it('leaves a straight line straight', () => {
    // A quadratic filter reproduces a line exactly. If it did not, green-up
    // would be bent by the smoother rather than by the crop.
    const line = [0, 1, 2, 3, 4, 5, 6, 7, 8]
    const out = savitzkyGolay(line)
    for (let i = 0; i < line.length; i++) expect(out[i]).toBeCloseTo(line[i], 10)
  })

  it('pulls down a single-day spike without erasing it', () => {
    const spiky = [0.4, 0.4, 0.4, 0.9, 0.4, 0.4, 0.4]
    const out = savitzkyGolay(spiky)
    expect(out[3]).toBeLessThan(0.9)
    expect(out[3]).toBeGreaterThan(0.4)
  })

  it('returns a too-short series untouched rather than inventing padding', () => {
    const short = [0.3, 0.5, 0.4]
    expect(savitzkyGolay(short)).toEqual(short)
  })

  it('uses the standard quadratic 7-point coefficients', () => {
    expect(SG_COEFFICIENTS).toEqual([-2, 3, 6, 7, 6, 3, -2])
    expect(SG_COEFFICIENTS.reduce((a, b) => a + b, 0)).toBe(21)
  })
})

describe('confidenceFor', () => {
  it('is high only on a fresh, full look', () => {
    expect(confidenceFor(0, 'full')).toBe('high')
    expect(confidenceFor(3, 'full')).toBe('high')
  })

  it('never calls a partial look high, however recent', () => {
    // A value resting on 70% of a field is not a high-confidence value just
    // because the satellite passed this morning.
    expect(confidenceFor(0, 'partial')).toBe('medium')
  })

  it('degrades with age on the spec §4.6 boundaries', () => {
    expect(confidenceFor(4, 'full')).toBe('medium')
    expect(confidenceFor(8, 'full')).toBe('medium')
    expect(confidenceFor(9, 'full')).toBe('low')
  })
})

describe('buildDailySeries', () => {
  it('refuses to draw a line through one point', () => {
    // One look repeated across a fortnight is a claim about days nobody looked.
    expect(buildDailySeries([obs('2026-08-02', 0.4)])).toEqual([])
    expect(buildDailySeries([])).toEqual([])
  })

  it('fills every day between two observations', () => {
    const out = buildDailySeries([obs('2026-08-02', 0.2), obs('2026-08-06', 0.6)])
    const days = out.map((d) => d.day)
    expect(days[0]).toBe('2026-08-02')
    expect(days).toContain('2026-08-03')
    expect(days).toContain('2026-08-04')
    // Four days of gap plus the five allowed past the last look.
    expect(out).toHaveLength(5 + MAX_EXTRAPOLATION_DAYS)
  })

  it('interpolates linearly between two looks', () => {
    const out = buildDailySeries([obs('2026-08-02', 0.2), obs('2026-08-06', 0.6)])
    const mid = out.find((d) => d.day === '2026-08-04')
    // Series is too short for the 7-wide filter, so this is the raw line.
    expect(mid?.ndvi).toBeCloseTo(0.4, 6)
  })

  it('stops 5 days past the last observation and no further', () => {
    const out = buildDailySeries([obs('2026-08-02', 0.3), obs('2026-08-10', 0.5)])
    expect(out[out.length - 1].day).toBe('2026-08-15')
    expect(out.some((d) => d.day === '2026-08-16')).toBe(false)
  })

  it('ages the confidence out past the last look', () => {
    const out = buildDailySeries([obs('2026-08-02', 0.3), obs('2026-08-10', 0.5)])
    const byDay = new Map(out.map((d) => [d.day, d]))
    expect(byDay.get('2026-08-10')?.daysSinceObservation).toBe(0)
    expect(byDay.get('2026-08-10')?.confidence).toBe('high')
    expect(byDay.get('2026-08-13')?.daysSinceObservation).toBe(3)
    expect(byDay.get('2026-08-14')?.confidence).toBe('medium')
    // Mid-gap days are aged from the observation behind them, not the one ahead.
    expect(byDay.get('2026-08-09')?.daysSinceObservation).toBe(7)
    expect(byDay.get('2026-08-09')?.confidence).toBe('medium')
  })

  it('holds the last value rather than extending its slope', () => {
    // A slope extended into cloud runs away. Green-up at 0.05/day carried five
    // days past the last look invents a quarter of an NDVI unit.
    const out = buildDailySeries([obs('2026-08-02', 0.2), obs('2026-08-06', 0.6)])
    const tail = out.filter((d) => d.day > '2026-08-06')
    for (const d of tail) expect(d.ndvi).toBeCloseTo(0.6, 6)
  })

  it('keeps every value inside the range NDVI can occupy', () => {
    const out = buildDailySeries([
      obs('2026-08-01', 0.05),
      obs('2026-08-04', 0.95),
      obs('2026-08-07', 0.1),
      obs('2026-08-10', 0.9),
      obs('2026-08-13', 0.05),
      obs('2026-08-16', 0.95),
      obs('2026-08-19', 0.1),
    ])
    for (const d of out) {
      expect(d.ndvi).toBeGreaterThanOrEqual(-1)
      expect(d.ndvi).toBeLessThanOrEqual(1)
    }
  })

  it('smooths a real-shaped series without moving its ends', () => {
    const series = [
      obs('2026-08-02', 0.30),
      obs('2026-08-05', 0.34),
      obs('2026-08-08', 0.31),
      obs('2026-08-11', 0.40),
      obs('2026-08-14', 0.44),
      obs('2026-08-17', 0.47),
    ]
    const out = buildDailySeries(series)
    expect(out[0].ndvi).toBeCloseTo(0.3, 6)
    expect(out[out.length - 1].ndvi).toBeCloseTo(0.47, 6)
    // The 8 Aug dip is real but small; smoothing should not turn it into a
    // trough deeper than the observation that caused it.
    const dip = out.find((d) => d.day === '2026-08-08')
    expect(dip!.ndvi).toBeGreaterThan(0.30)
  })
})
