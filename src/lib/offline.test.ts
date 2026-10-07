import { describe, expect, it } from 'vitest'
import type { Query } from '@tanstack/react-query'
import { isLiveOnly, shouldPersistQuery } from './offline'

const q = (key: unknown[], status = 'success') =>
  ({ queryKey: key, state: { status } }) as unknown as Query

describe('shouldPersistQuery', () => {
  it('keeps the records, plans and labels', () => {
    for (const key of [['fields'], ['crop_plans', 2026], ['chemicals', '', '', 'any'], ['tasks']]) {
      expect(shouldPersistQuery(q(key)), String(key)).toBe(true)
    }
  })

  it('refuses live readings', () => {
    // A pivot angle from Tuesday drawn on a Thursday screen looks exactly like
    // a Thursday one, and somebody may be deciding whether to walk up to the
    // machine. See the note in offline.ts.
    for (const key of [
      ['plc_live'],
      ['fieldnet_systems'],
      ['river_flow', 'lethbridge'],
      ['cameras', true],
    ]) {
      expect(shouldPersistQuery(q(key)), String(key)).toBe(false)
    }
  })

  it('refuses the weather, forecast included', () => {
    // Restored a week later, a 7-day forecast is a forecast whose first days
    // already happened, and current conditions from Monday read as today's.
    expect(shouldPersistQuery(q(['ranch_weather', 52.4, -108.7, 'best']))).toBe(false)
    expect(isLiveOnly('ranch_weather')).toBe(true)
  })

  it('refuses a query that failed', () => {
    // There is no data worth keeping, and persisting the error replays the
    // failure on the next cold start.
    expect(shouldPersistQuery(q(['fields'], 'error'))).toBe(false)
    expect(shouldPersistQuery(q(['fields'], 'pending'))).toBe(false)
  })

  it('refuses a key that is not a string at the head', () => {
    expect(shouldPersistQuery(q([{ odd: true }]))).toBe(false)
    expect(shouldPersistQuery(q([]))).toBe(false)
  })
})

describe('isLiveOnly', () => {
  it('names the keys the screens must refuse to show from cache', () => {
    expect(isLiveOnly('plc_live')).toBe(true)
    expect(isLiveOnly('fields')).toBe(false)
    expect(isLiveOnly(42)).toBe(false)
  })
})
