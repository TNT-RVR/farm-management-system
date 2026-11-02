import { describe, expect, it } from 'vitest'
import { canTakeWeight, scaleState, SCALE_STALE_MS, type ScaleReading } from './scale-live'

const reading = (r: Partial<ScaleReading> = {}): ScaleReading => ({
  weightKg: 38420,
  stable: true,
  mode: 'gross',
  seq: 1,
  updatedAt: '2026-10-29T18:00:00Z',
  ...r,
})

describe('scaleState', () => {
  const now = 1_000_000
  it('is offline with no reading, or nothing received lately', () => {
    expect(scaleState(null, null, now)).toBe('offline')
    expect(scaleState(reading(), now - SCALE_STALE_MS - 1, now)).toBe('offline')
  })
  it('is in motion until the indicator settles', () => {
    expect(scaleState(reading({ stable: false }), now, now)).toBe('motion')
  })
  it('is empty with nothing on the deck, or an indicator error', () => {
    expect(scaleState(reading({ weightKg: 0 }), now, now)).toBe('empty')
    expect(scaleState(reading({ weightKg: null }), now, now)).toBe('empty')
  })
  it('refuses a net reading: a load takes the full and the empty apart itself', () => {
    expect(scaleState(reading({ mode: 'net' }), now, now)).toBe('net')
    expect(canTakeWeight('net')).toBe(false)
  })
  it('lets a fresh, steady, gross weight be taken', () => {
    const s = scaleState(reading(), now - 2000, now)
    expect(s).toBe('stable')
    expect(canTakeWeight(s)).toBe(true)
  })
})
