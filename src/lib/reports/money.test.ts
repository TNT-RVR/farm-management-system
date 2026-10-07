import { describe, expect, it } from 'vitest'
import type { PlanRowView } from '@/lib/planner'
import type { LandDeal } from '@/lib/land-deals'
import type { CropRow } from '@/lib/queries'
import { buildCropBooks, byCrop, costKind, offBooksReason, yieldFrom, type BooksInput } from './crop-books'
import { pnlGroups } from './crop-pnl'
import { copRow, costOfProductionReport } from './cost-of-production'
import { statementGroups, termsLine, type LeaseTerms } from './landlords'
import { inCropUnit, positionGroups, valuePrice } from './marketing-position'
import { leaseLines, type LeaseRow } from './lease-payments'
import { agriGroups, onHandAt, type YearEnd } from './agristability'
import type { Position } from '@/lib/marketing'
import { longDate } from './framework'

const crop = (over: Partial<CropRow> = {}): CropRow =>
  ({ id: 'corn', name: 'Grain Corn', yield_unit: 'bu', renter_only: false, land_rent_only: false, own_use: false, fixed_costs_apply: true, category: 'commercial', test_weight_lb_per_bu: 56, ...over }) as CropRow

const row = (field: string, c: CropRow | null, acres: number, y: number | null, price: number | null, over: Partial<PlanRowView> = {}): PlanRowView =>
  ({
    field: { id: field, name: field },
    plan: c ? { crop_id: c.id } : null,
    crop: c,
    acres,
    yieldPerAcre: y,
    yieldSource: 'farm avg',
    pricePerUnit: price,
    priceSource: 'estimate',
    priceBadge: '',
    ...over,
  }) as unknown as PlanRowView

const deal = (over: Partial<LandDeal>): LandDeal => ({
  landlord: 'Moreau',
  arrangement: 'profit_share',
  field_ids: [],
  rent_per_acre: null,
  rent_total: null,
  our_share_pct: 50,
  crop_share_pct: null,
  inputs_shared: false,
  active: true,
  start_date: null,
  end_date: null,
  direction: 'in',
  crop_ids: null,
  ...over,
})

/** One sprayer pass on a field, a product priced at $10/L, 2 L/ac. */
const spray = (field: string, product = 'Liberty') => ({
  id: `op-${field}`,
  field_id: field,
  operation_type: 'application',
  crop_season: 2026,
  products: [{ name: product, rate: { value: 2, unitId: 'l1ac-1' } }],
  applied_area_ha: null,
})

const base = (over: Partial<BooksInput>): BooksInput => ({
  year: 2026,
  rows: [],
  deals: [],
  ops: [],
  layers: [],
  saved: [],
  resolve: (n) => ({ name: n, pricePerUnit: 10 }),
  categoryOf: (n) => (n === 'Liberty' ? 'chemical' : n === 'Urea' ? 'fertilizer' : null),
  fixedPerAcre: 100,
  fixedFrom: null,
  extraLines: () => [],
  ...over,
})

describe('the crop books', () => {
  it('names each kind of cost', () => {
    const c = (key: string, label: string, source = 'Deere, 1 pass') => costKind({ key, label, source }, (n) => (n === 'Urea' ? 'fertilizer' : null))
    expect(c('auto:fixed-expenses', 'Fixed expenses')).toBe('fixed')
    expect(c('x', 'Fuel — field work')).toBe('fuel')
    expect(c('x', 'Trucking the crop')).toBe('trucking')
    expect(c('x', 'DKC 26-40', 'planter, 1 pass')).toBe('seed')
    expect(c('x', 'Urea')).toBe('fertilizer')
    expect(c('x', 'Hail insurance', 'added')).toBe('other')
  })

  it('says where a yield came from in a word', () => {
    expect(yieldFrom({ yieldSource: 'pre-clean', yieldPerAcre: 40 })).toBe('actual')
    expect(yieldFrom({ yieldSource: 'override', yieldPerAcre: 40 })).toBe('typed')
    expect(yieldFrom({ yieldSource: 'goal', yieldPerAcre: 40 })).toBe('goal')
    expect(yieldFrom({ yieldSource: 'farm avg', yieldPerAcre: null })).toBe('none')
  })

  it('keeps a renter’s crop and land rented out off our books', () => {
    expect(offBooksReason(crop({ renter_only: true }), null)).toMatch(/renter/)
    expect(offBooksReason(crop({ renter_only: true }), deal({ direction: 'out', landlord: 'Grower' }))).toBeNull()
    expect(offBooksReason(crop({ land_rent_only: true }), deal({ direction: 'out', landlord: 'Hytech' }))).toMatch(/Hytech/)
  })

  it('splits a 50/50 of the gross after insurance, inputs ours', () => {
    const corn = crop()
    const books = buildCropBooks(
      base({
        rows: [row('S', corn, 100, 200, 5)],
        deals: [deal({ field_ids: ['S'] })],
        ops: [spray('S')] as never,
        saved: [{ field_id: 'S', side: 'input', line_key: 'hail', label: 'Hail insurance', unit: 'ac', price_per_unit: 10, amount: 100, is_manual: true, removed: false }],
      }),
    )
    const r = books.rows[0]
    expect(r.gross).toBe(100_000) // 200 bu × 100 ac × $5
    expect(r.costs.chemical).toBe(2_000) // 2 L/ac × 100 ac × $10
    expect(r.costs.fixed).toBe(10_000)
    expect(r.insurance).toBe(1_000)
    // The owner takes half of the cheque after insurance comes off it.
    expect(r.ownerShare).toBe((100_000 - 1_000) / 2)
    expect(r.margin).toBe(100_000 - (2_000 + 10_000 + 1_000) - 49_500)
    expect(r.deal).toMatch(/50% of the gross/)
  })

  it('charges cash rent, and spreads a field’s costs over our crops on it by acres', () => {
    const corn = crop()
    const beans = crop({ id: 'beans', name: 'Beans-Pinto', yield_unit: 'lbs' })
    const books = buildCropBooks(
      base({
        rows: [row('W', corn, 30, 200, 5, { isZone: true }), row('W', beans, 70, 3000, 0.5, { isZone: true })],
        deals: [deal({ landlord: 'Novak', arrangement: 'cash_rent', rent_per_acre: 400, field_ids: ['W'] })],
        ops: [spray('W')] as never,
      }),
    )
    const [b, c] = books.rows // sorted by crop name
    expect(b.crop?.id).toBe('beans')
    expect(b.costs.chemical).toBeCloseTo(2_000 * 0.7)
    expect(c.costs.chemical).toBeCloseTo(2_000 * 0.3)
    expect(c.rent).toBe(400 * 30)
    expect(c.margin).toBeCloseTo(30_000 - 600 - 3_000 - 12_000)
  })

  it('gives fallow no revenue, and a field with no price no margin', () => {
    const fallow = crop({ id: 'sf', name: 'Summer Fallow', yield_unit: 'ac', fixed_costs_apply: false })
    const books = buildCropBooks(base({ rows: [row('F', fallow, 50, 1, null), row('G', crop(), 10, 180, null)], ops: [spray('F')] as never }))
    const f = books.rows.find((r) => r.fieldId === 'F')!
    expect(f.gross).toBe(0)
    expect(f.costs.fixed).toBe(0)
    expect(f.margin).toBe(-1_000)
    expect(books.rows.find((r) => r.fieldId === 'G')!.margin).toBeNull()
  })

  it('rolls up by crop with the budget’s break-evens', () => {
    const books = buildCropBooks(base({ rows: [row('A', crop(), 100, 200, 5), row('B', crop(), 100, 100, 5)] }))
    const [t] = byCrop(books.rows)
    expect(t.yieldPerAcre).toBe(150)
    expect(t.price).toBe(5)
    // $100/ac fixed over 150 bu, and over $5.
    expect(t.breakEvenPrice).toBeCloseTo(100 / 150)
    expect(t.breakEvenYield).toBe(20)
  })
})

describe('crop P&L and cost of production', () => {
  const books = buildCropBooks(
    base({
      rows: [row('A', crop(), 100, 200, 5), row('S', crop(), 50, 200, 5), row('P', crop({ id: 'pot', name: 'Potato', yield_unit: 'cwt', renter_only: true }), 40, 300, 10)],
      deals: [deal({ field_ids: ['S'] }), deal({ landlord: 'Grower', direction: 'out', field_ids: ['P'] })],
    }),
  )

  it('puts the summary by crop first, then each crop’s fields', () => {
    const { groups, totals } = pnlGroups(books)
    expect(groups[0].title).toBe('Summary by crop')
    expect(groups.map((g) => g.title)).toEqual(['Summary by crop', 'Grain Corn · bu', 'Potato · cwt'])
    expect(groups[1].rows).toHaveLength(2)
    // Whole-farm margin: corn 150 ac × ($1,000 − $100) less Moreau's half of $50,000, plus our half of the potatoes less their fixed.
    expect(totals[13]).toBeCloseTo(150 * 900 - 25_000 + (120_000 / 2 - 4_000))
  })

  it('leaves the grower’s crop out of the cost of production', () => {
    const r = costOfProductionReport(books)
    expect(r.groups[0].rows).toHaveLength(1)
    expect(r.summary?.join(' ')).toMatch(/Potato/)
    const [t] = byCrop(books.rows.filter((x) => x.crop?.id === 'corn'))
    const cells = copRow(t, books.rows.filter((x) => x.crop?.id === 'corn'))
    expect(cells[8]).toBe(100) // fixed $/ac
    expect(cells[12]).toBeCloseTo(0.5) // $100/ac over 200 bu
  })
})

describe('landlord statements', () => {
  const terms = (over: Partial<LeaseTerms>): LeaseTerms => ({
    landlord: 'Moreau',
    arrangement: 'profit_share',
    direction: 'in',
    field_ids: ['S'],
    owner_covers: 'Water, power, the land',
    we_cover: 'Seed, fertilizer and chemical',
    rent_per_acre: null,
    rent_total: null,
    our_share_pct: 50,
    inputs_shared: false,
    active: true,
    start_date: null,
    end_date: null,
    ...over,
  })

  it('writes each deal as a statement, with the flat rent once', () => {
    const corn = crop()
    const carrot = crop({ id: 'car', name: 'Carrot', land_rent_only: true })
    const books = buildCropBooks(
      base({
        rows: [row('S', corn, 100, 200, 5), row('M', carrot, 22, null, null, { isZone: true }), row('M', corn, 24, 200, 5, { isZone: true })],
        deals: [deal({ field_ids: ['S'] }), deal({ landlord: 'Hytech', arrangement: 'cash_rent', direction: 'out', rent_total: 31_200, field_ids: ['M'], crop_ids: ['car'] })],
      }),
    )
    const groups = statementGroups(books, [terms({}), terms({ landlord: 'Hytech', arrangement: 'cash_rent', direction: 'out', rent_total: 31_200, field_ids: ['M'], owner_covers: null, we_cover: null })], (id) => id)
    expect(groups.map((g) => g.title)).toEqual(['Moreau', 'Hytech (our land)'])
    const moreau = groups[0]
    expect(moreau.note).toMatch(/50% of the gross cheque to Moreau/)
    expect(moreau.rows[0][6]).toBe(100_000)
    expect(moreau.rows[0][8]).toBe(50_000)
    const hytech = groups[1]
    expect(hytech.rows.map((r) => r[1])).toEqual(['Carrot', null])
    expect(hytech.totals?.[12]).toBe(31_200)
  })

  it('says the terms in a sentence', () => {
    expect(termsLine(terms({ landlord: 'Novak', arrangement: 'cash_rent', rent_per_acre: 400 }))).toBe('Cash rent to Novak at $400/ac.')
    expect(termsLine(terms({ landlord: 'Grower', direction: 'out' }))).toMatch(/50% of the gross is ours/)
  })
})

describe('marketing position', () => {
  const beans = { id: 'b', name: 'Beans-Pinto', yield_unit: 'lbs', test_weight_lb_per_bu: '60' }
  it('turns a bin’s bushels into the unit the crop is sold in', () => {
    expect(inCropUnit(100, beans)).toBe(6_000)
    expect(inCropUnit(100, { ...beans, yield_unit: 'bu' })).toBe(100)
    expect(inCropUnit(100, { ...beans, yield_unit: 'ac' })).toBeNull()
  })

  it('values at the board first, else the year’s price', () => {
    expect(valuePrice('b', 2026, { value: 0.4, name: 'Pinto', on: '2026-09-30' } as never, [], 2026).value).toBe(0.4)
    const v = valuePrice('b', 2026, undefined, [{ crop_id: 'b', crop_year: 2025, price_per_unit: 0.45 }], 2026)
    expect(v).toEqual({ value: 0.45, from: '2025 price' })
  })

  it('lists the unpriced and the bins, skipping what is not sold', () => {
    const pos = (over: Partial<Position>): Position => ({ cropId: 'b', cropName: 'Beans-Pinto', cropYear: 2026, unit: 'lbs', category: 'commercial', acres: 100, expected: 300_000, contracted: 100_000, contractedValue: 50_000, delivered: 0, onhand: 0, cleanAcres: 0, preCleanAcres: 0, ...over })
    const r = positionGroups([pos({}), pos({ cropId: 'a', cropName: 'Alfalfa', category: 'own_use' })], [{ bin: '#24', site: 'Main Yard', cropId: 'b', bushels: 100 }], new Map([['b', beans]]), () => ({ value: 0.5, from: 'board' }))
    expect(r.hidden).toEqual(['Alfalfa'])
    const [b] = r.groups[0].rows
    expect(b[6]).toBe(200_000) // unpriced
    expect(b[11]).toBe(100_000) // unpriced at $0.50
    expect(b[12]).toBe(6_000) // 100 bu at 60 lb
    expect(r.groups[1].rows[0][0]).toBe('#24 · Main Yard')
  })
})

describe('lease payments', () => {
  const lease: LeaseRow = {
    id: 'w',
    landlord: 'Novak',
    arrangement: 'cash_rent',
    direction: 'in',
    field_ids: ['f'],
    our_share_pct: null,
    legal_land: null,
    acres: 87.86,
    rent_per_acre: 400,
    rent_total: null,
    start_date: null,
    end_date: '2027-12-31',
    notice_days: 90,
    payment_schedule: [{ date: '11-01', share: 1 }],
    active: true,
  }
  it('lists the year’s rent from the schedule, and the notice date', () => {
    const [l] = leaseLines(lease, [], 2026, ['Novak Main'], '2026-10-02')
    expect(l[5]).toBeCloseTo(35_144)
    expect(l[6]).toBe('2026-11-01')
    expect(l[9]).toBeCloseTo(35_144)
    expect(l[12]).toBe('2027-10-02')
  })
  it('takes a recorded payment over the schedule', () => {
    const [l] = leaseLines(lease, [{ lease_id: 'w', due_on: '2026-11-01', amount: 35_000, paid_on: '2026-10-30' }], 2026, [], '2026-11-02')
    expect(l[7]).toBe(35_000)
    expect(l[8]).toBe('2026-10-30')
    expect(l[9]).toBe(0)
  })
})

describe('AgriStability package', () => {
  it('counts a bin the way the on-hand view does, up to the date', () => {
    const m = (type: string, bu: number, on: string) => ({ bin_id: 'b1', crop_id: 'c', movement_type: type, bushels: String(bu), moved_at: on })
    expect(onHandAt([m('harvest_in', 1000, '2026-09-20'), m('sale_out', 300, '2026-11-01'), m('sale_out', 700, '2027-02-01')], '2026-12-31')).toEqual([{ binId: 'b1', cropId: 'c', bushels: 700 }])
  })

  it('lays out income, expenses, stock, cattle and what is owed', () => {
    const books = buildCropBooks(base({ rows: [row('A', crop(), 100, 200, 5, { yieldSource: 'pre-clean' })], ops: [spray('A')] as never }))
    const ye: YearEnd = {
      asAt: '2026-10-02',
      moves: [{ bin_id: 'b1', crop_id: 'corn', movement_type: 'harvest_in', bushels: 500, moved_at: '2026-09-30' }],
      bins: [{ id: 'b1', name: '#21', site: 'Main Yard' }],
      unmeasured: [{ bin_name: '#2', crop_name: 'Durum Wheat', crop_year: 2025 }],
      crops: [{ id: 'corn', name: 'Grain Corn', yield_unit: 'bu', test_weight_lb_per_bu: 56 }],
      prices: [{ crop_id: 'corn', crop_year: 2026, price_per_unit: 5 }],
      board: new Map(),
      herd: [{ ranch: 'Home Ranch', class_name: 'Cows', head_count: 320, avg_weight_lb: 1400, updated_at: '2026-08-04' }],
      sales: [{ animal_class: 'heifers', head: 100, total_price: 200_000 }],
      salesInYear: [],
      irrigated: new Set(),
      unpaid: [],
    }
    const g = agriGroups(books, ye, 2026)
    expect(g.map((x) => x.title)).toEqual(['Income', 'Expenses', `Grain on hand, ${longDate('2026-10-02')}`, 'Cattle on hand', 'Receivables and payables'])
    expect(g[0].totals?.[5]).toBe(100_000 + 200_000)
    expect(g[1].totals?.[5]).toBe(2_000 + 10_000)
    expect(g[2].rows[0][5]).toBe(2_500)
    expect(g[2].rows[1][6]).toMatch(/not recorded/)
    expect(g[3].rows[0][2]).toBe(320)
  })
})
