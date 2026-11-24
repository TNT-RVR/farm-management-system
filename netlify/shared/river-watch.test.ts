import { describe, expect, it } from 'vitest'
import { readGauge } from './river-watch'

const f = (t: string, q: number | null, level = 1) => ({ properties: { DATETIME: t, DISCHARGE: q, LEVEL: level } })

describe('readGauge', () => {
  it('reads latest flow and the window low', () => {
    const r = readGauge(
      [f('2026-11-01T03:00:00Z', 12), f('2026-11-01T01:00:00Z', 8), f('2026-10-31T12:00:00Z', 2)],
      6,
    )
    expect(r.readings).toBe(3)
    expect(r.flow).toEqual({ latestQ: 12, latestT: Date.parse('2026-11-01T03:00:00Z'), windowMinQ: 8 })
  })

  it('treats levels without flow as reachable but paused (river ice)', () => {
    const r = readGauge([f('2026-11-24T05:05:00Z', null), f('2026-11-24T05:00:00Z', null)], 6)
    expect(r).toEqual({ readings: 2, flow: null })
  })

  it('treats an empty answer as no readings', () => {
    expect(readGauge(undefined, 6)).toEqual({ readings: 0, flow: null })
  })
})
