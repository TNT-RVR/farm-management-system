import { describe, expect, it } from 'vitest'
import type { ManureApplication } from '@/lib/manure-credit'
import { manureRows } from './manure'
import { binLines, inventoryGroups, priceFor, unitsPerBushel, type InvCrop } from './grain-inventory'
import { deliveryGroups, type DContract, type DLoad, type DTicket } from './deliveries'
import { localStamp, moistureGroups, type MCrop, type MTest } from './moisture-log'
import { aerationGroups } from './aeration'

describe('manure applications', () => {
  const app: ManureApplication = { id: 'm1', field_id: 'f1', crop_year: 2026, applied_on: '2026-04-21', source: 'solid_beef', rate_tons_per_acre: 15.2, n_lb_ton: null, p2o5_lb_ton: null, k2o_lb_ton: null, incorporated: true, incorporated_days: 1, manure_type: 'fresh_pen', geojson: null as never, acres: 60.62, notes: null, created_at: '' }

  it('takes tonnes and cost off the hauler’s invoice and values the first-year credit', () => {
    const r = manureRows(
      [app, { ...app, id: 'm2', applied_on: '2026-04-23', field_id: 'f2', acres: 10, rate_tons_per_acre: 10 }],
      [{ manure_application_id: 'm1', field_id: 'f1', hauler: 'N & K Custom Ltd. (Coalhurst AB)', invoice_no: '1160', work_date: '2026-04-21', amount: '4095.00', tonnes: '922.90', loads: 55 }],
      null,
      { n: 1, p2o5: 1, k2o: 1 },
      (id) => (id === 'f1' ? '1' : 'Two'),
    )
    const [one, two] = r.rows
    expect(one.slice(0, 5)).toEqual(['2026-04-21', 'Field 1', 60.62, 15.2, 922.9])
    expect(one[5]).toBe('12-9-14 (Alberta typical)')
    // 182.4 lb N a ton-acre: 10% ammonium less a quarter lost in a day, a quarter of the rest.
    expect(Number(one[6])).toBeCloseTo(182.4 * (0.1 * 0.75 + 0.9 * 0.25), 1)
    expect(Number(one[11])).toBeCloseTo(4095 / 922.9, 3)
    expect(one[12]).toBe('N & K Custom Ltd. #1160')
    // No invoice: the rate over the acres, and no cost.
    expect(two[4]).toBe(100)
    expect(two[10]).toBeNull()
    expect(r.cost).toBe(4095)
    expect(r.unpriced).toBe(false)
  })
})

describe('grain inventory', () => {
  const crops: InvCrop[] = [
    { id: 'canola', name: 'BASF Canola', yield_unit: 'bu', test_weight_lb_per_bu: '50' },
    { id: 'beans', name: 'Beans-Pinto', yield_unit: 'lbs', test_weight_lb_per_bu: '60' },
    { id: 'durum', name: 'Durum Wheat', yield_unit: 'bu', test_weight_lb_per_bu: '60' },
  ]
  const bins = [
    { id: 'b21', name: 'Main Yard - #21', site: 'Main Yard', capacity_bu: '5800', active: true },
    { id: 'b2', name: 'Main Yard - #2', site: 'Main Yard', capacity_bu: '4000', active: true },
    { id: 'b24', name: 'Main Yard #24', site: 'Main Yard', capacity_bu: '4500', active: true },
  ]

  it('runs the ledger to the day and adds the carry-over the ledger never saw', () => {
    const lines = binLines(
      [
        { bin_id: 'b21', crop_id: 'canola', crop_year: 2026, movement_type: 'harvest_in', bushels: '1565.72', moved_at: '2026-09-21' },
        { bin_id: 'b21', crop_id: 'canola', crop_year: 2026, movement_type: 'harvest_in', bushels: '1789.27', moved_at: '2026-09-22' },
        { bin_id: 'b21', crop_id: 'canola', crop_year: 2026, movement_type: 'delivery_out', bushels: '500', moved_at: '2026-09-23' },
        { bin_id: 'b24', crop_id: 'beans', crop_year: 2026, movement_type: 'harvest_in', bushels: '1812.38', moved_at: '2026-09-24' },
      ],
      [
        { bin_id: 'b2', crop_id: 'durum', crop_year: 2025, bushels: null, note: 'Left over from 2025', filled_on: null, emptied_on: null },
        { bin_id: 'b24', crop_id: 'beans', crop_year: 2026, bushels: '1800', note: null, filled_on: null, emptied_on: null },
        { bin_id: 'b21', crop_id: 'durum', crop_year: 2025, bushels: '100', note: null, filled_on: null, emptied_on: '2026-08-01' },
      ],
      '2026-09-22',
    )
    expect(lines).toEqual([
      { binId: 'b21', cropId: 'canola', cropYear: 2026, bu: 1565.72 + 1789.27, note: null },
      { binId: 'b2', cropId: 'durum', cropYear: 2025, bu: null, note: 'Left over from 2025' },
      { binId: 'b24', cropId: 'beans', cropYear: 2026, bu: 1800, note: null },
    ])
  })

  it('prices off the newest quote in the crop’s unit, else the plan', () => {
    expect(unitsPerBushel('lbs', 60)).toBe(60)
    expect(unitsPerBushel('cwt', 60)).toBe(0.6)
    expect(unitsPerBushel('bu', null)).toBe(1)
    const quotes = [
      { crop_id: 'durum', series: 'Durum — CWB', unit: '$/tonne', value: 250, on: '2012-07-01' },
      { crop_id: 'durum', series: 'Durum — Alberta farm gate', unit: '$/tonne', value: 297.6, on: '2026-07-01' },
    ]
    const durum = priceFor(crops[2], 2025, quotes, [])
    expect(durum?.from).toBe('Durum — Alberta farm gate, 2026-07-01')
    // $297.60 a tonne at 60 lb a bushel.
    expect(durum?.price).toBeCloseTo((297.6 * 60) / 2204.62262, 4)
    expect(priceFor(crops[1], 2026, quotes, [{ crop_id: 'beans', crop_year: 2025, price_per_unit: '0.4' }, { crop_id: 'beans', crop_year: 2026, price_per_unit: '0.47' }])).toEqual({ price: 0.47, per: 'lbs', from: 'crop plan price, 2026' })
  })

  it('groups by crop and values beans by the pound', () => {
    const r = inventoryGroups(
      [
        { binId: 'b24', cropId: 'beans', cropYear: 2026, bu: 1000, note: null },
        { binId: 'b2', cropId: 'durum', cropYear: 2025, bu: null, note: 'not measured' },
      ],
      bins,
      crops,
      [],
      [{ crop_id: 'beans', crop_year: 2026, price_per_unit: '0.47' }],
    )
    expect(r.groups.map((g) => g.title)).toEqual(['Beans-Pinto', 'Durum Wheat'])
    const beans = r.groups[0].rows[0]
    expect(beans[3]).toBe(1000)
    expect(Number(beans[4])).toBeCloseTo(27.2, 1)
    expect(beans[8]).toBeCloseTo(1000 * 60 * 0.47)
    expect(r.unmeasured).toBe(1)
    expect(r.groups[1].rows[0][9]).toBe('not measured')
  })
})

describe('deliveries', () => {
  const names = {
    crop: (id: string | null) => (id === 'beans' ? { id: 'beans', name: 'Beans-Pinto', yield_unit: 'lbs' } : id === 'canola' ? { id: 'canola', name: 'Canola', yield_unit: 'bu' } : null),
    field: () => '5/Creek Flat',
    bin: () => '#21',
    site: () => 'Viterra Taber',
    buyer: (id: string | null) => (id === 'c1' ? 'Cargill' : null),
  }
  const load: DLoad = { id: 'l1', crop_id: 'beans', field_id: 'f', contract_id: null, delivery_site_id: 's', loaded_on: '2026-09-24', net_kg: '39865', bushels: '1464.8', moisture_pct: null, protein_pct: null, note: null }
  const ticket: DTicket = { id: 't1', crop_id: 'canola', contract_id: 'k1', bin_id: 'b', buyer: 'Cargill Lethbridge', ticket_no: '5091', delivered_on: '2026-09-30', net_lb: '88000', moisture_pct: '8.5', dockage_pct: '1.2', protein_pct: null, net_units: null, unit: null, bin_load_id: 'l2', notes: null }
  const contract: DContract = { id: 'k1', crop_id: 'canola', buyer_contact_id: 'c1', contract_number: 'C-44', bushels: '10000', price_per_unit: '14.5', delivery_start: '2026-09-01', delivery_end: '2026-12-31', delivered_bu: '1760', status: 'partial' }

  it('puts each load under its buyer and contract, a matched ticket counted once', () => {
    const r = deliveryGroups({ tickets: [ticket], loads: [load, { ...load, id: 'l2', crop_id: 'canola' }], moves: [], contracts: [contract, { ...contract, id: 'k2', contract_number: 'C-45', delivered_bu: null }] }, names)
    expect(r.groups.map((g) => g.title)).toEqual(['Cargill · contract C-44', 'Cargill · contract C-45', 'Viterra Taber'])
    expect(r.loads).toBe(2)
    const c44 = r.groups[0]
    // 88,000 lb of canola at 50 lb a bushel.
    expect(c44.rows[0][4]).toBe(1760)
    expect(c44.note).toBe('Canola · 10,000 bu at $14.5/bu · window 2026-09-01 to 2026-12-31 · 1,760 delivered · 8,240 left to haul · partial')
    expect(r.groups[1].rows).toEqual([])
    expect(r.groups[1].note).toContain('10,000 left to haul')
    // Beans are pounds: the load's kilograms, not its bushels.
    expect(Number(r.groups[2].rows[0][4])).toBeCloseTo(39865 * 2.20462262, 0)
    expect(r.groups[2].totals?.[5]).toBe('lb')
  })
})

describe('moisture and bin condition', () => {
  const crops: MCrop[] = [{ id: 'beans', name: 'Beans-Pinto', moisture_dry_min: '14', moisture_dry_max: '15.5', moisture_tough_max: '15.5', moisture_damp_max: null, moisture_moist_max: null }]
  const test: MTest = { tested_at: '2026-09-21T20:51:18Z', field_id: 'f', crop_id: 'beans', bin_id: 'b25', temperature_c: '27', meter_reading: '40', chart_key: 'pintobeans2', moisture_pct: '14.2', grade: 'dry', entered_by_hand: false, note: 'West Half', created_by: 'u', sample_condition: null }

  it('logs each test in the farm’s time with its grade’s band for the crop', () => {
    expect(localStamp('2026-09-21T20:51:18Z', 'America/Edmonton')).toEqual({ date: '2026-09-21', time: '14:51' })
    const r = moistureGroups([test, { ...test, tested_at: '2026-09-24T19:52:48Z', moisture_pct: '13.9', grade: 'too_dry', bin_id: null }], crops, { field: () => '5/Creek Flat', bin: (id) => (id ? '#25' : null), person: () => 'Sam' }, 'America/Edmonton')
    expect(r.groups[0].title).toBe('Beans-Pinto')
    const [a, b] = r.groups[0].rows
    expect(a.slice(0, 6)).toEqual(['2026-09-21', '14:51', '5/Creek Flat', '#25', 14.2, 27])
    expect(a.slice(8, 10)).toEqual(['dry', '14.0 to 15.5'])
    expect(b.slice(8, 10)).toEqual(['too dry', 'below 14.0'])
    expect(r.needAir).toBe(0)
    expect(r.groups[0].note).toBe('2 tests · average 14.1%, 13.9–14.2%')
  })

  it('flags a level heating since the last cable reading and closes out alerts', () => {
    const lv = (t: number) => [{ level: 1, temp_c: t, rh_pct: 60, moisture_pct: 7.5, moisture_from: 'table' as const }, { level: 2, temp_c: 10, rh_pct: 60, moisture_pct: 7.8, moisture_from: 'table' as const }]
    const r = aerationGroups(
      {
        readings: [
          { bin_id: 'b21', crop_id: 'canola', read_on: '2026-09-25', initials: 'TT', levels: lv(12), notes: null },
          { bin_id: 'b21', crop_id: 'canola', read_on: '2026-10-01', initials: 'TT', levels: lv(16), notes: null },
        ],
        probes: [],
        tests: [],
        alerts: [{ bin_id: null, field_id: 'f6', crop_id: 'beans', moisture_pct: '13.9', grade: 'too_dry', raised_at: '2026-09-24T19:52:48Z', dismissed_at: '2026-09-28T14:58:45Z', dismissed_note: 'Dismissed without air' }],
      },
      [{ id: 'canola', name: 'Canola', moisture_dry_max: '10' }],
      { bin: () => 'Main Yard - #21', field: () => '6/Kellers' },
      'America/Edmonton',
    )
    expect(r.groups.map((g) => g.title)).toEqual(['Main Yard - #21', 'No bin — grain off 6/Kellers'])
    const [first, second] = r.groups[0].rows
    expect(first.slice(3, 7)).toEqual([10, 12, 7.8, 'nothing flagged'])
    expect(String(second[6])).toContain('L1 up 4.0 °C since the last reading')
    expect(second[7]).toBe('air on to cool it')
    expect(r.groups[1].rows[0][7]).toBe('closed 2026-09-28: Dismissed without air')
    expect(r.flagged).toBe(1)
  })
})
