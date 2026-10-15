import { describe, expect, it } from 'vitest'
import { fieldPumpShares, irrigationPowerLine, powerByUse, powerUse, pumpSeasons } from './irrigation-power-core'
import type { BillSiteRow } from './power-bills-core'

// Made-up bills.
const site = (o: Partial<BillSiteRow>): BillSiteRow => ({
  id: Math.random().toString(36).slice(2),
  bill_id: 'b',
  site_id: null,
  meter_number: null,
  site_name: null,
  legal_land: null,
  rate_class: 'Irrigation Discount Rate',
  period_start: null,
  period_end: '2026-07-10',
  kwh: 1000,
  demand_kw: null,
  energy_charge: null,
  delivery_charge: null,
  demand_charge: null,
  other_charges: null,
  gst: 5,
  total: 105,
  pump_id: null,
  pump_set_by_hand: false,
  ...o,
})

describe('powerUse', () => {
  it('is irrigation on a pump, solar on a microgen rate, overhead otherwise', () => {
    expect(powerUse(site({ pump_id: 'p' }))).toBe('irrigation')
    expect(powerUse(site({ pump_id: null }))).toBe('overhead')
    expect(powerUse(site({ pump_id: null, rate_class: '35.00 ¢/kWh - MicroGen Solar Club Rate' }))).toBe('solar')
  })
})

describe('pumpSeasons', () => {
  const sites = [
    site({ pump_id: 'p', period_end: '2026-07-10' }),
    site({ pump_id: 'p', period_end: '2027-02-11', total: 21, gst: 1 }), // winter charges go with the 2026 season
    site({ pump_id: 'p', period_end: '2026-04-14', total: 21, gst: 1 }), // April belongs to 2025's
    site({ pump_id: 'q', period_end: '2025-08-12', total: 210, gst: 10 }),
  ]
  it('puts May–April on one season', () => {
    expect(pumpSeasons(sites, 2026).get('p')).toMatchObject({ season: 2026, cost: 120, bills: 2 })
    expect(pumpSeasons(sites, 2025).get('p')).toMatchObject({ season: 2025, cost: 20, bills: 1 })
  })
  it('falls back to the season before, no further', () => {
    expect(pumpSeasons(sites, 2026).get('q')).toMatchObject({ season: 2025, cost: 200 })
    expect(pumpSeasons(sites, 2027).get('q')).toBeUndefined()
    expect(pumpSeasons(sites, 2024).get('q')).toBeUndefined()
  })
})

describe('irrigation power for a field', () => {
  const pivots = [
    { field_id: 'f0', pump_id: 't', acres_irrigated: 100 },
    { field_id: 'f1', pump_id: 't', acres_irrigated: 300 },
    { field_id: 'f2', pump_id: 'u', acres_irrigated: null },
    { field_id: 'f3', pump_id: 'u', acres_irrigated: null },
  ]
  it('splits a pump by irrigated acres, evenly where none are entered', () => {
    expect(fieldPumpShares(pivots, 'f0')).toEqual([{ pumpId: 't', share: 0.25, acres: 100 }])
    expect(fieldPumpShares(pivots, 'f2')[0].share).toBe(0.5)
  })
  it('charges the field its share of the season', () => {
    const seasons = new Map([['t', { pumpId: 't', cost: 8000, kwh: 40000, bills: 6, season: 2026 }]])
    const l = irrigationPowerLine({ fieldId: 'f1', year: 2026, pivots, seasons, pumpName: () => 'North Turbine' })!
    expect(l.total).toBe(6000)
    expect(l.acres).toBe(300)
    expect(l.source).toContain('North Turbine: 2026 season, $8,000 on 6 bills, 75% by irrigated acres')
    expect(irrigationPowerLine({ fieldId: 'f2', year: 2026, pivots, seasons, pumpName: () => '' })).toBeNull()
  })
})

it('powerByUse sums a year by use, before GST', () => {
  const r = powerByUse(
    [site({ pump_id: 'p', period_end: '2025-10-10' }), site({ period_end: '2026-01-02' }), site({ rate_class: 'MicroGen Solar', period_end: '2026-06-02', total: -1050, gst: -50 }), site({ period_end: '2026-09-02' })],
    '2025-09-01',
    '2026-08-31',
  )
  expect([r.irrigation, r.overhead, r.solar, r.months.size]).toEqual([100, 100, -1000, 3])
})
