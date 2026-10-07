import { describe, expect, it } from 'vitest'
import type { PlanRowView } from '@/lib/planner'
import type { LandDeal } from '@/lib/land-deals'
import type { CropRow } from '@/lib/queries'
import { cattleSaleCode, cropCode, isFallow, schedule3Line } from '@/lib/agristability-codes'
import type { Cell } from '@/lib/table-report'
import { buildCropBooks, type BooksInput } from './crop-books'
import { salesInCalendarYear, type YearEnd } from './agristability'
import { agriStabilityForm, dollars, known, STATUS, totalOf } from './agristability-form'
import { booksStatementA, type QbInput } from './books-statement-a'
import { parseReport } from '@/lib/qb-books-core'
import { PL } from './__fixtures__/qb-books'

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

const pass = (field: string, product: string) => ({
  id: `op-${field}-${product}`,
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

const yearEnd = (over: Partial<YearEnd> = {}): YearEnd => ({
  asAt: '2026-12-31',
  moves: [],
  bins: [{ id: 'b1', name: '#21', site: 'Main Yard' }],
  unmeasured: [],
  crops: [{ id: 'corn', name: 'Grain Corn', yield_unit: 'bu', test_weight_lb_per_bu: 56 }],
  prices: [],
  board: new Map(),
  herd: [],
  sales: [],
  salesInYear: [],
  irrigated: new Set(),
  unpaid: [],
  ...over,
})

const potato = crop({ id: 'pot', name: 'Potato', yield_unit: 'cwt', renter_only: true })
const canola = crop({ id: 'can', name: 'Canola' })
const sorghum = crop({ id: 'sor', name: 'Sorghum' })

/** A farm with our corn (rented for cash), a 50/50 canola field, the potato grower's crop on our land and a flat rent received. */
function farm(yeOver: Partial<YearEnd> = {}, qb?: QbInput) {
  const books = buildCropBooks(
    base({
      rows: [
        row('A', crop(), 100, 200, 5, { yieldSource: 'pre-clean' }),
        row('B', canola, 50, 60, 15),
        row('P', potato, 80, 400, 20),
        row('S', sorghum, 10, 50, 4),
      ],
      deals: [
        deal({ landlord: 'Novak', arrangement: 'cash_rent', field_ids: ['A'], rent_per_acre: 300, our_share_pct: null }),
        deal({ landlord: 'Moreau', field_ids: ['B'] }),
        deal({ landlord: 'Grower Co', field_ids: ['P'], direction: 'out', our_share_pct: 20 }),
        deal({ landlord: 'Hytech', arrangement: 'cash_rent', field_ids: ['H'], rent_total: 12_000, direction: 'out', our_share_pct: null }),
      ],
      ops: [pass('A', 'Urea'), pass('A', 'Liberty')] as never,
    }),
  )
  return agriStabilityForm({ books, ye: yearEnd({ irrigated: new Set(['A']), ...yeOver }), farmName: 'Prairie Creek Farms', today: '2027-01-15', qb })
}

const section = (r: ReturnType<typeof farm>, starts: string) => r.sections.find((s) => s.title.startsWith(starts))!
const line = (r: ReturnType<typeof farm>, starts: string, code: string) => section(r, starts).rows.find((x) => x[0] === code)

describe('AgriStability codes', () => {
  it('maps the farm’s crops to commodity codes, most particular first', () => {
    const code = (n: string) => cropCode(n)?.code ?? null
    expect(code('Grain Corn')).toBe('011')
    expect(code('High-Moisture Corn')).toBe('011')
    expect(code('Silage Corn')).toBe('039')
    expect(code('Durum Silage')).toBe('039')
    expect(code('Durum Wheat')).toBe('056')
    expect(code('Seed Canola')).toBe('010')
    expect(code('Unknown Canola')).toBe('010')
    expect(code('Alfalfa Seed')).toBe('015')
    expect(code('Rye Grass Seed')).toBe('015')
    expect(code('Alfalfa')).toBe('264')
    expect(code('Grass Alfalfa Mix')).toBe('264')
    expect(code('Barley Straw (bedding)')).toBe('267')
    expect(code('Barley')).toBe('003')
    expect(code('Beans-Pinto')).toBe('004')
    expect(code('Peas')).toBe('013')
    expect(code('Sugar Beets')).toBe('268')
    expect(code('Potato-Creamer')).toBe('147')
    expect(code('Sorghum')).toBeNull()
    expect(code('Phacelia')).toBeNull()
    expect(isFallow({ name: 'Summer Fallow', yield_unit: 'ac' })).toBe(true)
  })

  it('maps cattle sold and the herd’s classes to the form’s lines', () => {
    expect(cattleSaleCode('heifers').code).toBe('719')
    expect(cattleSaleCode('bulls').code).toBe('719') // bull calves sold uncut
    expect(schedule3Line({ class_name: 'Bulls', feed_class: 'bull' }).key).toBe('bulls')
    expect(schedule3Line({ class_name: 'Cows', feed_class: 'cow' }).key).toBe('cows')
    expect(schedule3Line({ class_name: 'Replacement heifers', feed_class: 'bred_heifer' }).key).toBe('bredHeifers')
    expect(schedule3Line({ class_name: 'Backgrounded calves', feed_class: 'backgrounder' }).key).toBe('calves')
  })
})

describe('the prefilled AgriStability form', () => {
  it('puts our share of each crop on its code, and leaves the grower’s crop and rent received off', () => {
    const r = farm()
    expect(line(r, 'Statement A: commodity sales', '011')?.[2]).toBe(100_000)
    // 50/50 of the gross with Moreau: ours is half of 50 ac × 60 bu × $15.
    expect(line(r, 'Statement A: commodity sales', '010')?.[2]).toBe(22_500)
    expect(line(r, 'Statement A: commodity sales', '147')).toBeUndefined()
    const off = section(r, 'Left off')
    expect(off.rows.find((x) => String(x[1]).includes('Grower Co'))?.[2]).toBe(80 * 400 * 20 * 0.2)
    expect(off.rows.find((x) => String(x[1]).includes('Hytech'))?.[0]).toBe('T776')
  })

  it('says “code needed” for a crop the list does not have', () => {
    const r = farm()
    const s = line(r, 'Statement A: commodity sales', 'code needed')
    expect(s?.[1]).toBe('Sorghum')
    expect(section(r, 'Schedule 2').rows.find((x) => String(x[0]).startsWith('Sorghum'))?.[1]).toBe('code needed')
  })

  it('splits allowable from non-allowable, and keeps the fixed figure off both', () => {
    const r = farm()
    expect(line(r, 'Statement A: allowable', '9662')?.[2]).toBe(2_000)
    expect(line(r, 'Statement A: allowable', '9663')?.[2]).toBe(2_000)
    expect(line(r, 'Statement A: non-allowable', '9811')?.[2]).toBe(30_000)
    expect(line(r, 'Statement A: non-allowable', '9811')?.[3]).toBe(STATUS.filled)
    expect(line(r, 'Statement A: allowable', '9811')).toBeUndefined()
    const fixed = section(r, 'Left off').rows.find((x) => x[1] === 'Fixed expenses')
    expect(fixed?.[2]).toBeGreaterThan(0)
    for (const s of r.sections.filter((x) => x.title.startsWith('Statement A'))) expect(s.rows.some((x) => x[1] === 'Fixed expenses'), s.title).toBe(false)
  })

  it('never fills a blank with a zero, and never fills an identifier', () => {
    const r = farm()
    for (const s of r.sections) {
      const st = s.head.indexOf('Status')
      for (const x of s.rows) {
        if (x[st] === STATUS.blank || x[st] === STATUS.na) {
          const values = x.filter((_, i) => i !== 0 && i !== st && i !== x.length - 1 && !(s.head[i] === 'Item' || s.head[i] === 'Code' || s.head[i] === 'Unit'))
          expect(values.every((v) => v == null), `${s.title}: ${x[0]} ${x[1]}`).toBe(true)
        }
        for (const v of x) expect(v === 0, `${s.title}: ${x.join(' | ')}`).toBe(false)
      }
    }
    const ids = section(r, 'Statement A (T1163): identification').rows.filter((x) => /SIN|PIN|BN\)/.test(String(x[1])))
    expect(ids.length).toBeGreaterThanOrEqual(3)
    for (const x of ids) expect(x[2]).toBeNull()
    expect(section(r, 'Statement A (T1163)').rows.find((x) => x[1] === 'Farm name')?.[2]).toBe('Prairie Creek Farms')
  })

  it('turns an unknown amount into a blank and a total into the known lines only', () => {
    expect(dollars(0)).toBeNull()
    expect(dollars(0.2)).toBeNull()
    expect(dollars(1234.6)).toBe(1235)
    expect(known('9662', 'Fertilizer', null, STATUS.estimate, 'x', 'Enter the invoices.')[3]).toBe(STATUS.blank)
    const t = totalOf('9950', 'Total A', [known('1', 'a', 100, STATUS.filled, '', ''), known('2', 'b', null, STATUS.filled, '', 'fill')])
    expect(t[2]).toBe(100)
    expect(t[4]).toMatch(/1 still blank/)
  })

  it('takes the inventory from the bins’ ledger and splits irrigated from dryland', () => {
    const m = (type: string, bu: number, on: string) => ({ bin_id: 'b1', crop_id: 'corn', movement_type: type, bushels: bu, moved_at: on })
    const r = farm({ moves: [m('harvest_in', 3000, '2025-10-01'), m('sale_out', 1000, '2026-03-01'), m('harvest_in', 5000, '2026-10-01')] })
    const corn = section(r, 'Schedule 2').rows.find((x) => x[0] === 'Grain Corn · irrigated')!
    expect(corn[4]).toBe(100) // acres
    expect(corn[5]).toBe(100) // irrigated acres
    expect(corn[6]).toBe(3000) // start inventory, 31 Dec 2025
    expect(corn[7]).toBe(20_000) // produced
    expect(corn[13]).toBe(7000) // end inventory
    expect(corn[14]).toBe(STATUS.filled) // harvested, year closed
    const can = section(r, 'Schedule 2').rows.find((x) => x[0] === 'Canola · dryland')!
    expect(can[8]).toBe(1500) // landlord share: half of 3,000 bu
    expect(can[14]).toBe(STATUS.estimate)
    const cap = section(r, 'Productive capacity').rows
    expect(cap.find((x) => x[0] === '011')?.[2]).toBe(100)
    expect(cap.find((x) => x[0] === '010')?.[3]).toBe(50)
  })

  it('puts the herd and the calendar year’s calf sales on Schedule 3', () => {
    const sales = salesInCalendarYear(
      [
        { animal_class: 'heifers', head: 78, total_price: 285_000, avg_weight_lb: 547, delivery_date: '2026-04-14', sale_date: '2026-01-30', crop_year: 2025 },
        { animal_class: 'steers', head: 100, total_price: 300_000, avg_weight_lb: 600, delivery_date: '2027-01-10', sale_date: '2026-12-01', crop_year: 2026 },
      ],
      2026,
    )
    expect(sales).toHaveLength(1)
    const r = farm({
      salesInYear: sales,
      herd: [
        { ranch: 'Home Ranch', class_name: 'Cows', feed_class: 'cow', head_count: 320, avg_weight_lb: 1400, updated_at: '2026-08-04' },
        { ranch: 'Home Ranch', class_name: 'Backgrounded calves', feed_class: 'backgrounder', head_count: 280, avg_weight_lb: 550, updated_at: '2026-08-04' },
      ],
    })
    const s3 = section(r, 'Schedule 3').rows
    const cows = s3.find((x) => x[0] === 'Bred cows')!
    expect(cows[12]).toBe(320)
    expect(cows[2]).toBeNull() // starting head is not in the app
    const calves = s3.find((x) => x[0] === 'Calves homeraised')!
    expect(calves[7]).toBe(78)
    expect(calves[8]).toBe(547)
    expect(s3.find((x) => x[0] === 'Feeder cattle')?.[14]).toBe(STATUS.blank)
    expect(line(r, 'Statement A: commodity sales', '719')?.[2]).toBe(285_000)
  })

  it('counts every status in the panel at the top', () => {
    const r = farm()
    const meta = new Map<string, Cell>(r.meta)
    expect(Number(meta.get('Blank, to fill in'))).toBeGreaterThan(40)
    expect(Number(meta.get('Estimates'))).toBeGreaterThan(3)
    expect(r.sections.filter((s) => s.pageBreakBefore).length).toBeGreaterThanOrEqual(8)
  })
})

describe('the form from the books', () => {
  const qb: QbInput = { ok: true, sa: booksStatementA(parseReport(PL), new Map()), from: 'From QuickBooks, 7 Oct 2026, 10:41', fyLabel: 'Sep 2025 – Aug 2026' }
  const r = farm({}, qb)
  it('fills the expense lines from the P&L, allowable and non-allowable apart', () => {
    expect(line(r, 'Statement A: allowable', '9662')).toEqual(['9662', 'Fertilizers and soil supplements', 60_000, STATUS.filled, expect.stringMatching(/^From QuickBooks, 7 Oct 2026, 10:41: Fertilizer 60,000.00/)])
    expect(line(r, 'Statement A: allowable', '9815')?.[2]).toBe(90_000)
    expect(line(r, 'Statement A: allowable', '9713')?.[3]).toBe(STATUS.na)
    expect(line(r, 'Statement A: non-allowable', '9816')?.[2]).toBe(20_000)
    expect(line(r, 'Statement A: non-allowable', '9936')?.[2]).toBe(50_000)
    expect(line(r, 'Statement A: non-allowable', '9937')?.[3]).toBe(STATUS.blank)
    expect(section(r, 'Statement A: allowable').foot?.[2]).toBe(233_500)
  })
  it('puts income on its codes, the management fee on other income, and works out the summary', () => {
    expect(line(r, 'Statement A: commodity sales', '147')?.[2]).toBe(500_000)
    expect(line(r, 'Statement A: other farming income', '9600')?.[2]).toBe(30_000)
    expect(line(r, 'Statement A: summary', '9959')?.[2]).toBe(910_000)
    expect(line(r, 'Statement A: summary', '9968')?.[2]).toBe(413_500)
    expect(line(r, 'Statement A: summary', '9969')?.[2]).toBe(496_500)
    expect(line(r, 'Statement A (T1163): identification', '')).toBeDefined()
    const ident = section(r, 'Statement A (T1163): identification').rows
    expect(ident.find((x) => x[1] === 'Fiscal period')?.slice(2, 4)).toEqual(['2025-09-01 to 2026-08-31', STATUS.filled])
    expect(ident.find((x) => x[1] === 'Method of accounting')?.[2]).toBe('Code 1 accrual')
  })
  it('keeps the app’s figures as an estimate beside them, and the schedules as they were', () => {
    expect(section(r, 'Estimate from the app').rows.every((x) => x[3] === STATUS.estimate)).toBe(true)
    expect(section(r, 'Schedule 2').rows).toEqual(section(farm(), 'Schedule 2').rows)
    const left = section(r, 'Left off the form').rows
    expect(left.some((x) => x[0] === 'T776' && x[2] === 12_000)).toBe(true)
    expect(left.some((x) => x[1] === 'Fixed expenses')).toBe(false)
  })
  it('makes the form from the app alone without the books, saying why', () => {
    const off = farm({}, { ok: false, note: 'QuickBooks figures: owners and the accountant only.' })
    expect(off.lead).toContain('QuickBooks figures: owners and the accountant only.')
    expect(line(off, 'Statement A: allowable', '9662')?.[3]).toBe(STATUS.estimate)
  })
})
