import { describe, expect, it } from 'vitest'
import { aboveGrain } from './bin-monitor'

describe('the sensors above the grain', () => {
  it('ticks the top sensors of a half-full bin', () => {
    // Main Yard - #21 on 26 Oct 2026: 3,186 bu of a 5,800 bu bin, 5 sensors.
    expect(aboveGrain(5, 3186 / 5800)).toEqual([true, true, false, false, false])
  })

  it('leaves a full bin alone', () => {
    // #22 the same day: 5,497 of 5,800, 9 sensors — every one of them buried.
    expect(aboveGrain(9, 5497 / 5800)).toEqual(Array.from({ length: 9 }, () => false))
  })

  it('only ticks a sensor whose whole slice is above the grain', () => {
    // Half full, 4 sensors: the second one straddles the grain line, so it stays.
    expect(aboveGrain(4, 0.5)).toEqual([true, false, false, false])
  })

  it('ticks nothing without both figures, nor for an empty bin', () => {
    expect(aboveGrain(3, null)).toEqual([false, false, false])
    expect(aboveGrain(3, 0)).toEqual([false, false, false])
    expect(aboveGrain(3, 1.2)).toEqual([false, false, false])
    expect(aboveGrain(0, 0.5)).toEqual([])
  })
})
