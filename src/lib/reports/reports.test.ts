import { describe, expect, it } from 'vitest'
import { productResolver } from '@/lib/spray-products'
import { cropLabel, fertilizerOnly, sprayRows, type SprayOp } from './spray'
import { against, yieldTable, type YieldEntry } from './yields'
import { waterUseGroups, type WaterPivot } from './water-use'
import { paidPer, purchaseGroups, surveyFor, type Purchase, type SurveyRow } from './purchases'
import { grantGroups, type GrantLite } from './grants'
import { auditGroups, changeSummary, recordLabel } from './audit'

describe('spray records', () => {
  const resolve = productResolver([{ id: 'p1', name: 'Liberty 150 SN', pmra_registration: '33213' }], [{ deere_name: 'liberty', product_id: 'p1', ignored: false }])
  const op = (over: Partial<SprayOp> = {}): SprayOp => ({
    id: 'o1',
    field_id: 'f1',
    jd_id: 'jd1',
    started_at: '2026-06-20T18:00:00Z',
    operator_name: 'Peter',
    treated_crop: 'EDIBLE_BEANS',
    applied_area_ha: 40,
    wind_speed_kmh: 12,
    air_temp_c: 21,
    humidity_pct: 50,
    products: [{ name: 'Tank', tankMix: true, components: [{ name: 'Liberty', productType: 'CHEMICAL', rate: { value: 1.35, unitId: 'l1ac-1' } }, { name: 'Mystery', productType: 'CHEMICAL', rate: { value: 100, unitId: 'ml1ac-1' } }] }],
    ...over,
  })

  it('writes a row per product, with the PCP number and the weather', () => {
    const r = sprayRows([op()], 100, resolve)
    expect(r.rows).toHaveLength(2)
    const liberty = r.rows.find((x) => x[2] === 'Liberty 150 SN')!
    expect(liberty[0]).toBe('2026-06-20')
    expect(liberty[1]).toBe('Edible beans')
    expect(liberty[3]).toBe('33213')
    expect(liberty[5]).toBe(1.35)
    expect(liberty[6]).toBe('L/ac')
    expect(Number(liberty[7])).toBeCloseTo(98.84, 1)
    expect(liberty.slice(10)).toEqual([12, 21, 50])
    expect([...r.unmatched]).toEqual(['Mystery'])
  })

  it('knows a fertilizer-only pass from a tank mix', () => {
    expect(fertilizerOnly([{ name: 'UAN', productType: 'FERTILIZER' }])).toBe(true)
    expect(fertilizerOnly(op().products)).toBe(false)
    expect(cropLabel('Corn_wet')).toBe('Corn wet')
  })
})

describe('yield history', () => {
  const e = (field: string, year: number, y: number, acres = 100, crop = 'c1'): YieldEntry => ({ fieldId: field, field, cropId: crop, year, yield: y, acres, unit: 'bu', fromPlan: false })

  it('pivots fields by year, against the normal and the farm average', () => {
    const t = yieldTable([e('A', 2024, 50), e('A', 2025, 60), e('B', 2025, 40, 300)], [{ id: 'c1', name: 'Wheat', normal: 50, unit: 'bu' }], [2022, 2023, 2024, 2025, 2026])
    expect(t.shownYears).toEqual([2024, 2025])
    const [a, b] = t.groups[0].rows
    expect(a).toEqual(['A', 50, 60, 55, 50, '+10%', '+20%'])
    expect(b[0]).toBe('B')
    // Farm average is acre-weighted: (50·100 + 60·100 + 40·300) / 500 = 46.
    expect(t.groups[0].totals?.[3]).toBe(46)
  })

  it('will not compare yields in different units', () => {
    expect(against(12, 8818)).toBe('units differ')
    expect(against(45, 40)).toBe('+13%')
  })
})

describe('water use', () => {
  const pivot = (field: string, name: string, over: Partial<WaterPivot> = {}): WaterPivot => ({
    field_id: field,
    acres_irrigated: 120,
    alloted_inches: null,
    acre_feet_allotment: null,
    on_river: false,
    smrid_area: null,
    water_licence_id: null,
    water_source: null,
    licence_note: null,
    fields: { name, active: true },
    ...over,
  })

  it('groups pivots by licence and canal and judges each against its share', () => {
    const r = waterUseGroups({
      pivots: [pivot('a', '1', { water_licence_id: 'L1', water_source: 'oldman_river' }), pivot('b', '2', { water_licence_id: 'L1', water_source: 'oldman_river' }), pivot('c', 'Kellers', { water_source: 'smrid' })],
      licences: [{ id: 'L1', licence_number: 'DAUT1', volume: '240', source: 'oldman_river', status: 'issued', holder: null }],
      events: [{ field_id: 'a', date: '2026-07-01', gross_mm: 254, net_mm: 200 }],
      allotments: [{ year: 2026, inches: 17, contract_inches: 18 }],
      year: 2026,
      today: '2026-10-02',
      district: 'SMRID',
    })
    expect(r.groups.map((g) => g.title)).toEqual(['Licence DAUT1 · Oldman River', 'SMRID canal'])
    const [one] = r.groups[0].rows
    // 10 in over 120 ac = 100 ac-ft of a 120 ac-ft even share.
    expect(one[2]).toBeCloseTo(10)
    expect(one[3]).toBeCloseTo(100)
    expect(one[5]).toBeCloseTo(120)
    expect(one[6]).toBe('83%')
    expect(r.groups[0].totals?.[6]).toBe('42%')
    expect(r.groups[1].rows[0][4]).toBe(17)
  })
})

describe('input purchases', () => {
  const survey: SurveyRow[] = [
    { item_key: 'fertilizer-46-0-0-urea-bulk-tonne', item: 'Urea', unit: 'tonne', observed_on: '2025-04-01', price: '900' },
    { item_key: 'fertilizer-46-0-0-urea-bulk-tonne', item: 'Urea', unit: 'tonne', observed_on: '2025-06-01', price: '950' },
    { item_key: 'buctril-m-containing-bromoxynil-emulsifiable-concentrate-8-litre', item: 'Buctril M', unit: '8 litre', observed_on: '2025-05-01', price: '160' },
  ]

  it('finds the survey price for the month, per tonne or per litre', () => {
    expect(surveyFor(survey, 'Tonne 46-0-0', '2025-05-13')).toMatchObject({ per: 900, unit: 't' })
    expect(surveyFor(survey, 'Tonne 46-0-0', '2025-07-01')).toMatchObject({ per: 950 })
    expect(surveyFor(survey, 'Buctril M 8L', '2025-05-13')).toMatchObject({ per: 20, unit: 'L' })
    expect(surveyFor(survey, 'Tonne 28.2-10.8-4.3 Blend', '2025-05-13')).toBeNull()
  })

  it('groups lines by supplier with the paid price against the survey', () => {
    const p: Purchase = { supplier: 'ICI', invoice_no: 'INV1', invoice_date: '2025-05-13', description: 'Tonne 46-0-0', quantity: '10', pack_unit: 'Metric', unit_price: '990', amount: '9900', canonical_unit: 'kg', price_per_canonical: '0.99', product_id: null }
    expect(paidPer(p, 't')).toBeCloseTo(990)
    const r = purchaseGroups([p], new Map(), survey)
    expect(r.groups[0].title).toBe('ICI')
    expect(r.groups[0].rows[0].slice(7)).toEqual([990, 900, '+10%'])
    expect(r.total).toBe(9900)
    expect(r.compared).toBe(1)
  })
})

describe('grants', () => {
  it('groups by status with the days left and the next open task', () => {
    const g: GrantLite = { id: 'g1', title: 'OFCAF', funder: 'AAFC', status: 'applying', amount_min: 0, amount_max: '75000', opens_on: null, closes_on: '2026-10-12', assigned_to: 'u1', url: null }
    const groups = grantGroups(
      [g],
      [
        { title: 'Get quotes', due_at: '2026-10-05T00:00:00Z', status: 'open', source_ref: 'g1', assignee_ids: ['u2'] },
        { title: 'Old', due_at: '2026-09-01T00:00:00Z', status: 'done', source_ref: 'g1', assignee_ids: [] },
      ],
      new Map([['u1', 'Sam'], ['u2', 'Dave']]),
      ['new', 'applying'],
      '2026-10-02',
    )
    expect(groups).toHaveLength(1)
    expect(groups[0].title).toBe('Applying')
    expect(groups[0].rows[0]).toEqual(['OFCAF', 'AAFC', 'up to $75,000', null, '2026-10-12', 10, 'Get quotes (due 2026-10-05)', 'Sam, Dave'])
  })
})

describe('audit log', () => {
  it('summarises a change as old → new, leaving out the noise', () => {
    expect(changeSummary({ action: 'update', old_values: { status: 'open', updated_at: 'x' }, new_values: { status: 'done', updated_at: 'y' } })).toBe('status: open → done')
    expect(changeSummary({ action: 'insert', old_values: null, new_values: { id: '1', name: 'Bin 9', notes: null } })).toBe('name: Bin 9')
    expect(changeSummary({ action: 'update', old_values: { a: 'x'.repeat(500) }, new_values: { a: 'y'.repeat(500) } }, 60).length).toBeLessThanOrEqual(60)
  })

  it('names the record and groups by day', () => {
    expect(recordLabel({ record_id: 'abcdef123456', old_values: null, new_values: { title: 'Spray 9' } })).toBe('Spray 9')
    expect(recordLabel({ record_id: 'abcdef123456', old_values: null, new_values: {} })).toBe('abcdef12')
    const g = auditGroups(
      [{ changed_at: '2026-10-02T16:13:00Z', table_name: 'cattle_water', record_id: null, action: 'update', actor_id: null, old_values: { a: 1 }, new_values: { a: 2 } }],
      new Map(),
      new Map(),
      'America/Edmonton',
    )
    expect(g[0].title).toBe('2026-10-02')
    expect(g[0].rows[0].slice(0, 4)).toEqual(['10:13', 'the app (sync)', 'Cattle water', 'changed'])
  })
})
