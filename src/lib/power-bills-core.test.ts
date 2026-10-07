import { describe, expect, it } from 'vitest'
import { billedPricePerKwh, powerByPump, siteCost, type BillSiteRow } from './power-bills-core'
import { matchPump } from '../../netlify/shared/power-bill-read'

// Made-up bills.
const site = (o: Partial<BillSiteRow>): BillSiteRow => ({
  id: Math.random().toString(36).slice(2),
  bill_id: 'b',
  site_id: null,
  meter_number: null,
  site_name: null,
  legal_land: null,
  rate_class: null,
  period_start: '2026-06-01',
  period_end: '2026-06-30',
  kwh: null,
  demand_kw: null,
  energy_charge: null,
  delivery_charge: null,
  demand_charge: null,
  other_charges: null,
  gst: null,
  total: null,
  pump_id: null,
  pump_set_by_hand: false,
  ...o,
})

describe('siteCost', () => {
  it('is the total less GST, or the parts when there is no total', () => {
    expect(siteCost(site({ total: 105, gst: 5 }))).toBe(100)
    expect(siteCost(site({ energy_charge: 60, delivery_charge: 30, demand_charge: 8, other_charges: 2 }))).toBe(100)
  })
})

describe('powerByPump', () => {
  const sites = [
    site({ pump_id: 'p1', kwh: 10_000, total: 1_050, gst: 50, demand_kw: 150, demand_charge: 300 }),
    site({ pump_id: 'p1', kwh: 5_000, total: 525, gst: 25, demand_kw: 160, period_start: '2026-07-01', period_end: '2026-07-31' }),
    site({ pump_id: 'p2', kwh: 2_000, total: 315, gst: 15 }),
    site({ meter_number: '999', kwh: 100, total: 21, gst: 1 }),
    site({ meter_number: '999', kwh: 100, total: 21, gst: 1, period_start: '2024-01-01', period_end: '2024-01-31' }),
  ]
  it('adds each pump up, cost before GST, and keeps the peak demand', () => {
    const r = powerByPump(sites, null)
    const p1 = r.find((x) => x.pumpId === 'p1')!
    expect(p1).toMatchObject({ bills: 2, kwh: 15_000, cost: 1_500, demandCharges: 300, peakKw: 160, first: '2026-06-01', last: '2026-07-31' })
    expect(p1.perKwh).toBeCloseTo(0.1, 6)
    expect(r[0].pumpId).toBe('p1') // dearest first
    const loose = r.find((x) => !x.pumpId)!
    expect(loose).toMatchObject({ key: 'site:999', label: 'Meter 999', bills: 2 })
  })
  it('leaves out bills that ended before the start', () => {
    expect(powerByPump(sites, '2026-01-01').find((x) => !x.pumpId)!.bills).toBe(1)
  })
  it('prices the grid from the matched pumps only', () => {
    const b = billedPricePerKwh(powerByPump(sites, null))!
    expect(b.kwh).toBe(17_000)
    expect(b.cost).toBe(1_800)
  })
})

describe('matchPump', () => {
  const pumps = [
    { id: 'a', power_meter_number: '1764549', legal_land: 'SW-12-70-16-4' },
    { id: 'b', power_meter_number: null, legal_land: 'NW 35-70-16 W4' },
    { id: 'c', power_meter_number: null, legal_land: 'NE 1-71-17 W4' },
    { id: 'd', power_meter_number: null, legal_land: 'NE 1-71-17 W4' },
  ]
  it('matches the meter number however it is printed', () => {
    expect(matchPump({ meter_number: '01764549', site_id: null, legal_land: null, site_name: null }, pumps)).toBe('a')
    expect(matchPump({ meter_number: 'M-1764549', site_id: null, legal_land: null, site_name: null }, pumps)).toBe('a')
  })
  it('falls back to the legal land, written either way', () => {
    expect(matchPump({ meter_number: null, site_id: null, legal_land: 'NW-35-70-16-4', site_name: null }, pumps)).toBe('b')
    expect(matchPump({ meter_number: '555', site_id: null, legal_land: null, site_name: 'Pivot pump NW 35-70-16 W4' }, pumps)).toBe('b')
  })
  it('reads land with or without the meridian, padded or not', () => {
    const p = [{ id: 'e', power_meter_number: null, legal_land: 'SE 5-71-13' }]
    expect(matchPump({ meter_number: '1712137', site_id: null, legal_land: 'SE-05-71-13-4', site_name: null, rate_class: 'Irrigation Rate of Last Resort' }, p)).toBe('e')
  })
  it('leaves a house or yard service on the same quarter alone', () => {
    const p = [{ id: 'e', power_meter_number: null, legal_land: 'SE 31-70-13' }]
    expect(matchPump({ meter_number: '1630307', site_id: null, legal_land: 'SE-31-70-13-4', site_name: 'AI RESIDENTIAL RRO', rate_class: 'A1 Residential RRO' }, p)).toBeNull()
  })
  it('does not take a site by its land when the pump has a different meter on record', () => {
    const p = [{ id: 'e', power_meter_number: '1733565', legal_land: 'SE 31-70-13' }]
    expect(matchPump({ meter_number: '1368309', site_id: null, legal_land: 'SE-31-70-13-4', site_name: null, rate_class: 'Irrigation' }, p)).toBeNull()
  })
  it('guesses nothing when two pumps share the land', () => {
    expect(matchPump({ meter_number: null, site_id: null, legal_land: 'NE 1-71-17 W4', site_name: null }, pumps)).toBeNull()
  })
})

describe('matchPump, retailer rate names', () => {
  const p = [{ id: 'rp', power_meter_number: null, legal_land: 'SE 31-70-13' }]
  it('takes an irrigation rate on the quarter, not the farm or solar one', () => {
    expect(matchPump({ meter_number: null, site_id: null, legal_land: 'SE 31 70 13 W4', site_name: null, rate_class: '8.44 ¢/kWh - 3 Year Irrigation Discount Rate' }, p)).toBe('rp')
    expect(matchPump({ meter_number: null, site_id: null, legal_land: 'SE 31 70 13 W4', site_name: null, rate_class: '8.54 ¢/kWh - 3 Year Farm Discount Rate' }, p)).toBeNull()
    expect(matchPump({ meter_number: null, site_id: null, legal_land: 'SE 31 70 13 W4', site_name: null, rate_class: 'MicroGen Solar Club Rate' }, p)).toBeNull()
  })
})
