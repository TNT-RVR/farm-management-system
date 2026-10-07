import { describe, expect, it } from 'vitest'
import { binsFromPasses } from '../../netlify/shared/fieldnet-applied'

describe('binsFromPasses', () => {
  const days = ['2026-07-13', '2026-07-14']
  it('puts the set depth on every degree a pass swept, on the day it crossed it', () => {
    // 10:00 to 20:00 local on 13 July (MDT, UTC−6), 90° forward from 350°.
    const bins = binsFromPasses(
      [{ started_at: '2026-07-13T16:00:00Z', ended_at: '2026-07-14T02:00:00Z', start_deg: 350, swept_deg: 90, direction: 'forward', depth_mm: 19.1 }],
      days,
    )
    const d1 = bins.get('2026-07-13')!
    expect(d1[355]).toBeCloseTo(19.1)
    expect(d1[30]).toBeCloseTo(19.1)
    expect(d1[100]).toBe(0)
    expect(d1.reduce((a, v) => a + v, 0)).toBeCloseTo(90 * 19.1)
    expect(bins.get('2026-07-14')!.every((v) => v === 0)).toBe(true)
  })
  it('splits a pass that runs past midnight between the two days', () => {
    // 18:00 13 July to 06:00 14 July local: half the degrees each side of midnight.
    const bins = binsFromPasses(
      [{ started_at: '2026-07-14T00:00:00Z', ended_at: '2026-07-14T12:00:00Z', start_deg: 0, swept_deg: 100, direction: 'forward', depth_mm: 10 }],
      days,
    )
    const a = bins.get('2026-07-13')!.filter((v) => v > 0).length
    const b = bins.get('2026-07-14')!.filter((v) => v > 0).length
    expect(a + b).toBe(100)
    expect(Math.abs(a - b)).toBeLessThanOrEqual(1)
  })
  it('ignores a pass still running or one that never moved', () => {
    const bins = binsFromPasses(
      [
        { started_at: '2026-07-13T16:00:00Z', ended_at: null, start_deg: 0, swept_deg: 40, direction: 'forward', depth_mm: 10 },
        { started_at: '2026-07-13T16:00:00Z', ended_at: '2026-07-13T16:01:00Z', start_deg: 0, swept_deg: 0, direction: 'forward', depth_mm: 10 },
      ],
      days,
    )
    expect([...bins.values()].every((b) => b.every((v) => v === 0))).toBe(true)
  })
})
