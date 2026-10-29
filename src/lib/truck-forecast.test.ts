import { describe, expect, it } from 'vitest'
import { averageLoad, remainingText, truckForecast, weighedFrom, type ForecastLoad } from './truck-forecast'

const load = (o: Partial<ForecastLoad>): ForecastLoad => ({
  field_id: 'f1',
  crop_id: 'canola',
  crop_year: 2026,
  net_kg: 40000,
  bushels: 1764,
  truck: 'Volvo #1',
  entry_kind: 'weighed',
  ...o,
})
const active = new Set(['Volvo #1', 'Teal Kenworth 76-P843'])

describe('averageLoad', () => {
  it("leaves out a truck taken off the list (Clay's half load)", () => {
    const a = averageLoad([load({ net_kg: 40000 }), load({ net_kg: 44000 }), load({ net_kg: 26880, truck: 'Clays Truck' })], active, null)
    expect(a).toEqual({ kg: 42000, loads: 2, scope: 'all' })
  })

  it('counts loads with no truck recorded', () => {
    expect(averageLoad([load({ truck: null, net_kg: 41200 })], active, null)?.kg).toBe(41200)
  })

  it('leaves out guesses, bin totals and half-weighed loads', () => {
    const a = averageLoad(
      [load({ net_kg: 40000 }), load({ estimated: true, net_kg: 1 }), load({ entry_kind: 'bin_total', net_kg: 999999 }), load({ open: true, net_kg: 5 })],
      active,
      null,
    )
    expect(a?.kg).toBe(40000)
  })

  it("uses the crop's own average from three loads, the farm's before", () => {
    const wheat = [1, 2, 3].map(() => load({ crop_id: 'wheat', net_kg: 50000 }))
    const two = [load({ net_kg: 40000 }), load({ net_kg: 40000 })]
    expect(averageLoad([...wheat, ...two], active, 'canola')).toMatchObject({ scope: 'all', loads: 5 })
    expect(averageLoad([...wheat, ...two, load({ net_kg: 40000 })], active, 'canola')).toEqual({ kg: 40000, loads: 3, scope: 'crop' })
  })

  it('no usable load, no average', () => {
    expect(averageLoad([load({ truck: 'Clays Truck' })], active, null)).toBeNull()
  })
})

describe('truckForecast', () => {
  const average = { kg: 40000, loads: 10, scope: 'all' as const }
  // 10,000 bu of 50 lb canola = 226,796 kg = 5.67 loads → 6 trucks.
  it('rounds the trucks up', () => {
    expect(truckForecast({ forecastBu: 10000, lbPerBu: 50, average, weighed: 0, weighedBu: 0, done: false })).toMatchObject({ totalTrucks: 6, remaining: 6 })
  })

  it('counts down from the bushels still to come', () => {
    // 4,000 bu weighed: 6,000 left = 136,078 kg = 3.4 → 4 more.
    expect(truckForecast({ forecastBu: 10000, lbPerBu: 50, average, weighed: 2, weighedBu: 4000, done: false })).toMatchObject({ remaining: 4, remainingBu: 6000 })
  })

  it('past the forecast: none more, and by how much', () => {
    const f = truckForecast({ forecastBu: 10000, lbPerBu: 50, average, weighed: 7, weighedBu: 12100, done: false })!
    expect([f.remaining, f.overBu]).toEqual([0, 2100])
    expect(remainingText(f)).toBe('2,100 bu past the forecast')
  })

  it('last load marked: done', () => {
    const f = truckForecast({ forecastBu: 10000, lbPerBu: 50, average, weighed: 3, weighedBu: 5000, done: true })!
    expect(f.remaining).toBe(0)
    expect(remainingText(f)).toBe('Done')
  })

  it('cannot forecast without a yield, a test weight or an average', () => {
    expect(truckForecast({ forecastBu: null, lbPerBu: 50, average, weighed: 0, weighedBu: 0, done: false })).toBeNull()
    expect(truckForecast({ forecastBu: 100, lbPerBu: null, average, weighed: 0, weighedBu: 0, done: false })).toBeNull()
    expect(truckForecast({ forecastBu: 100, lbPerBu: 50, average: null, weighed: 0, weighedBu: 0, done: false })).toBeNull()
  })

  it('one more truck reads singular', () => {
    expect(remainingText(truckForecast({ forecastBu: 1000, lbPerBu: 50, average, weighed: 0, weighedBu: 0, done: false })!)).toBe('About 1 more truck')
  })
})

describe('weighedFrom', () => {
  it("this field, this crop, this season's finished loads", () => {
    const w = weighedFrom(
      [load({}), load({ bushels: 1000, last_from_field: true }), load({ field_id: 'f2' }), load({ crop_year: 2025 }), load({ crop_id: 'corn' }), load({ open: true })],
      'f1',
      'canola',
      2026,
    )
    expect(w).toEqual({ weighed: 2, weighedBu: 2764, done: true })
  })
})
