import { describe, expect, it } from 'vitest'
import { tableReportPdfDoc, tableReportToCsv, type Cell } from '@/lib/table-report'
import {
  blankFlow,
  blankLine,
  COST_TIMING,
  DEFAULT_CROP_SHARES,
  expectedCalves,
  FLOW_HEAD,
  flowLine,
  flowTotals,
  lenderReview,
  LINE_HEAD,
  LSTATUS,
  offsetOf,
  ratios,
  saleShares,
  sharesAfter,
  totalOf,
  valued,
  yearPart,
  type LenderParts,
  type Line,
  type Sheet,
} from './lender-review'

const v = (item: string, value: number): Line => ({ item, value, status: LSTATUS.estimate, note: '' })
const sheet = (o: Partial<Sheet> = {}): Sheet => ({
  currentAssets: [v('Grain', 400_000)],
  intermediateAssets: [v('Machinery', 900_000)],
  longAssets: [v('Land', 2_000_000)],
  currentLiabilities: [v('Operating line', 200_000)],
  intermediateLiabilities: [v('Equipment loans', 100_000)],
  longLiabilities: [v('Mortgage', 300_000)],
  ...o,
})
const ratio = (s: Sheet, name: string) => ratios(s).find((r) => r.name === name)!

describe('lender review: lines and totals', () => {
  it('never turns an unknown into a zero', () => {
    expect(valued('Grain', null, LSTATUS.estimate, 'n', 'fill in')).toMatchObject({ value: null, status: LSTATUS.blank, note: 'fill in' })
    expect(valued('Grain', 0, LSTATUS.estimate, 'n', 'fill in')).toMatchObject({ value: null, status: LSTATUS.blank })
    expect(valued('Grain', Number.NaN, LSTATUS.estimate, 'n', 'fill in').value).toBeNull()
    // A filled figure may be a real zero: rent owed when every payment is in.
    expect(valued('Rent owed', 0, LSTATUS.filled, 'all paid', 'x')).toMatchObject({ value: 0, status: LSTATUS.filled })
    expect(valued('Grain', 1234.4, LSTATUS.estimate, 'n', 'x').value).toBe(1234)
  })

  it('adds only the lines with a value and counts the rest as open', () => {
    const t = totalOf([v('a', 10), blankLine('b', 'fill in'), { ...v('c', 5), partial: true }])
    expect(t).toEqual({ value: 15, open: 2 })
    expect(totalOf([blankLine('b', 'x')])).toEqual({ value: null, open: 1 })
  })
})

describe('lender review: ratios', () => {
  it('works the ratios out and calls them complete when every line has a value', () => {
    const s = sheet()
    expect(ratio(s, 'Working capital')).toMatchObject({ value: 200_000, complete: true })
    expect(ratio(s, 'Current ratio').value).toBeCloseTo(2)
    expect(ratio(s, 'Debt to asset').value).toBeCloseTo(600_000 / 3_300_000)
    expect(ratio(s, 'Net worth (equity)').value).toBe(2_700_000)
    expect(ratio(s, 'Equity to asset').value).toBeCloseTo(2_700_000 / 3_300_000)
    expect(ratio(s, 'Debt to equity').value).toBeCloseTo(600_000 / 2_700_000)
    for (const r of ratios(s)) expect(r.complete, r.name).toBe(true)
  })

  it('marks every ratio incomplete while a line under it is blank', () => {
    const s = sheet({ currentLiabilities: [v('Operating line', 200_000), blankLine('Accounts payable', 'fill in')] })
    for (const r of ratios(s)) expect(r.complete, r.name).toBe(false)
    // Still worked out from the lines that have values.
    expect(ratio(s, 'Current ratio').value).toBeCloseTo(2)
    expect(ratio(s, 'Current ratio').open).toBe(1)
  })

  it('is incomplete for a part-filled line too, and leaves ratios of unrelated tiers alone', () => {
    const s = sheet({ longAssets: [{ ...v('Land', 2_000_000), partial: true }] })
    expect(ratio(s, 'Working capital').complete).toBe(true)
    expect(ratio(s, 'Current ratio').complete).toBe(true)
    expect(ratio(s, 'Debt to asset').complete).toBe(false)
  })

  it('does not work out a ratio whose part has no value at all', () => {
    const s = sheet({ currentLiabilities: [blankLine('Operating line', 'x'), blankLine('Accounts payable', 'x')] })
    expect(ratio(s, 'Current ratio')).toMatchObject({ value: null, complete: false })
    expect(ratio(s, 'Working capital').value).toBeNull()
    // Nothing owed at all is no ratio, not infinity.
    const zero = sheet({ currentLiabilities: [{ item: 'Rent owed', value: 0, status: LSTATUS.filled, note: '' }] })
    expect(ratio(zero, 'Current ratio').value).toBeNull()
  })
})

describe('lender review: when the money comes', () => {
  it('counts quarters from the start of the harvest year', () => {
    expect(offsetOf('2026-10-15', 2026)).toBe(3)
    expect(offsetOf('2027-02-01', 2026)).toBe(4)
    expect(offsetOf('2028-11-01', 2026)).toBe(7) // held to the last
    expect(offsetOf('2025-12-01', 2026)).toBe(0)
  })

  it('reads a crop’s selling pattern from its deliveries, or none from too few', () => {
    const s = saleShares([
      { cropYear: 2024, on: '2024-10-02', qty: 100 },
      { cropYear: 2024, on: '2025-03-10', qty: 300 },
      { cropYear: 2025, on: '2025-11-20', qty: 100 },
      { cropYear: 2025, on: '2026-01-15', qty: 500 },
    ])!
    expect(s[3]).toBeCloseTo(200 / 1000)
    expect(s[4]).toBeCloseTo(800 / 1000)
    expect(s.reduce((a, b) => a + b, 0)).toBeCloseTo(1)
    expect(saleShares([{ cropYear: 2025, on: '2025-10-01', qty: 5 }])).toBeNull()
  })

  it('defaults to half in Q4 and half the next Q1', () => {
    expect(yearPart(DEFAULT_CROP_SHARES, 2027, 2027)).toEqual([0, 0, 0, 0.5])
    expect(yearPart(DEFAULT_CROP_SHARES, 2026, 2027)).toEqual([0.5, 0, 0, 0])
    expect(yearPart(DEFAULT_CROP_SHARES, 2025, 2027)).toEqual([0, 0, 0, 0])
  })

  it('sells what is left after the statement date, the rest of it in the year after', () => {
    // On 31 Dec the Q4 half is sold; what is in the bins is the Q1 half, all of it.
    const left = sharesAfter(DEFAULT_CROP_SHARES, 2026, '2026-12-31')
    expect(yearPart(left, 2026, 2027)).toEqual([1, 0, 0, 0])
    // A pattern that says it should all be gone goes the next quarter.
    const late = sharesAfter(DEFAULT_CROP_SHARES, 2025, '2026-12-31')
    expect(yearPart(late, 2025, 2027)).toEqual([1, 0, 0, 0])
    expect(late.reduce((a, b) => a + b, 0)).toBeCloseTo(1)
    // Before the harvest year, nothing is sold yet.
    expect(sharesAfter(DEFAULT_CROP_SHARES, 2027, '2026-12-31')).toEqual(DEFAULT_CROP_SHARES)
  })

  it('puts a cash-flow line in its quarters and leaves out what falls outside the year', () => {
    const l = flowLine('in', '2027 crop sold: Canola', 100_000, yearPart(DEFAULT_CROP_SHARES, 2027, 2027), LSTATUS.estimate, 'n', 'x')
    expect(l.q).toEqual([null, null, null, 50_000])
    expect(l.value).toBe(50_000)
    const fixed = flowLine('out', 'Fixed', 1000, COST_TIMING.fixed.q, LSTATUS.estimate, 'n', 'x')
    expect(fixed.q).toEqual([250, 250, 250, 250])
  })

  it('makes no amount a blank, and no timing a year figure marked part-filled', () => {
    expect(flowLine('out', 'Seed', null, COST_TIMING.seed.q, LSTATUS.estimate, 'n', 'fill in')).toMatchObject({ value: null, q: [null, null, null, null], status: LSTATUS.blank })
    expect(flowLine('out', 'Seed', 0, COST_TIMING.seed.q, LSTATUS.estimate, 'n', 'fill in').value).toBeNull()
    const undated = flowLine('out', 'Rent', 5000, null, LSTATUS.filled, 'no dates', 'x')
    expect(undated).toMatchObject({ value: 5000, q: [null, null, null, null], partial: true })
    expect(flowTotals([undated, blankFlow('out', 'Interest', 'x')])).toMatchObject({ year: 5000, open: 2 })
  })

  it('has every cost timing add to the whole', () => {
    for (const [k, t] of Object.entries(COST_TIMING)) expect(t.q.reduce((a, b) => a + b, 0), k).toBeCloseTo(1)
  })

  it('expects calves only with a weaning rate', () => {
    expect(expectedCalves(200, 90, 2)).toBeCloseTo(176.4)
    expect(expectedCalves(200, 90, null)).toBeCloseTo(180)
    expect(expectedCalves(200, null, 2)).toBeNull()
    expect(expectedCalves(0, 90, 2)).toBeNull()
  })
})

describe('lender review: the package', () => {
  const parts = (o: Partial<LenderParts> = {}): LenderParts => ({
    farmName: 'Prairie Creek Farm',
    today: '2026-10-03',
    asOf: '2026-10-03',
    planYear: 2027,
    sheet: sheet({ currentLiabilities: [blankLine('Operating line', 'From the bank statement.'), { item: 'Rent owed', value: 0, status: LSTATUS.filled, note: 'all paid' }] }),
    schedules: [],
    plan: { crops: { title: 'Production plan for 2027', head: ['Crop'], rows: [] }, others: [] },
    flow: {
      lines: [flowLine('in', 'Canola', 100_000, [0, 0, 0, 0.5], LSTATUS.estimate, 'n', 'x'), blankFlow('out', 'Term loan payments', 'Every loan’s payments.'), flowLine('out', 'Seed', 20_000, COST_TIMING.seed.q, LSTATUS.estimate, 'n', 'x')],
      timing: [],
      note: 'n',
    },
    inventory: [{ title: 'Grain', head: ['Crop'], rows: [] }],
    lead: [],
    ...o,
  })

  it('never puts a figure on a blank line', () => {
    const r = lenderReview(parts())
    for (const s of r.sections) {
      const status = s.head.indexOf('Status')
      if (status < 0) continue
      const valueCols = s.head === LINE_HEAD ? [4] : s.head === FLOW_HEAD ? [1, 2, 3, 4, 5] : []
      for (const row of s.rows) if (row[status] === LSTATUS.blank) for (const i of valueCols) expect(row[i], `${s.title}: ${String(row[0])}`).toBeNull()
    }
  })

  it('says the ratios are incomplete while a debt is blank, and lists every blank for the lender', () => {
    const r = lenderReview(parts())
    const ratiosTable = r.sections.find((s) => s.title === 'Net worth and ratios')!
    const current = ratiosTable.rows.find((x) => x[0] === 'Current ratio')!
    expect(current[1]).toBeNull() // rent owed is zero: no ratio, not a zero
    const nw = ratiosTable.rows.find((x) => x[0] === 'Net worth (equity)')!
    expect(String(nw[3])).toMatch(/^Incomplete/)
    const still = r.sections.find((s) => s.title === 'What the lender will still need')!
    const items = still.rows.map((x: Cell[]) => x[1])
    expect(items).toContain('Operating line')
    expect(items).toContain('Term loan payments')
    expect(items).toContain('Account, loan and client numbers')
  })

  it('puts each part on its own page and nets the cash flow from the lines with values', () => {
    const r = lenderReview(parts())
    const starts = r.sections.filter((s) => s.pageBreakBefore).map((s) => s.title)
    expect(starts).toEqual(['Production plan for 2027', 'Projected cash flow, 2027, by quarter', 'Grain', 'What the lender will still need'])
    const flow = r.sections.find((s) => s.title.startsWith('Projected cash flow'))!
    expect(flow.foot?.slice(1, 6)).toEqual([null, -20_000, null, 50_000, 30_000])
    expect(flow.foot?.[6]).toBe('Incomplete')
    expect(r.title).toBe('Lender annual review')
    expect(r.lead?.[0]).toMatch(/Not the lender’s own form/)
  })

  it('makes a branded PDF with each part on a page of its own, and a CSV', async () => {
    const r = lenderReview(parts())
    const doc = await tableReportPdfDoc(r, { brand: { farmName: 'Prairie Creek Farm', appName: 'RVR Management', logo: null }, now: new Date('2026-10-03T12:00:00Z') })
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(5)
    const csv = tableReportToCsv(r)
    expect(csv).toContain('Statement of assets and liabilities')
    expect(csv).toContain('What the lender will still need')
  })
})
