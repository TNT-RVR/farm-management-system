import { describe, expect, it } from 'vitest'
import type { FieldOperation } from '@/lib/fieldOps'
import type { IciLine } from '@/lib/ici-review'
import type { ManureApplication } from '@/lib/manure-credit'
import { productResolver } from '@/lib/spray-products'
import { cropAreas, harvestDates, seedingDates, type SeasonCrop } from './field-season'
import { acreageGroups } from './afsc'
import { blendKey, fieldFertility, type FertilityData } from './nutrients'
import { balanceGroup, latestSoilTests, mainArea } from './nutrient-balance'
import { seasonGroup } from './season'
import { bandText, hailGroups, type Inspection } from './hail'
import { clearanceRow, clearFrom, uniqueNames } from './clearance'
import { labelGroup, labelHazards, storageRows } from './whmis'
import type { StockLine } from '@/lib/chem-inventory'

const crops: SeasonCrop[] = [
  { id: 'corn', name: 'Grain Corn', yield_unit: 'bu', default_yield_per_acre: '140', renter_only: false, land_rent_only: false, counts_for_seeding: true },
  { id: 'potato', name: 'Potato-Fresh Pack', yield_unit: 'cwt', default_yield_per_acre: '300', renter_only: true, land_rent_only: false, counts_for_seeding: false },
  { id: 'fallow', name: 'Summer Fallow', yield_unit: 'bu', default_yield_per_acre: null, renter_only: false, land_rent_only: false, counts_for_seeding: false },
  { id: 'canola', name: 'BASF Canola', yield_unit: 'bu', default_yield_per_acre: '40', renter_only: false, land_rent_only: false, counts_for_seeding: true },
]
const plan = (field: string, crop: string, acres: number, variety: string | null = null) => ({ id: `p-${field}`, field_id: field, crop_id: crop, crop_year: 2026, variety, planned_acres: acres, yield_per_acre_override: null })

describe('field season basics', () => {
  it('splits a field into its crop areas, the plan’s variety staying on the plan’s crop', () => {
    const areas = cropAreas(
      [plan('whitfield', 'corn', 161, 'P0157'), plan('home', 'canola', 110, 'Specialty - BASF')],
      [
        { id: 'z1', field_id: 'whitfield', crop_year: 2026, crop_id: 'potato', acres: '130' },
        { id: 'z2', field_id: 'whitfield', crop_year: 2026, crop_id: 'corn', acres: '31.37' },
      ],
      crops,
      2026,
    )
    expect(areas.map((a) => [a.fieldId, a.crop, a.variety, a.acres, a.renters, a.zone])).toEqual([
      ['whitfield', 'Potato-Fresh Pack', null, 130, true, true],
      ['whitfield', 'Grain Corn', 'P0157', 31.37, false, true],
      ['home', 'BASF Canola', 'Specialty - BASF', 110, false, false],
    ])
    expect(areas[2].expectedYield).toBe(40)
  })

  it('takes the season’s planting date over Deere’s first pass, and Deere where there is no season', () => {
    const seeded = seedingDates(
      [{ field_id: 'f1', zone_id: null, planting_date: '2026-05-25', planting_date_source: 'manual', harvest_date: null }],
      [
        { field_id: 'f1', operation_type: 'seeding', started_at: '2026-04-30T16:16:58Z' },
        // 03:51 UTC on the 9th is the evening of the 8th in Alberta.
        { field_id: 'f2', operation_type: 'seeding', started_at: '2026-05-09T03:51:53Z' },
        { field_id: 'f2', operation_type: 'seeding', started_at: '2026-05-12T18:00:00Z' },
      ],
    )
    expect(seeded.get('f1')).toEqual({ date: '2026-05-25', from: 'entered by hand' })
    expect(seeded.get('f2')).toEqual({ date: '2026-05-08', from: 'John Deere' })
  })

  it('starts harvest at the first Deere pass or the first load, whichever came first', () => {
    const h = harvestDates([], [{ field_id: 'f1', operation_type: 'harvest', started_at: '2026-09-21T18:00:00Z' }], [{ field_id: 'f1', loaded_on: '2026-09-20' }, { field_id: 'f2', loaded_on: '2026-09-24' }])
    expect(h.get('f1')).toEqual({ date: '2026-09-20', from: 'first load weighed' })
    expect(h.get('f2')?.date).toBe('2026-09-24')
  })
})

describe('seeded acreage for AFSC', () => {
  const fields = [
    { id: 'whitfield', name: 'Whitfield SE 12-70-13', legal_land_description: 'SE 12-70-13', active: true },
    { id: 'home', name: 'Home', legal_land_description: 'NW-35-70-16-W4', active: true },
    { id: '3', name: '3', legal_land_description: 'NW-18-71-13-W4', active: true },
    { id: 'old', name: 'Carlson’s', legal_land_description: null, active: false },
  ]
  it('totals our crops by crop and names what it leaves out', () => {
    const areas = cropAreas(
      [plan('whitfield', 'corn', 161), plan('home', 'canola', 110.31), plan('3', 'corn', 131), plan('old', 'fallow', 128)],
      [
        { id: 'z1', field_id: 'whitfield', crop_year: 2026, crop_id: 'potato', acres: 130 },
        { id: 'z2', field_id: 'whitfield', crop_year: 2026, crop_id: 'corn', acres: 31.37 },
      ],
      crops,
      2026,
    )
    const r = acreageGroups({
      fields,
      areas,
      irrigated: new Set(['whitfield']),
      seeded: new Map([['whitfield', { date: '2026-05-08', from: 'John Deere' }]]),
      rentedOut: new Map([['3', 'a local farmer']]),
    })
    expect(r.groups.map((g) => g.title)).toEqual(['BASF Canola', 'Grain Corn'])
    expect(r.groups[1].rows).toEqual([[null, 'Whitfield SE 12-70-13', 'SE 12-70-13', 31.37, '2026-05-08', 'Irrigated']])
    expect(r.groups[0].totals?.[3]).toBeCloseTo(110.31)
    expect(r.acres).toBeCloseTo(141.68)
    expect(r.irrigatedAcres).toBeCloseTo(31.37)
    expect(r.noDate).toBe(1)
    expect(r.left).toEqual(['Potato-Fresh Pack on Whitfield SE 12-70-13 (the renter’s crop)', 'Field 3 (rented out to a local farmer)'])
  })
})

describe('fertility from every source', () => {
  const op = (products: unknown, day = '2026-04-22T16:00:00Z'): FieldOperation => ({ id: `o${day}`, field_id: 'f1', started_at: day, products }) as unknown as FieldOperation
  const ici = (over: Partial<IciLine>): IciLine => ({
    id: 'l', invoice_no: 'INV', invoice_date: '2026-04-22', ref_no: '', kind: 'blend', description: 'Tonne 18.2-11.4-6.8-4.5 Blend', quantity: 25.8, unit: 'Metric', amount: 20000, field_id: 'f1', field_text: null, crop_text: null, rate_lb_ac: 437.69, ticket_acres: 130, cost_per_ac: null, target: { N: 80, P: 50, K: 30, S: 20 }, ...over,
  })
  const manure: ManureApplication = { id: 'm', field_id: 'f1', crop_year: 2026, applied_on: '2026-04-21', source: 'solid_beef', rate_tons_per_acre: 15.2, n_lb_ton: null, p2o5_lb_ton: null, k2o_lb_ton: null, incorporated: true, incorporated_days: null, manure_type: null, geojson: null as never, acres: 60.62, notes: null, created_at: '' }

  it('counts a blend both the floater’s monitor and the ICI ticket logged once, as the machine’s', () => {
    expect(blendKey('Tonne 18.2-11.4-6.8-4.5 Blend')).toBe(blendKey('18.2-11.4-6.8-4.5  blend'))
    const d: FertilityData = { ops: [op([{ name: 'Tonne 18.2-11.4-6.8-4.5 Blend', rate: { value: 437.87, unitId: 'lb1ac-1' }, productType: 'FERTILIZER' }])], ici: [ici({})], manure: [], farm: null }
    const f = fieldFertility('f1', 2026, d, 133)
    expect(f.lines).toHaveLength(1)
    expect(f.lines[0].source).toBe('machine')
    expect(f.lines[0].note).toContain('also on the ICI ticket')
    expect(f.total.n).toBeCloseTo(79.7, 1)
  })

  it('scales a retailer blend by its acres, and manure by the share of the field it covered', () => {
    const d: FertilityData = { ops: [], ici: [ici({ ticket_acres: 100 }), ici({ id: 'l2', description: 'Tonne 0-0-60 Blend', ticket_acres: 50, target: { K: 60 } })], manure: [manure], farm: null }
    const f = fieldFertility('f1', 2026, d, 121.24)
    expect(f.bySource.retailer.n).toBe(80)
    expect(f.bySource.retailer.k2o).toBe(30 + 30)
    // Half the field spread: half the credit as a field average.
    const m = f.lines.find((l) => l.source === 'manure')!
    expect(m.note).toContain('on 50% of the field')
    expect(f.bySource.manure.p2o5).toBeCloseTo((15.2 * 9 * 0.5) / 2, 1)
  })

  it('draws the balance against the crop’s removal at its yield', () => {
    const areas = cropAreas([plan('f1', 'canola', 140)], [], crops, 2026)
    expect(mainArea(areas)?.crop).toBe('BASF Canola')
    const d: FertilityData = { ops: [], ici: [ici({})], manure: [], farm: null }
    const g = balanceGroup({
      fieldId: 'f1',
      year: 2026,
      areas,
      crops,
      fieldAcres: 140,
      history: [{ field_id: 'f1', crop_id: 'canola', acres: 140, yield_per_acre: '40.7', yield_unit: 'bu', source: 'scale' }],
      soil: { year: 2026, lab: 'WPG', no3nLbAc: 42, olsenP: 12, kPpm: 180, so4sTop: 9 },
      fertility: d,
    })
    const n = g.rows[0]
    expect(n.slice(0, 2)).toEqual(['N', '42 lb/ac nitrate-N'])
    // 40.7 bu × 1.68 lb N = 68 removed; 80 on.
    expect(n.slice(5)).toEqual([80, 68, 12])
    expect(g.expected).toBe(false)
    expect(g.note).toContain('yield 40.7 bu/ac')
  })

  it('reads the newest soil test, pooling a field sampled in halves', () => {
    const s = latestSoilTests(
      [
        { id: 'a', field_id: 'f1', crop_year: 2025, report_date: null, lab: 'Old' },
        { id: 'b', field_id: 'f1', crop_year: 2026, report_date: null, lab: 'WPG' },
        { id: 'c', field_id: 'f1', crop_year: 2026, report_date: null, lab: 'WPG' },
        { id: 'd', field_id: 'f1', crop_year: 2027, report_date: null, lab: 'Future' },
      ],
      [
        { report_id: 'a', sample_code: '1A', depth_top_in: 0, no3n_lb_ac: 99, p_bicarb_ppm: 99, k_ppm: 99, so4s_ppm: 99 },
        { report_id: 'b', sample_code: '1A', depth_top_in: 0, no3n_lb_ac: '20' as never, p_bicarb_ppm: 10, k_ppm: 100, so4s_ppm: 8 },
        { report_id: 'b', sample_code: '1B', depth_top_in: 6, no3n_lb_ac: 30, p_bicarb_ppm: null, k_ppm: null, so4s_ppm: 20 },
        { report_id: 'c', sample_code: '2A', depth_top_in: 0, no3n_lb_ac: 10, p_bicarb_ppm: 20, k_ppm: 200, so4s_ppm: 12 },
      ],
      2026,
    ).get('f1')!
    expect(s.year).toBe(2026)
    // Site 1 is 20 + 30 over the profile, site 2 is 10: an average of 30.
    expect(s.no3nLbAc).toBe(30)
    expect(s.olsenP).toBe(15)
    expect(s.so4sTop).toBe(10)
  })
})

describe('field season summary', () => {
  it('lists sprays and fertility in date order, a fertilizer in the tank once, as fertility', () => {
    const resolve = productResolver([{ id: 'p1', name: 'Liberty 150 SN', pmra_registration: '33213' }], [])
    const sprayOp = {
      id: 's1',
      field_id: 'f1',
      jd_id: 'jd1',
      started_at: '2026-06-20T18:00:00Z',
      operator_name: 'Peter',
      treated_crop: 'CANOLA',
      applied_area_ha: 40,
      products: [{ name: 'Tank', tankMix: true, components: [{ name: 'Liberty 150 SN', productType: 'CHEMICAL', rate: { value: 1.35, unitId: 'l1ac-1' } }, { name: 'UAN 28-0-0', productType: 'FERTILIZER', rate: { value: 1.5, unitId: 'l1ac-1' } }] }],
    }
    const g = seasonGroup({
      fieldId: 'f1',
      year: 2026,
      areas: cropAreas([plan('f1', 'canola', 100, 'InVigor')], [], crops, 2026),
      crops,
      fieldAcres: 100,
      irrigated: true,
      seeded: { date: '2026-05-10', from: 'John Deere' },
      harvested: null,
      history: [],
      sprays: [sprayOp],
      resolve,
      fertility: { ops: [sprayOp as unknown as FieldOperation], ici: [], manure: [], farm: null },
      irrigation: [{ date: '2026-07-01', gross_mm: 25.4, net_mm: null }, { date: '2026-07-04', gross_mm: '25.4', net_mm: null }],
      balance: [],
      hail: [{ event_date: '2026-07-25', notes: null }],
    })
    expect(g.rows.map((r) => [r[0], r[1], r[2]])).toEqual([
      ['2026-05-10', 'Seeded', 'BASF Canola, InVigor'],
      ['2026-06-20', 'Sprayed', 'Liberty 150 SN'],
      ['2026-06-20', 'Fertilizer', 'UAN 28-0-0'],
      ['2026-07-25', 'Hail', 'marked on the field'],
      [null, 'Irrigation', '2 days watered, 2026-07-01 to 2026-07-04'],
    ])
    expect(g.rows[1][3]).toBe('33213')
    expect(g.rows[4][6]).toBe('2 in')
    expect(g.sprayLines).toBe(1)
    expect(g.note).toContain('irrigated · seeded 2026-05-10')
  })
})

describe('hail damage record', () => {
  const insp: Inspection = { inspection_number: '00100200', field_id: 'f1', land_location: 'SE-10-71-13-W4M', crop_label: 'Beans, Dry - Pinto', damage_date: '2026-07-07', report_date: '2026-08-07', loss_notice_date: '2026-07-10', adjuster: 'Pat Adjuster', acres: '125', loss_pct: '17', bands: [{ band: 'Under 10%', acres: null, lossPct: null }, { band: '10% - 70%', acres: 125, lossPct: 17 }], status: 'applied' }

  it('keeps an inspection and the mark it left as one row, and lists marks nobody inspected', () => {
    const r = hailGroups(
      [
        { field_id: 'f1', event_date: '2026-07-07', notes: 'AFSC inspection 00100200' },
        { field_id: 'f1', event_date: '2026-08-11', notes: null },
      ],
      [insp, { ...insp, inspection_number: 'x', field_id: null, status: 'pending', damage_date: '2026-08-01' }, { ...insp, inspection_number: 'gone', status: 'rejected' }],
      (id) => (id === 'f1' ? '6/Kellers' : null),
      () => 'Beans-Pinto',
    )
    expect(r.groups.map((g) => g.title)).toEqual(['6/Kellers', 'Not placed on a field yet'])
    expect(r.groups[0].rows).toHaveLength(2)
    expect(r.groups[0].rows[0].slice(2, 8)).toEqual(['00100200', 'Pat Adjuster', 125, 17, 21.25, '10% - 70%: 125 ac at 17%'])
    expect(r.groups[1].rows[0][9]).toContain('waiting to be checked')
    expect(r.marked).toBe(1)
    expect(bandText(null)).toBeNull()
  })
})

describe('PHI and grazing clearance', () => {
  it('names a product once however Deere spelt it', () => {
    expect(uniqueNames(['Delaro® Complete', 'Delaro Complete', 'excel 70'])).toEqual(['Delaro Complete', 'excel 70'])
  })

  it('gives the safe harvest day, the spray behind it, the unknowns and the grazing date', () => {
    const graze = { kind: 'graze' as const, product: 'Prestige', registration: '1', appliedOn: '2026-07-15', sourceId: 's', days: 7, never: false, until: '2026-07-22', crop: null, condition: null, quote: null, assumed: null, eatenBecause: [] }
    const row = clearanceRow(
      'f1',
      'Green Feed',
      [
        { fieldId: 'f1', product: 'Prestige', appliedOn: '2026-07-15', phiDays: 60 },
        { fieldId: 'f1', product: 'Mystery', appliedOn: '2026-07-20', phiDays: null },
        { fieldId: 'f2', product: 'Other', appliedOn: '2026-08-01', phiDays: 1 },
      ],
      '2026-09-01',
      { kind: 'field', id: 'f1', name: 'F1', sprays: [], restrictions: [graze, { ...graze, kind: 'feed', never: true, until: '2027-05-01' }], eaten: [], inPastures: [] },
      [],
    )
    expect(row).toEqual(['Green Feed', '2026-07-20', 'Mystery', null, '2026-09-13', 'Prestige, 15 Jul 2026', '2026-09-01', 'Mystery', '2026-07-22', 'spring 2027 (not this crop at all)', 'harvest began 12 days inside the PHI'])
    expect(clearFrom([], 'graze')).toBeNull()
  })
})

describe('chemical storage list', () => {
  it('reads the signal word and warnings off the principal panel only', () => {
    expect(labelHazards('Excel 70 DANGER: CAUSES SKIN AND EYE IRRITATION KEEP OUT OF REACH OF CHILDREN WARNING: Contains the allergen soy. PRECAUTIONS Call a poison control centre')).toBe(
      'Danger: causes skin and eye irritation',
    )
    expect(labelHazards('CENTURION Warning, contains allergen soy REGISTRATION NO. 34836 WARNING: EYE and SKIN IRRITANT KEEP OUT OF REACH OF CHILDREN')).toBe('Warning: eye and skin irritant')
    expect(labelHazards('29012 PEST CONTROL PRODUCTS ACT CAUTION\nPOISON Net Contents')).toBe('Caution poison')
    expect(labelHazards('BASAGRAN WARNING CORROSIVE TO EYES SKIN SENSITIZER')).toBe('Warning; corrosive; skin sensitizer')
    // A fungicide with no signal word: "poisoning" in the emergency line is not one.
    expect(labelHazards('PROLINE GOLD In case of spills, poisoning or fire, call 1-800 GROUP 7 3 FUNGICIDE NOTICE TO USER: use caution')).toBeNull()
    expect(labelGroup('GROUP 4 HERBICIDE ESTEEM')).toBe('4 herbicide')
  })

  it('lists the chemicals with stock, with their registry and label details', () => {
    const line = (id: string, onHand: number, category = 'chemical'): StockLine => ({ product: { id, name: id.toUpperCase(), unit: 'L', category }, bought: onHand, used: 0, adjusted: 0, onHand, countedOn: null, lastBought: '2026-04-01', packSize: 10, packUnit: 'Jug', entries: [] })
    const r = storageRows(
      [line('aim', 18.7), line('gone', 0), line('urea', 100, 'fertilizer'), line('nolabel', 5)],
      (id) => (id === 'aim' ? '28573' : null),
      new Map([['28573', { registration_number: '28573', product_type: 'HERBICIDE', active_ingredients: 'CARFENTRAZONE-ETHYL' }]]),
      new Map([['28573', { registration_number: '28573', label_text: 'AIM EC CAUTION EYE AND SKIN IRRITANT GROUP 14 HERBICIDE' }]]),
    )
    expect(r.rows).toEqual([
      ['AIM', '28573', 'Carfentrazone-ethyl', 'Herbicide', '14 herbicide', 18.7, 'L', '1.9 jugs', 'Caution; eye and skin irritant', 'invoices less sprayed'],
      ['NOLABEL', null, null, null, null, 5, 'L', '0.5 jugs', 'label not read yet', 'invoices less sprayed'],
    ])
    expect(r.noLabel).toBe(1)
  })
})
