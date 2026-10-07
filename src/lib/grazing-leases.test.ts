import { describe, expect, it } from 'vitest'
import {
  albertaClass,
  blankReturn,
  calvingMonths,
  copyLastYear,
  formDate,
  missingAnswers,
  mobAlbertaClass,
  prefillDisposition,
  prefillLivestock,
  prefillReturn,
  returnYearFor,
  shiftYear,
  slashDate,
  stockReturnDue,
  stockReturnReminder,
  toDisposition,
  toStockReturn,
  type Disposition,
  type EventLike,
  type HerdLike,
  type StockReturn,
} from './grazing-leases'

const lease = (over: Partial<Disposition> = {}): Disposition => ({
  ...toDisposition({ id: 'd1', disposition_no: 'GRL-10001', ranch_id: 'r1' }),
  ...over,
})

const herd: HerdLike[] = [
  { class_name: 'Cows', head_count: 120, avg_weight_lb: '1400', feed_class: 'cow', graze_start: '2026-05-20', graze_end: '2026-10-30' },
  { class_name: 'Bulls', head_count: 5, avg_weight_lb: 1900, feed_class: 'bull', graze_start: '2026-06-15', graze_end: '2026-08-31' },
  { class_name: 'Replacement heifers', head_count: 30, avg_weight_lb: 1000, feed_class: 'bred_heifer', graze_start: null, graze_end: null },
  { class_name: 'Yearlings', head_count: 10, avg_weight_lb: 800, feed_class: 'backgrounder', graze_start: '2025-05-01', graze_end: null },
  { class_name: 'Calves', head_count: 115, avg_weight_lb: 500, feed_class: 'heifer_calf', graze_start: '2026-05-20', graze_end: '2026-10-30' },
  { class_name: 'Cull cows', head_count: 0, avg_weight_lb: 1300, feed_class: 'cow', graze_start: null, graze_end: null },
]

describe('dates on the return', () => {
  it('is due 31 January after the grazing year', () => {
    expect(stockReturnDue(2025)).toBe('2026-01-31')
    expect(formDate(stockReturnDue(2025))).toBe('January 31, 2026')
    expect(slashDate('2025-06-09')).toBe('2025/06/09')
    expect(slashDate(null)).toBe('')
  })

  it('works on last season until July, then this one', () => {
    expect(returnYearFor('2027-01-15')).toBe(2026)
    expect(returnYearFor('2026-06-30')).toBe(2025)
    expect(returnYearFor('2026-07-01')).toBe(2026)
    expect(returnYearFor('2026-10-05')).toBe(2026)
  })

  it('moves a date on a year, 29 February to the 28th', () => {
    expect(shiftYear('2025-06-09', 1)).toBe('2026-06-09')
    expect(shiftYear('2024-02-29', 1)).toBe('2025-02-28')
    expect(shiftYear('', 1)).toBe('')
  })

  it('names the calving months from the month calving starts', () => {
    expect(calvingMonths(3)).toBe('March - April')
    expect(calvingMonths(12)).toBe('December - January')
    expect(calvingMonths(null)).toBeNull()
    expect(calvingMonths(13)).toBeNull()
  })
})

describe('livestock classes', () => {
  it("maps the Herd tab's classes onto the province's, calves going with their cows", () => {
    expect(albertaClass('Cows', 'cow')).toBe('Cattle Cow')
    expect(albertaClass('Main herd')).toBe('Cattle Cow')
    expect(albertaClass('Bulls', 'bull')).toBe('Cattle Bull')
    expect(albertaClass('Replacement heifers', 'bred_heifer')).toBe('Cattle Yearling')
    expect(albertaClass('Yearlings', 'backgrounder')).toBe('Cattle Yearling')
    expect(albertaClass('Calves', 'heifer_calf')).toBeNull()
    expect(albertaClass('Steer calves', 'backgrounder')).toBeNull()
  })

  it("reads a mob's class from its name", () => {
    expect(mobAlbertaClass('East Main Herd')).toBe('Cattle Cow')
    expect(mobAlbertaClass('East Bulls')).toBe('Cattle Bull')
    expect(mobAlbertaClass('East Replacement Heifer')).toBe('Cattle Yearling')
    expect(mobAlbertaClass(null)).toBe('Cattle Cow')
  })
})

describe('prefilling the livestock', () => {
  it('falls back to the Herd tab: classes merged, weight by head, only this year’s dates', () => {
    const p = prefillLivestock({ year: 2026, pastureUnit: 'Combined with 10002', herd, events: [] })
    expect(p.source).toBe('herd')
    expect(p.livestock).toEqual([
      { pasture_unit: 'Combined with 10002', livestock_class: 'Cattle Cow', count: 120, date_in: '2026-05-20', date_out: '2026-10-30' },
      { pasture_unit: 'Combined with 10002', livestock_class: 'Cattle Bull', count: 5, date_in: '2026-06-15', date_out: '2026-08-31' },
      // Heifers and yearlings together; the yearlings' 2025 date is not this year's.
      { pasture_unit: 'Combined with 10002', livestock_class: 'Cattle Yearling', count: 40, date_in: '', date_out: '' },
    ])
    expect(p.weights).toEqual([
      { livestock_class: 'Cattle Cow', weight: 1400, unit: 'Pounds' },
      { livestock_class: 'Cattle Bull', weight: 1900, unit: 'Pounds' },
      { livestock_class: 'Cattle Yearling', weight: 950, unit: 'Pounds' },
    ])
  })

  it("prefers the grazing on the lease's own pastures: the largest mob, first in, last out", () => {
    const events: EventLike[] = [
      { pasture_id: 'p1', head_count: 110, avg_animal_weight_lb: null, turned_in_on: '2026-06-09', moved_out_on: '2026-07-20', mob: 'East Main Herd' },
      { pasture_id: 'p2', head_count: 118, avg_animal_weight_lb: 1450, turned_in_on: '2026-07-20', moved_out_on: '2026-11-03', mob: 'East Main Herd' },
      { pasture_id: 'p2', head_count: 5, avg_animal_weight_lb: null, turned_in_on: '2026-06-20', moved_out_on: null, mob: 'East Bulls' },
      // Last year's stay is not this year's.
      { pasture_id: 'p1', head_count: 300, avg_animal_weight_lb: null, turned_in_on: '2025-06-01', moved_out_on: '2025-09-01', mob: 'East Main Herd' },
    ]
    const p = prefillLivestock({ year: 2026, pastureUnit: null, herd, events, pastureNames: new Map([['p1', 'North'], ['p2', 'South']]) })
    expect(p.source).toBe('grazing')
    expect(p.livestock).toEqual([
      { pasture_unit: 'North, South', livestock_class: 'Cattle Cow', count: 118, date_in: '2026-06-09', date_out: '2026-11-03' },
      // Still in: no day out yet.
      { pasture_unit: 'South', livestock_class: 'Cattle Bull', count: 5, date_in: '2026-06-20', date_out: '' },
    ])
    // The event's own weight first, else the Herd tab's.
    expect(p.weights.map((w) => w.weight)).toEqual([1450, 1900])
  })

  it('finds nothing when the ranch has no herd and the lease no grazing', () => {
    expect(prefillLivestock({ year: 2026, pastureUnit: null, herd: [], events: [] })).toEqual({ livestock: [], weights: [], source: null })
  })
})

describe('prefilling the lease', () => {
  const donor = lease({
    id: 'd0',
    disposition_no: 'GRL-10000',
    holder_name: 'PRAIRIE CATTLE LTD.',
    holder_address: 'Box 1\nSomewhere AB',
    return_to: 'District office',
    return_phone: '(403) 555-0100',
    signer_name: 'Pat Holder',
    brands: [{ owner: 'Prairie Cattle', description: 'P bar', location: 'Left Hip', livestock: 'Cattle' }],
    sort_order: 1,
  })

  it('offers the holder, office and signer from another lease, the calving months and brand from the app, each marked', () => {
    const out = prefillDisposition(lease(), { calvingMonth: 5, ranchBrand: { brand: 'RR', location: 'Right Rib', owner: 'Ranch owner' }, others: [donor] })
    expect(out.disposition.holder_name).toBe('PRAIRIE CATTLE LTD.')
    expect(out.disposition.return_phone).toBe('(403) 555-0100')
    expect(out.disposition.signer_name).toBe('Pat Holder')
    expect(out.disposition.calving_months).toBe('May - June')
    expect(out.disposition.brands).toEqual([{ owner: 'Ranch owner', description: 'RR', location: 'Right Rib', livestock: 'Cattle' }])
    expect(out.marks).toEqual({ holder: 'from GRL-10000', return_to: 'from GRL-10000', signer: 'from GRL-10000', calving: 'from the app', brands: 'from the app' })
  })

  it('leaves what the lease already has alone', () => {
    const own = lease({ holder_name: 'OWN', calving_months: 'April - May', brands: donor.brands })
    const out = prefillDisposition(own, { calvingMonth: 3, ranchBrand: null, others: [donor] })
    expect(out.disposition.holder_name).toBe('OWN')
    expect(out.disposition.calving_months).toBe('April - May')
    expect(out.marks.holder).toBeUndefined()
    expect(out.marks.calving).toBeUndefined()
    expect(out.marks.brands).toBeUndefined()
  })

  it('takes brands from another lease when the ranch has none', () => {
    const out = prefillDisposition(lease(), { calvingMonth: null, ranchBrand: { brand: null, location: null, owner: null }, others: [donor] })
    expect(out.disposition.brands).toEqual(donor.brands)
    expect(out.marks.brands).toBe('from GRL-10000')
  })

  it('makes a whole return: grazed when its pastures were, other land fenced when it has some', () => {
    const d = lease({ pasture_ids: ['p1'], other_lands: [{ land_type: 'Tame', acres: 600, quarter: 'NE', section: '1', township: '080', range: '10', meridian: 'W4' }] })
    const { ret } = prefillReturn(d, 2026, {
      herd,
      events: [{ pasture_id: 'p1', head_count: 50, avg_animal_weight_lb: null, turned_in_on: '2026-06-01', moved_out_on: '2026-09-01', mob: 'Herd' }],
      pastureNames: new Map(),
      calvingMonth: null,
      ranchBrand: null,
      others: [],
    })
    expect(ret.grazed).toBe(true)
    expect(ret.other_fenced).toBe(true)
    expect(ret.livestock).toHaveLength(1)
    expect(ret.prefilled.livestock).toMatch(/grazing/)
    expect(ret.prefilled.grazed).toBe('from the app')
    // From the Herd tab alone, whether it was grazed is still the person's answer.
    const herdOnly = prefillReturn(lease(), 2026, { herd, events: [], pastureNames: new Map(), calvingMonth: null, ranchBrand: null, others: [] }).ret
    expect(herdOnly.grazed).toBeNull()
    expect(herdOnly.prefilled.livestock).toMatch(/Herd tab/)
  })
})

describe('copying last year', () => {
  const last: StockReturn = {
    ...blankReturn('d1', 2025),
    grazed: true,
    livestock: [{ pasture_unit: 'Combined', livestock_class: 'Cattle Cow', count: 118, date_in: '2025-06-09', date_out: '2025-11-03' }],
    weights: [{ livestock_class: 'Cattle Cow', weight: 1100, unit: 'Pounds' }],
    owned: true,
    feed_supplied: true,
    feed: [{ feed_type: 'Hay', amount: '20 bales', date_from: '2025-10-01', date_to: '2025-10-30' }],
    other_fenced: true,
    had_losses: true,
    losses: [{ livestock_type: 'Cattle Cow', loss_type: 'Dead', number: 1 }],
    declared: true,
    signed_on: '2026-01-20',
    status: 'filed',
    filed_on: '2026-01-21',
  }

  it("carries the answers forward a year and leaves the year's own facts blank", () => {
    const c = copyLastYear(last, 2026)
    expect(c.year).toBe(2026)
    expect(c.livestock[0]).toMatchObject({ count: 118, date_in: '2026-06-09', date_out: '2026-11-03' })
    expect(c.feed[0]).toMatchObject({ date_from: '2026-10-01', date_to: '2026-10-30' })
    expect(c.owned).toBe(true)
    expect(c.other_fenced).toBe(true)
    expect(c.had_losses).toBeNull()
    expect(c.losses).toEqual([])
    expect(c.declared).toBe(false)
    expect(c.signed_on).toBeNull()
    expect(c.status).toBe('draft')
    expect(c.prefilled).toEqual({ grazed: 'copied from 2025', livestock: 'copied from 2025', weights: 'copied from 2025' })
  })
})

describe('what is still to answer', () => {
  it('lists the blanks in the form’s order, and nothing once it is complete', () => {
    expect(missingAnswers(lease(), blankReturn('d1', 2026))).toEqual([
      'holder name',
      'expiry date',
      'key land',
      '1. grazed this year',
      '3. own livestock',
      '4. calving months',
      '5. brands',
      '6. hay',
      '7. feed',
      '8. other land fenced in',
      '10. declaration',
    ])
    const d = lease({ holder_name: 'H', expiry_date: '2033-08-31', key_land: 'K', calving_months: 'March - April', brands: [{ owner: 'O', description: 'B', location: 'L', livestock: 'Cattle' }] })
    const r: StockReturn = {
      ...blankReturn('d1', 2026),
      grazed: true,
      livestock: [{ pasture_unit: '', livestock_class: 'Cattle Cow', count: 10, date_in: '2026-06-01', date_out: '' }],
      weights: [{ livestock_class: 'Cattle Cow', weight: 1200, unit: 'Pounds' }],
      owned: true,
      hay_cut: false,
      feed_supplied: false,
      other_fenced: false,
      declared: true,
    }
    expect(missingAnswers(d, r)).toEqual(['1. dates in and out'])
    expect(missingAnswers(d, { ...r, livestock: [{ ...r.livestock[0], date_out: '2026-10-01' }] })).toEqual([])
  })
})

describe('the January reminder', () => {
  const leases = [
    { id: 'a', disposition_no: 'GRL-10002', active: true },
    { id: 'b', disposition_no: 'GRL-10001', active: true },
    { id: 'c', disposition_no: 'GRL-10003', active: false },
  ]

  it('lists the active leases with no filed return for the year just ended, once a year', () => {
    const plan = stockReturnReminder('2027-01-02', leases, [
      { disposition_id: 'a', year: 2026, status: 'draft' },
      { disposition_id: 'b', year: 2025, status: 'filed' },
    ])
    expect(plan).toMatchObject({ key: 'stock_return_2026', year: 2026, pending: ['GRL-10001', 'GRL-10002'] })
    expect(plan!.title).toBe('File the 2026 grazing lease stock returns')
    expect(plan!.body).toContain('January 31, 2027')
    expect(plan!.body).toContain('GRL-10001, GRL-10002')
  })

  it('says nothing outside January, or when every lease is filed', () => {
    expect(stockReturnReminder('2027-01-01', leases, [])).toBeNull()
    expect(stockReturnReminder('2027-02-01', leases, [])).toBeNull()
    expect(stockReturnReminder('2026-12-15', leases, [])).toBeNull()
    expect(
      stockReturnReminder('2027-01-10', leases, [
        { disposition_id: 'a', year: 2026, status: 'filed' },
        { disposition_id: 'b', year: 2026, status: 'filed' },
      ]),
    ).toBeNull()
    const one = stockReturnReminder('2027-01-10', leases, [{ disposition_id: 'a', year: 2026, status: 'filed' }])
    expect(one!.title).toBe('File the 2026 grazing lease stock return')
  })
})

describe('reading rows', () => {
  it('turns PostgREST numerics and jsonb into typed rows', () => {
    const d = toDisposition({
      id: 'x',
      disposition_no: 'GRL-1',
      billable_aum: '58',
      capacity_aum: null,
      pasture_ids: null,
      other_lands: [{ land_type: 'Tame', acres: '600.0', quarter: 'NE', section: 35 }],
      brands: 'not a list',
      active: null,
    })
    expect(d.billable_aum).toBe(58)
    expect(d.capacity_aum).toBeNull()
    expect(d.pasture_ids).toEqual([])
    expect(d.other_lands[0]).toEqual({ land_type: 'Tame', acres: 600, quarter: 'NE', section: '35', township: '', range: '', meridian: '' })
    expect(d.brands).toEqual([])
    expect(d.active).toBe(true)
    const r = toStockReturn({ disposition_id: 'x', year: 2025, grazed: true, livestock: [{ livestock_class: 'Cattle Cow', count: '118' }], status: 'filed', prefilled: null })
    expect(r.livestock[0].count).toBe(118)
    expect(r.weights).toEqual([])
    expect(r.owned).toBeNull()
    expect(r.status).toBe('filed')
    expect(r.prefilled).toEqual({})
  })
})
