import { describe, it, expect } from 'vitest'
import {
  hourIndex,
  passHourUtc,
  readAverageSpeed,
  speedToKmh,
} from '../../netlify/shared/jd-conditions'

// Shapes taken from a real ApplicationSpeedResult reply (operation
// 7da8a62a, 2026-08-07), not from a guess at the undocumented schema.
describe('readAverageSpeed', () => {
  const body = {
    '@type': 'FieldOperationMeasurement',
    measurementName: 'ApplicationSpeedResult',
    applicationProductTotals: [
      {
        name: 'Roundup (1 l/ac)/Aim/Merge Pre-Burn',
        appliedArea: { value: 29.92, unitId: 'ha' },
        averageSpeed: { value: 17.7, unitId: 'km1hr-1' },
      },
    ],
  }

  it('finds the speed where Deere actually puts it', () => {
    expect(readAverageSpeed(body)).toEqual({ value: 17.7, unitId: 'km1hr-1' })
  })

  it('skips a product total that has no speed rather than reporting zero', () => {
    expect(
      readAverageSpeed({ applicationProductTotals: [{ name: 'x' }, { averageSpeed: { value: 9 } }] }),
    ).toEqual({ value: 9 })
  })

  it('gives null for the shapes that are not this one', () => {
    expect(readAverageSpeed({})).toBeNull()
    expect(readAverageSpeed(null)).toBeNull()
    expect(readAverageSpeed({ applicationProductTotals: 'not an array' })).toBeNull()
  })
})

describe('speedToKmh', () => {
  it('passes km/h through — Deere writes it km1hr-1', () => {
    expect(speedToKmh({ value: 17.7, unitId: 'km1hr-1' })).toBe(17.7)
  })

  it('converts mph and m/s', () => {
    expect(speedToKmh({ value: 10, unitId: 'mi1hr-1' })).toBeCloseTo(16.09344, 5)
    expect(speedToKmh({ value: 10, unitId: 'm1s-1' })).toBeCloseTo(36, 5)
  })

  it('passes null through', () => {
    expect(speedToKmh(null)).toBeNull()
  })
})

describe('passHourUtc', () => {
  it('takes the midpoint — the weather at the start is not the whole pass', () => {
    const h = passHourUtc('2026-08-07T14:00:00Z', '2026-08-07T16:00:00Z')
    expect(h?.toISOString()).toBe('2026-08-07T15:00:00.000Z')
  })

  it('falls back to the start when the end is missing or nonsense', () => {
    expect(passHourUtc('2026-08-07T14:00:00Z', null)?.toISOString()).toBe('2026-08-07T14:00:00.000Z')
    expect(passHourUtc('2026-08-07T14:00:00Z', '2026-08-07T13:00:00Z')?.toISOString()).toBe(
      '2026-08-07T14:00:00.000Z',
    )
  })

  it('gives null for an unparseable start', () => {
    expect(passHourUtc('not a date', null)).toBeNull()
  })
})

describe('hourIndex', () => {
  const times = ['2026-08-07T13:00', '2026-08-07T14:00', '2026-08-07T15:00']

  it('picks the nearest hour', () => {
    expect(hourIndex(times, new Date('2026-08-07T14:20:00Z'))).toBe(1)
    expect(hourIndex(times, new Date('2026-08-07T14:40:00Z'))).toBe(2)
  })

  it('refuses an hour too far away to be that pass', () => {
    expect(hourIndex(times, new Date('2026-08-07T22:00:00Z'))).toBe(-1)
    expect(hourIndex([], new Date())).toBe(-1)
    expect(hourIndex(undefined, new Date())).toBe(-1)
  })
})

describe('passHourUtc on a multi-day operation', () => {
  it('anchors on the start, not a midpoint nobody sprayed in', () => {
    // A real one: operation 0c3db2d1 ran 2026-07-28 to 2026-08-07. Its midpoint
    // is 2 August, a day the sprayer may never have moved.
    const h = passHourUtc('2026-07-28T12:46:39Z', '2026-08-07T14:16:20Z')
    expect(h?.toISOString()).toBe('2026-07-28T12:46:39.000Z')
  })

  it('still takes the midpoint of a pass that fits in a day', () => {
    const h = passHourUtc('2026-08-07T08:00:00Z', '2026-08-07T14:00:00Z')
    expect(h?.toISOString()).toBe('2026-08-07T11:00:00.000Z')
  })
})
