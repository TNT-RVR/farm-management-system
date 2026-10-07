import { describe, expect, it } from 'vitest'
import { fieldHarvestSoFar, bushelsFromKg, testWeightFor, isOpenLoad, lastTare, type BinLoad } from './bin-loads'

describe('bushelsFromKg', () => {
  it('turns the scale photos into the bushels that went in the bin', () => {
    // John's three loads of BASF canola, 21–23 Sep 2026: 50 lb/bu.
    expect(bushelsFromKg(56120 - 20610, 50)).toBeCloseTo(1565.7, 1)
    expect(bushelsFromKg(61390 - 20810, 50)).toBeCloseTo(1789.3, 1)
    expect(bushelsFromKg(60330 - 20640, 50)).toBeCloseTo(1750.0, 1)
  })

  it('gives nothing for a load that weighs nothing or a crop with no bushel', () => {
    expect(bushelsFromKg(0, 50)).toBe(0)
    expect(bushelsFromKg(1000, 0)).toBe(0)
  })
})

describe('testWeightFor', () => {
  it('prefers the crop table, then the standard bushel by name', () => {
    expect(testWeightFor({ name: 'Canola', test_weight_lb_per_bu: '50' })).toBe(50)
    expect(testWeightFor({ name: 'Canola', test_weight_lb_per_bu: null })).toBe(50)
    expect(testWeightFor({ name: 'Durum Wheat', test_weight_lb_per_bu: null })).toBe(60)
    expect(testWeightFor({ name: 'Beans-Pinto', test_weight_lb_per_bu: null })).toBe(60)
    expect(testWeightFor({ name: 'Alfalfa Seed', test_weight_lb_per_bu: null })).toBeNull()
    expect(testWeightFor(null)).toBeNull()
  })
})

describe('half-weighed loads', () => {
  const load = (over: Partial<BinLoad>): BinLoad =>
    ({ id: 'x', bin_id: 'b', crop_id: 'c', variety: null, crop_year: 2026, field_id: null, loaded_on: '2026-09-24', gross_kg: 60000, tare_kg: 20000, net_kg: 40000, lb_per_bu: 50, bushels: 1763.7, truck: null, trailer: null, driver: null, driver_id: null, note: null, created_by: null, created_at: '', entry_kind: 'weighed', load_count: null, ...over }) as BinLoad

  it('is open until both weights are in', () => {
    expect(isOpenLoad(load({}))).toBe(false)
    expect(isOpenLoad(load({ tare_kg: null }))).toBe(true)
    expect(isOpenLoad(load({ gross_kg: null }))).toBe(true)
  })

  it('offers the last empty weight for the same truck and trailer', () => {
    const loads = [
      load({ truck: 'Kenworth', trailer: 'Super B #1', tare_kg: null }),
      load({ truck: 'Kenworth', trailer: 'Super B #1', tare_kg: 20560 }),
      load({ truck: 'Kenworth', trailer: null, tare_kg: 12000 }),
    ]
    expect(lastTare(loads, 'Kenworth', 'Super B #1')).toBe(20560)
    expect(lastTare(loads, 'Kenworth', null)).toBe(12000)
    expect(lastTare(loads, null, null)).toBe(null)
  })
})

describe('a field harvest so far', () => {
  const load = (over: Partial<BinLoad>): BinLoad =>
    ({ id: Math.random().toString(), bin_id: 'b', crop_id: 'c', variety: null, crop_year: 2026, field_id: 'moreau', loaded_on: '2026-09-24', gross_kg: 60000, tare_kg: 20000, net_kg: 40000, lb_per_bu: 50, bushels: 1000, truck: null, trailer: null, driver: null, driver_id: null, note: null, created_by: null, created_at: '', last_from_field: false, entry_kind: 'weighed', load_count: null, ...over }) as BinLoad

  it('counts only finished loads from the field and season, and finds the last one', () => {
    const loads = [
      load({ loaded_on: '2026-09-25', gross_kg: 50000, tare_kg: null, bushels: null }),
      load({ loaded_on: '2026-09-24', last_from_field: true, bushels: 206.4 }),
      load({ loaded_on: '2026-09-23', bushels: 1750 }),
      load({ field_id: 'other', bushels: 900 }),
      load({ crop_year: 2025, bushels: 800 }),
    ]
    const s = fieldHarvestSoFar(loads, 'moreau', 2026)
    expect(s.loads).toBe(2)
    expect(s.bushels).toBeCloseTo(1956.4)
    expect(s.last?.loaded_on).toBe('2026-09-24')
    expect(s.latest?.loaded_on).toBe('2026-09-24')
  })
  it('counts a load straight to a plant in the field, and says how much went that way', () => {
    const s = fieldHarvestSoFar(
      [load({ bin_id: null, delivery_site_id: 'viterra-taber', bushels: 881.8 }), load({ bushels: 1000 })],
      'moreau',
      2026,
    )
    expect(s.bushels).toBeCloseTo(1881.8)
    expect(s.toPlant).toBeCloseTo(881.8)
  })
})

describe('net and bin-total entries', () => {
  const load = (over: Partial<BinLoad>): BinLoad =>
    ({ id: 'x', bin_id: 'b', crop_id: 'c', variety: null, crop_year: 2026, field_id: null, loaded_on: '2026-09-24', gross_kg: 60000, tare_kg: 20000, net_kg: 40000, lb_per_bu: 50, bushels: 1763.7, truck: 'Kenworth', trailer: null, driver: null, driver_id: null, note: null, created_by: null, created_at: '', entry_kind: 'weighed', load_count: null, ...over }) as BinLoad

  it('never offers a net entry\'s stored 0 as the truck\'s empty weight', () => {
    const loads = [load({ entry_kind: 'net', gross_kg: 40000, tare_kg: 0 }), load({ tare_kg: 20560 })]
    expect(lastTare(loads, 'Kenworth', null)).toBe(20560)
  })
})
