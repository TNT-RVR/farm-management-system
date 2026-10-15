import { describe, expect, it } from 'vitest'
import { trafficLight, type ReadinessRow } from './pasture-light'

const row = (p: Partial<ReadinessRow>): ReadinessRow => ({
  pasture_id: 'x',
  name: 'Pasture X',
  readiness: 'ready',
  readiness_reason: null,
  forage_index: 0.4,
  days_rested: null,
  min_rest_days: 21,
  cattle_on_now: false,
  days_since_look: 1,
  ...p,
})

describe('trafficLight', () => {
  it('is red with cattle on it, when overgrazed, or before the rest is up', () => {
    expect(trafficLight(row({ cattle_on_now: true }), true).light).toBe('red')
    expect(trafficLight(row({ readiness: 'overgrazed', forage_index: 0.18 }), true).light).toBe('red')
    expect(trafficLight(row({ days_rested: 5 }), true)).toMatchObject({ light: 'red', why: 'Only 5 days rested of 21 needed.' })
  })

  it('is yellow when forage is thin, overmature, or the look is stale', () => {
    expect(trafficLight(row({ readiness: 'not_ready', forage_index: 0.25 }), false).why).toContain('not grazed yet this season')
    expect(trafficLight(row({ readiness: 'not_ready' }), false).light).toBe('yellow')
    expect(trafficLight(row({ readiness: 'overmature' }), true).light).toBe('yellow')
    expect(trafficLight(row({ days_since_look: 27 }), true).light).toBe('yellow')
  })

  it('is green when ready and rested, or ready and untouched this season', () => {
    expect(trafficLight(row({ days_rested: 30 }), true)).toMatchObject({ light: 'green' })
    expect(trafficLight(row({}), false).why).toContain('not grazed yet this season')
    expect(trafficLight(row({ readiness: 'optimal' }), false).light).toBe('green')
  })

  it('is grey with no look', () => {
    expect(trafficLight(undefined, false).light).toBe('grey')
  })
})
