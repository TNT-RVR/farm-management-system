import { describe, expect, it } from 'vitest'
import type { LandDeal } from '@/lib/land-deals'
import { reportCsv } from './framework'
import { STATUS } from './agristability-form'
import type { InsurableArea } from './afsc'
import type { HarvestCrop, HistoryRow } from './afsc-production'
import {
  advanceLines,
  advanceOn,
  areaProduction,
  capAdvance,
  cashAdvanceReport,
  commodityFor,
  commodityLines,
  eligibleQuantity,
  livestockLines,
  livestockRateFor,
  PROGRAM,
  programDates,
  type AreaLine,
  type CashAdvanceInput,
} from './cash-advance'

const crop = (over: Partial<HarvestCrop> = {}): HarvestCrop => ({ id: 'canola', name: 'Canola', yield_unit: 'bu', test_weight_lb_per_bu: 50, own_use: false, category: 'commercial', afsc_insured: true, ...over })

const area = (over: { fieldId?: string; cropId?: string; crop?: string; acres?: number | null; expectedYield?: number | null } = {}): InsurableArea => ({
  area: { fieldId: over.fieldId ?? 'f1', cropId: over.cropId ?? 'canola', crop: over.crop ?? 'Canola', variety: null, acres: over.acres === undefined ? 100 : over.acres, renters: false, seeded: true, zone: false, expectedYield: over.expectedYield === undefined ? 50 : over.expectedYield },
  field: { id: over.fieldId ?? 'f1', name: '3', legal_land_description: 'NW-1-70-15-W4', active: true },
  irrigated: true,
  seeded: '2026-05-01',
})

const hist = (over: Partial<HistoryRow> = {}): HistoryRow => ({ field_id: 'f1', crop_id: 'canola', acres: 100, yield_per_acre: 55, yield_unit: 'bu', actual_yield_total: 5500, source: 'scale', scale_acres: 100, scale_at: null, ...over })

const jv: LandDeal = { landlord: 'Whitfield', arrangement: 'profit_share', field_ids: ['f2'], rent_per_acre: null, rent_total: null, our_share_pct: 50, crop_share_pct: null, inputs_shared: false, active: true, start_date: null, end_date: null, direction: 'in' }

const line = (o: { a?: InsurableArea; c?: HarvestCrop; h?: HistoryRow | null; deal?: LandDeal | null } = {}): AreaLine => areaProduction({ area: o.a ?? area(), crop: o.c ?? crop(), history: o.h ?? null, loads: [], began: null, deal: o.deal ?? null })

describe('rate maths', () => {
  it('multiplies the quantity by the rate, to the dollar', () => {
    expect(advanceOn(100, 305.55)).toBe(30555)
    expect(advanceOn(12.34, 126.1)).toBe(1556)
  })

  it('gives no advance, not a zero, when the quantity or the rate is unknown', () => {
    expect(advanceOn(null, 305.55)).toBeNull()
    expect(advanceOn(100, null)).toBeNull()
    expect(advanceOn(Number.NaN, 10)).toBeNull()
  })

  it('takes what was delivered off production, never below nothing', () => {
    expect(eligibleQuantity(500, 120)).toBe(380)
    expect(eligibleQuantity(500, null)).toBe(500)
    expect(eligibleQuantity(100, 300)).toBe(0)
    expect(eligibleQuantity(null, 50)).toBeNull()
  })
})

describe('the program’s limits', () => {
  const limits = PROGRAM

  it('reads $1M, $250k interest-free and $500k with canola for 2026', () => {
    expect(PROGRAM).toMatchObject({ year: 2026, maxAdvance: 1_000_000, interestFree: 250_000, interestFreeCanola: 500_000 })
  })

  it('keeps a small advance whole and interest-free', () => {
    expect(capAdvance({ canola: 0, other: 180_000 }, limits)).toEqual({ requested: 180_000, allowed: 180_000, overCap: 0, interestFree: 180_000, interestBearing: 0 })
  })

  it('charges interest past $250k on anything but canola', () => {
    const c = capAdvance({ canola: 0, other: 400_000 }, limits)
    expect(c.interestFree).toBe(250_000)
    expect(c.interestBearing).toBe(150_000)
  })

  it('lets canola take the interest-free part to $500k', () => {
    expect(capAdvance({ canola: 600_000, other: 0 }, limits).interestFree).toBe(500_000)
    // $250k of the other crops, then $250k more on canola.
    const mixed = capAdvance({ canola: 300_000, other: 300_000 }, limits)
    expect(mixed.interestFree).toBe(500_000)
    expect(mixed.interestBearing).toBe(100_000)
    // Little of anything else: canola fills the rest up to $500k.
    expect(capAdvance({ canola: 450_000, other: 30_000 }, limits).interestFree).toBe(480_000)
  })

  it('cuts the advance to the $1M maximum', () => {
    const c = capAdvance({ canola: 900_000, other: 400_000 }, limits)
    expect(c.allowed).toBe(1_000_000)
    expect(c.overCap).toBe(300_000)
    expect(c.interestFree + c.interestBearing).toBe(1_000_000)
  })

  it('takes an advance still owing off the maximum and the interest-free part first', () => {
    const c = capAdvance({ canola: 0, other: 950_000 }, limits, 100_000)
    expect(c.allowed).toBe(900_000)
    expect(c.interestFree).toBe(150_000)
  })

  it('works the program’s dates from the year', () => {
    expect(programDates(2026)).toMatchObject({ applyBy: '2027-03-15', cropsRepayBy: '2027-09-30', cattleRepayBy: '2028-03-31', proofFrom: '2027-02-01' })
  })
})

describe('which commodity a crop is', () => {
  const of = (name: string, category: string | null = 'commercial') => commodityFor({ name, category })?.key ?? null

  it('keeps contract seed canola apart from canola, with no rate', () => {
    expect(of('BASF Canola', 'seed')).toBe('seed-canola')
    expect(commodityFor({ name: 'Corteva Canola', category: 'seed' })?.perTonne).toBeNull()
    expect(of('Canola')).toBe('canola')
    expect(commodityFor({ name: 'Canola', category: 'commercial' })?.perTonne).toBe(305.55)
  })

  it('sorts the beans into CCGA’s classes', () => {
    expect(of('Pinto Beans')).toBe('beans-pinto')
    expect(of('Great Northern Beans')).toBe('beans-white')
    expect(of('Black Beans')).toBe('beans-coloured')
    expect(of('Yellow Beans')).toBe('beans-coloured')
  })

  it('tells silage, durum and alfalfa seed from corn, wheat and alfalfa', () => {
    expect(of('Silage Corn')).toBe('silage')
    expect(of('Grain Corn')).toBe('corn')
    expect(of('Durum')).toBe('durum')
    expect(of('CWRS Wheat')).toBe('wheat')
    expect(of('Alfalfa Seed')).toBe('alfalfa-seed')
    expect(of('Alfalfa')).toBe('alfalfa')
    expect(of('Green Feed')).toBe('green-feed')
    expect(of('Potatoes')).toBeNull()
  })
})

describe('cattle', () => {
  const cls = (class_name: string, feed_class: string | null, avgLb: number | null) => livestockRateFor({ class_name, feed_class, avgLb })

  it('rates calves and feeders by weight, with no rate under 400 lb', () => {
    expect(cls('Steer calves', 'backgrounder', 550)?.perHead).toBe(1907.26)
    expect(cls('Steer calves', 'backgrounder', 750)?.perHead).toBe(1747.94)
    expect(cls('Calves', 'backgrounder', 350)).toBeNull()
    expect(cls('Calves', 'backgrounder', null)).toBeNull()
  })

  it('counts feeders and leaves breeding stock out of the total', () => {
    const r = livestockLines(
      [
        { ranch: 'Home Ranch', class_name: 'Calves', feed_class: 'backgrounder', head: 100, avgLb: 600 },
        { ranch: 'Home Ranch', class_name: 'Cows', feed_class: 'cow', head: 200, avgLb: 1400 },
        { ranch: 'East Ranch', class_name: 'Light calves', feed_class: 'backgrounder', head: 10, avgLb: 300 },
      ],
      '2028-03-31',
    )
    expect(r.advance).toBe(190_726)
    expect(r.head).toBe(310)
    const cows = r.rows[1]
    expect(cows[5]).toBe(1649)
    expect(cows[6]).toBeNull()
    expect(cows[7]).toBe(STATUS.na)
    // A class with no rate is blank, not a zero.
    expect(r.rows[2][6]).toBeNull()
    expect(r.rows[2][7]).toBe(STATUS.blank)
  })

  it('has no cattle total at all when nothing can be advanced on', () => {
    expect(livestockLines([{ ranch: 'Home Ranch', class_name: 'Bulls', feed_class: 'bull', head: 8, avgLb: 2000 }], '2028-03-31').advance).toBeNull()
  })
})

describe('production by field', () => {
  it('takes the recorded harvest as filled', () => {
    const l = line({ h: hist() })
    expect(l.status).toBe(STATUS.filled)
    expect(l.production).toBe(5500)
    // 5,500 bu at 50 lb is 124.7 t.
    expect(l.tonnes).toBeCloseTo((5500 * 50) / 2204.62262, 3)
  })

  it('falls back to the expected yield, marked as an estimate', () => {
    const l = line()
    expect(l.status).toBe(STATUS.estimate)
    expect(l.production).toBe(5000)
    expect(l.source).toMatch(/expected 50 bu\/ac × 100 ac \(not harvested yet\)/)
  })

  it('is blank, never zero, with no harvest and no expected yield', () => {
    const l = line({ a: area({ expectedYield: null }) })
    expect(l.status).toBe(STATUS.blank)
    expect(l.production).toBeNull()
    expect(l.tonnes).toBeNull()
  })

  it('counts our half of a 50/50 field', () => {
    const l = line({ a: area({ fieldId: 'f2' }), h: hist({ field_id: 'f2' }), deal: jv })
    expect(l.share).toBe(0.5)
    expect(l.ours).toBe(2750)
    expect(l.with).toBe('Whitfield')
  })
})

describe('by commodity', () => {
  const none = new Map<string, number | null>()

  it('works the advance on our tonnes less what was delivered', () => {
    const l = line({ h: hist() })
    const [c] = commodityLines({ lines: [l], binTonnes: new Map([['canola', 80]]), contracted: new Map([['canola', 50]]), delivered: new Map([['canola', 24.7]]), farmWide: true })
    expect(c.status).toBe(STATUS.filled)
    expect(c.eligible).toBeCloseTo(l.tonnes! - 24.7, 1)
    expect(c.advance).toBe(Math.round(c.eligible! * 305.55))
    expect(c.unpriced).toBeCloseTo(l.tonnes! - 50, 3)
    expect(c.canola).toBe(true)
  })

  it('flags an estimate in the row', () => {
    const [c] = commodityLines({ lines: [line(), line({ a: area({ fieldId: 'f9' }), h: hist({ field_id: 'f9' }) })], binTonnes: none, contracted: none, delivered: none, farmWide: true })
    expect(c.status).toBe(STATUS.estimate)
    expect(c.notes.join(' ')).toMatch(/an estimate/)
  })

  it('lists contract seed canola and fed crops without an advance', () => {
    const seed = line({ c: crop({ id: 'basf', name: 'BASF Canola', category: 'seed' }), a: area({ cropId: 'basf', crop: 'BASF Canola' }) })
    const hay = line({ c: crop({ id: 'alf', name: 'Alfalfa', yield_unit: 'ton', own_use: true, category: 'own_use' }), a: area({ cropId: 'alf', crop: 'Alfalfa', expectedYield: 4 }) })
    const out = commodityLines({ lines: [seed, hay], binTonnes: none, contracted: none, delivered: none, farmWide: true })
    for (const c of out) {
      expect(c.advance).toBeNull()
      expect(c.eligible).toBeNull()
      expect(c.rate).toBeNull()
      expect(c.notes[0]).toMatch(/^Not counted/)
    }
    expect(out.map((c) => c.name)).toEqual(['Alfalfa (fed on the farm)', 'Canola, contract seed'])
  })

  it('leaves the farm’s bins, contracts and deliveries off a joint venture’s sheet', () => {
    const [c] = commodityLines({ lines: [line({ h: hist() })], binTonnes: new Map([['canola', 80]]), contracted: new Map([['canola', 50]]), delivered: new Map([['canola', 20]]), farmWide: false })
    expect([c.inBins, c.contracted, c.delivered, c.unpriced]).toEqual([null, null, null, null])
    expect(c.eligible).toBeCloseTo(c.tonnes!, 1)
  })

  it('makes a total unknown, not short, when a bin cannot be weighed', () => {
    const [c] = commodityLines({ lines: [line({ h: hist() })], binTonnes: new Map([['canola', null]]), contracted: none, delivered: none, farmWide: true })
    expect(c.inBins).toBeNull()
  })
})

describe('the advance lines', () => {
  it('splits the interest-free part and leaves what is owing blank', () => {
    const lines = advanceLines({ canola: 300_000, otherCrops: 100_000, livestock: 200_000, limits: PROGRAM })
    const value = (item: string) => lines.find((l) => l[0] === item)!
    expect(value('Total before the program’s limits')[1]).toBe(600_000)
    expect(value('Interest-free part')[1]).toBe(500_000)
    expect(value('Interest-bearing part')[1]).toBe(100_000)
    expect(value('Advances still owing (any administrator, any program year)')).toEqual(['Advances still owing (any administrator, any program year)', null, STATUS.blank, expect.any(String)])
  })

  it('is blank, not zero, with nothing to add up', () => {
    const lines = advanceLines({ canola: null, otherCrops: null, livestock: null, limits: PROGRAM })
    for (const l of lines.filter((x) => x[2] !== STATUS.filled)) {
      expect(l[1]).toBeNull()
      expect(l[2]).toBe(STATUS.blank)
    }
  })
})

describe('the worksheet', () => {
  const input = (over: Partial<CashAdvanceInput> = {}): CashAdvanceInput => ({
    year: 2026,
    today: '2026-10-03',
    farmName: 'Prairie Creek Farm',
    party: '',
    lines: [line({ h: hist() }), line({ a: area({ fieldId: 'f4', cropId: 'pinto', crop: 'Pinto Beans', expectedYield: 2500 }), c: crop({ id: 'pinto', name: 'Pinto Beans', yield_unit: 'lbs', test_weight_lb_per_bu: 60 }) })],
    left: ['Potatoes on Field 7 (Grower’s crop and inputs on our land)'],
    ventures: [{ landlord: 'Whitfield', lines: [line({ a: area({ fieldId: 'f2' }), h: hist({ field_id: 'f2' }), deal: jv })] }],
    binRows: [{ bin: 'Bin 4', site: 'Home', cropId: 'canola', crop: 'Canola', bushels: 3000, tonnes: 68 }],
    contracted: new Map(),
    delivered: new Map(),
    herd: [{ ranch: 'Home Ranch', class_name: 'Calves', feed_class: 'backgrounder', head: 100, avgLb: 600 }],
    sales: [{ date: '2026-09-20', buyer: 'Viterra', ticket: 'T1', commodity: 'Canola', cropName: 'Canola', tonnes: 20, head: null, gross: null, basis: 'ticket weight; no price' }],
    cropByName: new Map([
      ['Canola', { name: 'Canola', category: 'commercial' }],
      ['Pinto Beans', { name: 'Pinto Beans', category: 'commercial' }],
    ]),
    ...over,
  })

  it('never fills an identifier, and leaves blanks empty', () => {
    const r = cashAdvanceReport(input())
    const form = r.sections.find((s) => s.title === 'For the application')!
    for (const row of form.rows.filter((x) => x[2] === STATUS.blank)) expect(row[1]).toBeNull()
    for (const item of ['SIN or business number', 'AgriStability participant number (PIN), 2026 enrolment', 'AFSC AgriInsurance client and contract numbers']) {
      expect(form.rows.find((x) => x[0] === item)![1]).toBeNull()
    }
    // Every blank on the form is on the still-needed list.
    const needed = r.sections.find((s) => s.title === 'Still needed')!.rows.map((x) => x[0])
    for (const row of form.rows.filter((x) => x[2] === STATUS.blank)) expect(needed).toContain(row[0])
  })

  it('puts the joint venture apart, out of the totals, and lists deliveries to repay on', () => {
    const r = cashAdvanceReport(input())
    expect(r.sections.find((s) => s.title === 'Joint ventures')!.rows[0][0]).toBe('Whitfield')
    const deliveries = r.sections.find((s) => s.title === 'Deliveries in the app')!
    expect(deliveries.rows[0][7]).toBe(Math.round(20 * 305.55))
    expect(r.sections.find((s) => s.title === 'Cattle')!.foot![6]).toBe(190_726)
    expect(r.sections.find((s) => s.title === 'Repayment')!.rows.map((x) => x[0])).toEqual(['Beans – Pinto', 'Canola', 'Cattle'])
    expect(r.subtitle).toMatch(/not its form/)
    expect(reportCsv({ ...r, filename: 'x' })).toContain('Cash advance application (APP)')
  })

  it('makes a joint venture’s own sheet without the farm’s bins, cattle or deliveries', () => {
    const r = cashAdvanceReport(input({ party: 'Whitfield', lines: [line({ a: area({ fieldId: 'f2' }), h: hist({ field_id: 'f2' }), deal: jv })], ventures: [] }))
    const titles = r.sections.map((s) => s.title)
    expect(titles).not.toContain('Cattle')
    expect(titles).not.toContain('Grain in storage now')
    expect(titles).not.toContain('Deliveries in the app')
    expect(r.filename).toBe('Cash advance APP 2026 Whitfield JV')
  })

  it('says when the rates are another year’s', () => {
    const r = cashAdvanceReport(input({ year: 2027 }))
    expect(r.lead!.join(' ')).toMatch(/program year 2026/)
  })
})

describe('a joint venture applying in its own name', () => {
  it('counts the whole field on its own sheet, and our half on ours', () => {
    const half = areaProduction({ area: area(), crop: crop(), history: hist(), loads: [], began: null, deal: jv })
    const whole = areaProduction({ area: area(), crop: crop(), history: hist(), loads: [], began: null, deal: jv, wholeField: true })
    expect(half.share).toBe(0.5)
    expect(whole.share).toBe(1)
    expect(whole.tonnes).toBeCloseTo(half.tonnes! * 2, 6)
  })
})
