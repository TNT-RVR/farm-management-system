import { describe, expect, it } from 'vitest'
import { fieldHarvestSoFar, bushelsFromKg, testWeightFor, isOpenLoad, lastTare, lastMoistureFor, loadInBin, type BinLoad } from './bin-loads'

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

describe('the moisture a new load starts at', () => {
  const test = (crop_id: string, tested_at: string, moisture_pct: number, crop_year = 2026) => ({ crop_id, crop_year, tested_at, moisture_pct })
  const load = (id: string, crop_id: string, loaded_on: string, moisture_pct: number | null, crop_year = 2026) => ({ id, crop_id, crop_year, loaded_on, moisture_pct })

  it("takes the crop's latest test this crop year", () => {
    // BASF canola, 9 Oct 2026: 7.3 dirty at 17:01, then 8.2 screened at 22:03.
    const tests = [
      test('basf', '2026-10-09T17:01:29+00:00', 7.3),
      test('basf', '2026-10-09T22:03:57+00:00', 8.2),
      test('beans', '2026-10-10T18:00:00+00:00', 14.1),
      test('basf', '2026-10-11T00:00:00+00:00', 9.9, 2025),
    ]
    expect(lastMoistureFor('basf', 2026, tests, [])).toEqual({ pct: 8.2, on: '2026-10-09T22:03:57+00:00', from: 'test' })
  })

  it('falls back to the last load of the crop with a moisture, not the one being edited', () => {
    const loads = [load('a', 'basf', '2026-10-10', 9.1), load('b', 'basf', '2026-10-09', null), load('c', 'basf', '2026-10-08', 10.4), load('d', 'basf', '2025-10-01', 7, 2025)]
    expect(lastMoistureFor('basf', 2026, [test('beans', '2026-10-10T18:00:00+00:00', 14.1)], loads)).toEqual({ pct: 9.1, on: '2026-10-10', from: 'load' })
    expect(lastMoistureFor('basf', 2026, [], loads, 'a')).toEqual({ pct: 10.4, on: '2026-10-08', from: 'load' })
  })

  it('gives nothing with no crop or no reading', () => {
    expect(lastMoistureFor('', 2026, [test('basf', '2026-10-09T22:03:57+00:00', 8.2)], [])).toBeNull()
    expect(lastMoistureFor('durum', 2026, [], [load('a', 'durum', '2026-10-01', null)])).toBeNull()
  })
})

describe('loadInBin', () => {
  // Sam, 20 Oct 2026: fill the first bin to its room, the rest in the second.
  const split = { bin_id: 'b1', overflow_bin_id: 'b2', first_bin_bu: 1000, bushels: 1763.7, net_kg: 40000 }
  it('the first bin took its room, the second the rest, kilograms in the same share', () => {
    expect(loadInBin(split, 'b1')).toEqual({ bushels: 1000, kg: (40000 * 1000) / 1763.7, part: 'first' })
    const rest = loadInBin(split, 'b2')
    expect(rest.part).toBe('rest')
    expect(rest.bushels).toBeCloseTo(763.7, 5)
    expect(rest.kg + loadInBin(split, 'b1').kg).toBeCloseTo(40000, 5)
  })
  it('a load less than the room it was given is all in the first bin', () => {
    expect(loadInBin({ ...split, bushels: 800, net_kg: 18144 }, 'b2').bushels).toBe(0)
    expect(loadInBin({ ...split, bushels: 800, net_kg: 18144 }, 'b1').bushels).toBe(800)
  })
  it('an unsplit load is all in its bin and none in any other', () => {
    const one = { bin_id: 'b1', overflow_bin_id: null, first_bin_bu: null, bushels: 1200, net_kg: 27216 }
    expect(loadInBin(one, 'b1')).toEqual({ bushels: 1200, kg: 27216, part: 'all' })
    expect(loadInBin(one, 'b2').part).toBe('none')
  })
})

describe('weigh times on the farm clock', () => {
  it('a time box and a timestamp go back and forth exactly (Alberta, summer and winter)', async () => {
    const { toTimeInput, fromTimeInput } = await import('./bin-loads')
    // 1:58 pm MDT on 22 Oct is 19:58 UTC; 9 am MST on 5 Jan 2026 is 16:00 UTC.
    // The winter case is before 1 Nov 2026, when Alberta stopped changing
    // clocks: newer time-zone data (2026c) puts later winters at UTC-6, older
    // data at UTC-7, so a later date passes or fails by machine.
    expect(toTimeInput('2026-10-22T19:58:00Z')).toBe('2026-10-22T13:58')
    expect(fromTimeInput('2026-10-22T13:58')).toBe('2026-10-22T19:58:00.000Z')
    expect(fromTimeInput('2026-01-05T09:00')).toBe('2026-01-05T16:00:00.000Z')
    expect(fromTimeInput('')).toBeNull()
  })
})
