import { describe, expect, it } from 'vitest'
import type { LandDeal } from '@/lib/land-deals'
import { bushelsInUnit, fieldHarvest, FIELD_HEAD, loadInUnit, massUnitOf, productionReport, shareOf, toTonnes, type HistoryRow, type LoadLite, type ProductionInput } from './afsc-production'
import { insurableAreas, type InsurableArea, type InsuranceContext } from './afsc'

const load = (over: Partial<LoadLite>): LoadLite => ({
  id: 'l1',
  field_id: 'f1',
  crop_id: 'canola',
  bin_id: 'b4',
  delivery_site_id: null,
  loaded_on: '2026-09-10',
  gross_kg: 30000,
  tare_kg: 15000,
  net_kg: 15000,
  bushels: 661.4,
  lb_per_bu: 50,
  last_from_field: false,
  ...over,
})

const hist = (over: Partial<HistoryRow>): HistoryRow => ({
  field_id: 'f1',
  crop_id: 'canola',
  acres: 100,
  yield_per_acre: 45,
  yield_unit: 'bu',
  actual_yield_total: 4500,
  source: 'scale',
  scale_acres: 100,
  scale_at: '2026-09-12T00:00:00Z',
  ...over,
})

const deal = (over: Partial<LandDeal>): LandDeal => ({
  landlord: 'Whitfield',
  arrangement: 'profit_share',
  field_ids: ['f2'],
  rent_per_acre: null,
  rent_total: null,
  our_share_pct: 50,
  crop_share_pct: null,
  inputs_shared: false,
  active: true,
  start_date: null,
  end_date: null,
  direction: 'in',
  ...over,
})

describe('units', () => {
  it('maps the crop’s yield units onto the converter’s', () => {
    expect(massUnitOf('bu')).toBe('bu')
    expect(massUnitOf('lbs')).toBe('lb')
    expect(massUnitOf('ton')).toBe('ston')
    expect(massUnitOf('MT')).toBe('t')
    expect(massUnitOf('ac')).toBeNull()
  })

  it('takes a bushel load as the scale worked it, and pounds or tons from the kilograms', () => {
    expect(loadInUnit({ net_kg: 15000, bushels: 661.4, lb_per_bu: 50 }, 'bu')).toBe(661.4)
    expect(loadInUnit({ net_kg: 1000, bushels: null, lb_per_bu: 60 }, 'lbs')).toBeCloseTo(2204.62, 1)
    expect(loadInUnit({ net_kg: 1000, bushels: null, lb_per_bu: 60 }, 'cwt')).toBeCloseTo(22.046, 2)
    expect(loadInUnit({ net_kg: 907.18474, bushels: null, lb_per_bu: 0 }, 'ton')).toBeCloseTo(1, 3)
    expect(loadInUnit({ net_kg: 1000, bushels: null, lb_per_bu: 0 }, 'MT')).toBeCloseTo(1, 6)
    // No bushel figure on the load: worked from the weight at the load's own bushel weight.
    expect(loadInUnit({ net_kg: 1000, bushels: null, lb_per_bu: 56 }, 'bu')).toBeCloseTo(39.37, 2)
    expect(loadInUnit({ net_kg: null, bushels: null, lb_per_bu: 56 }, 'lbs')).toBeNull()
  })

  it('turns production into tonnes at the crop’s bushel weight, and refuses a bushel without one', () => {
    expect(toTonnes(4500, 'bu', 50)).toBeCloseTo(102.06, 2)
    expect(toTonnes(2204.62262185, 'lbs', null)).toBeCloseTo(1, 6)
    expect(toTonnes(4500, 'bu', null)).toBeNull()
    expect(toTonnes(10, 'ac', 50)).toBeNull()
    expect(bushelsInUnit(100, 'lbs', 60)).toBe(6000)
    expect(bushelsInUnit(100, 'bu', 60)).toBe(100)
  })
})

describe('a field’s harvest', () => {
  it('declares crop history’s figure, finished on the last load’s day', () => {
    const h = fieldHarvest({ history: hist({}), loads: [load({}), load({ id: 'l2', loaded_on: '2026-09-12', last_from_field: true })], unit: 'bu', began: null })
    expect(h).toMatchObject({ status: 'harvested', production: 4500, acres: 100, yieldPerAcre: 45, completed: '2026-09-12', source: 'scale loads' })
  })

  it('never fills an unharvested field: no production, whatever the plan expects', () => {
    const h = fieldHarvest({ history: null, loads: [], unit: 'bu', began: null })
    expect(h.status).toBe('not_harvested')
    expect(h.production).toBeNull()
    expect(h.yieldPerAcre).toBeNull()
  })

  it('keeps a field still being weighed out of the declaration, with what is weighed so far', () => {
    const h = fieldHarvest({ history: null, loads: [load({}), load({ id: 'open', gross_kg: 30000, tare_kg: null })], unit: 'bu', began: { date: '2026-09-10', from: 'first load weighed' } })
    expect(h.status).toBe('under_way')
    expect(h.production).toBeNull()
    expect(h.soFar).toBeCloseTo(661.4)
    expect(h.loads).toBe(1)
  })

  it('a history row with no figure on it, after a harvest pass, is harvested but not recorded', () => {
    const h = fieldHarvest({ history: hist({ actual_yield_total: null, yield_per_acre: null }), loads: [], unit: 'bu', began: { date: '2026-09-01', from: 'John Deere' } })
    expect(h.status).toBe('no_production')
    expect(h.production).toBeNull()
  })
})

describe('shares', () => {
  it('a 50/50 field is half ours, a crop share what the owner leaves, cash rent all ours', () => {
    expect(shareOf(null)).toEqual({ fraction: 1, with: null, theirs: false })
    expect(shareOf(deal({}))).toEqual({ fraction: 0.5, with: 'Whitfield', theirs: false })
    expect(shareOf(deal({ arrangement: 'crop_share', crop_share_pct: 33 })).fraction).toBeCloseTo(0.67)
    expect(shareOf(deal({ arrangement: 'cash_rent' })).fraction).toBe(1)
    expect(shareOf(deal({ direction: 'out', landlord: 'Spud Co' }))).toEqual({ fraction: 0, with: 'Spud Co', theirs: true })
  })
})

describe('the report', () => {
  const field = (id: string, name: string) => ({ id, name, legal_land_description: `SE ${id}-11-13`, active: true })
  const area = (fieldId: string, name: string, crop: string, acres: number, irrigated: boolean): InsurableArea => ({
    area: { fieldId, cropId: crop, crop: crop === 'canola' ? 'Canola' : 'Potato', variety: null, acres, renters: false, seeded: true, zone: false, expectedYield: 999 },
    field: field(fieldId, name),
    irrigated,
    seeded: '2026-05-01',
  })
  const base: ProductionInput = {
    year: 2026,
    today: '2026-10-03',
    areas: [area('f1', '1', 'canola', 100, true), area('f2', 'Whitfield', 'canola', 80, true), area('f3', '3', 'canola', 60, false), area('f4', '4', 'potato', 40, true)],
    left: ['Field 9 (rented out to a local farmer)'],
    crops: [
      { id: 'canola', name: 'Canola', yield_unit: 'bu', test_weight_lb_per_bu: null, own_use: false },
      { id: 'potato', name: 'Potato', yield_unit: 'cwt', test_weight_lb_per_bu: null, own_use: false },
    ],
    history: [hist({}), hist({ field_id: 'f2', actual_yield_total: 4000, yield_per_acre: 50, acres: 80, scale_acres: 80 })],
    loads: [load({ last_from_field: true }), load({ id: 'l2', field_id: 'f2', bin_id: null, delivery_site_id: 's1', last_from_field: true, loaded_on: '2026-09-20' })],
    moves: [{ bin_id: 'b4', crop_id: 'canola', crop_year: 2026, movement_type: 'harvest_in', bushels: 4500, moved_at: '2026-09-10', ticket_number: 'load:l1' }],
    tickets: [],
    deals: [deal({}), deal({ direction: 'out', landlord: 'Spud Co', field_ids: ['f4'] })],
    began: new Map(),
    hailMarks: [],
    inspections: [{ inspection_number: '00100200', field_id: 'f3', land_location: '', crop_label: null, damage_date: '2026-07-07', report_date: null, loss_notice_date: null, adjuster: null, acres: 60, loss_pct: 17, bands: null, status: 'applied' }],
    binName: (id) => (id === 'b4' ? 'Bin 4' : null),
    siteName: (id) => (id === 's1' ? 'Viterra Taber' : null),
  }
  const r = productionReport(base)
  const section = (title: string) => r.sections.find((s) => s.title === title)!
  const col = (name: string) => FIELD_HEAD.indexOf(name)

  it('groups by crop and land, and leaves the grower’s potatoes off, named', () => {
    expect(r.sections.map((s) => s.title)).toEqual(['For the form', 'By crop', 'Where it went', 'Canola · dryland', 'Canola · irrigated', 'Not on this report'])
    expect(section('Not on this report').rows).toEqual([
      ['Field 9', 'rented out to a local farmer'],
      ['Potato on Field 4', 'Spud Co’s crop and inputs on our land'],
    ])
  })

  it('shows a 50/50 field whole, with no share columns', () => {
    const whitfield = section('Canola · irrigated').rows.find((row) => row[0] === 'Whitfield')!
    expect(whitfield[col('Production')]).toBe(4000)
    expect(FIELD_HEAD).not.toContain('Our share')
    expect(section('Canola · irrigated').foot?.[col('Production')]).toBe(8500)
  })

  it('a field not harvested says so and carries no production or yield', () => {
    const three = section('Canola · dryland').rows[0]
    expect(three[col('Status')]).toBe('Not harvested yet')
    expect(three[col('Production')]).toBeNull()
    expect(three[col('Yield/ac')]).toBeNull()
    expect(three[col('Hail or damage')]).toBe('Hail 2026-07-07: AFSC 00100200, 17% loss on 60 ac')
    // And the farm is not finished, so the completion date is left to fill in.
    expect(section('For the form').rows.find((x) => x[0] === 'Date harvest was completed')?.[1]).toBeNull()
  })

  it('says where each field’s loads went, and the crop’s grain in bins and sold', () => {
    const one = section('Canola · irrigated').rows.find((row) => row[0] === '1')!
    expect(one[col('Went to')]).toBe('Bin 4 (661 bu)')
    const canola = section('Where it went').rows[0]
    expect(canola.slice(0, 5)).toEqual(['Canola', 'bu', 8500, 661, 4500])
    expect(canola[6]).toBeNull() // fed: fill in
    expect(canola[7]).toBeNull() // grade: fill in
  })

  it('never fills the AFSC client or contract number', () => {
    const lines = section('For the form').rows
    expect(lines.find((x) => x[0] === 'AFSC client number')?.[1]).toBeNull()
    expect(lines.find((x) => x[0] === 'Contract or policy number')?.[1]).toBeNull()
  })
})

describe('whose report a field is on', () => {
  const f = (id: string, name: string) => ({ id, name, legal_land_description: null, active: true })
  const a = (fieldId: string, cropId: string, crop: string) => ({ fieldId, cropId, crop, variety: null, acres: 100, renters: false, seeded: true, zone: false, expectedYield: null })
  const basics = {
    fields: [f('own', 'Home'), f('st1', 'Moreaus NE'), f('st2', 'Moreau W'), f('hd', 'Whitfield'), f('es', 'Field 2')],
    areas: [a('own', 'corn', 'Grain Corn'), a('st1', 'basf', 'BASF Canola'), a('st2', 'corteva', 'Corteva Canola'), a('hd', 'corn', 'Grain Corn'), a('es', 'potato', 'Potato')],
    irrigated: new Set<string>(),
    seeded: new Map(),
    rentedOut: new Map<string, string>(),
  }
  const ins = (party: string): InsuranceContext => ({
    year: 2026,
    party,
    uninsured: new Set(['corteva']),
    deals: [
      deal({ landlord: 'Moreau', field_ids: ['st1', 'st2'] }),
      deal({ landlord: 'Whitfield', field_ids: ['hd'] }),
      deal({ landlord: 'Ehren Schutter', field_ids: ['es'], direction: 'out' }),
    ],
  })
  const names = (party: string) => insurableAreas(basics, ins(party)).kept.map((k) => k.field.name)

  it('the farm’s own report leaves each joint venture to its own report', () => {
    const r = insurableAreas(basics, ins(''))
    expect(r.kept.map((k) => k.field.name)).toEqual(['Home'])
    expect(r.left).toContain('BASF Canola on Moreaus NE (the joint venture with Moreau: its own report)')
    expect(r.left).toContain('Potato on Field 2 (Ehren Schutter’s crop and inputs on our land)')
  })

  it('a joint venture’s report holds its own fields, whole', () => {
    expect(names('Moreau')).toEqual(['Moreaus NE'])
    expect(names('Whitfield')).toEqual(['Whitfield'])
  })

  it('a crop insured through its contract is on no AFSC report', () => {
    const r = insurableAreas(basics, ins('Moreau'))
    expect(r.kept.map((k) => k.area.cropId)).not.toContain('corteva')
    expect(r.left).toEqual(['Corteva Canola on Moreau W (insured through its contract, not AFSC)'])
  })
})
