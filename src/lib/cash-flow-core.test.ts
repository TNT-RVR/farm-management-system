import { describe, expect, it } from 'vitest'
import {
  addMonths,
  assumedShares,
  cashForecast,
  cashKindOf,
  fiscalEndYear,
  incomeKind,
  kindLines,
  monthsByKind,
  openItems,
  peakMonths,
  planCosts,
  planCropSales,
  projectLoanPayments,
  seasonalShares,
  yearTotal,
  type YearMonths,
} from './cash-flow-core'
import { parseReport, type BooksAccount } from './qb-books-core'

// Made-up figures throughout.
const acct = (name: string, section = 'EXPENSES', id = name): BooksAccount => ({
  id,
  name,
  number: /^(\d{4}-\d{2})\b/.exec(name)?.[1] ?? null,
  section,
  path: [],
  amounts: [1],
})
const none = new Map()

const MONTHS = ['Sep 2024', 'Oct 2024', 'Nov 2024', 'Dec 2024', 'Jan 2025', 'Feb 2025', 'Mar 2025', 'Apr 2025', 'May 2025', 'Jun 2025', 'Jul 2025', 'Aug 2025']
const line = (name: string, id: string, months: number[]) => ({ ColData: [{ value: name, id }, ...months.map((v) => ({ value: String(v) })), { value: String(months.reduce((s, v) => s + v, 0)) }] })
const zeros = (at: Record<number, number>) => Array.from({ length: 12 }, (_, i) => at[i] ?? 0)
const PL = {
  Header: { StartPeriod: '2024-09-01', EndPeriod: '2025-08-31', ReportBasis: 'Cash' },
  Columns: { Column: [{ ColTitle: '', ColType: 'Account' }, ...MONTHS.map((t) => ({ ColTitle: t, ColType: 'Money' })), { ColTitle: 'Total', ColType: 'Money' }] },
  Rows: {
    Row: [
      {
        Header: { ColData: [{ value: 'Income' }] },
        Rows: {
          Row: [
            line('4180-03 Canola Sales', '1', zeros({ 2: 600, 5: 400 })),
            line('4400-00 Cattle Sales', '2', zeros({ 1: 300 })),
            line('4960-02 Inventory Adjustment - Crop', '3', zeros({ 11: 999 })),
          ],
        },
      },
      {
        Header: { ColData: [{ value: 'Expenses' }] },
        Rows: {
          Row: [
            line('5010-00 Fertilizer Expense', '10', zeros({ 1: 100, 7: 300 })),
            line('5400-00 Amortization Expense', '11', zeros({ 11: 5000 })),
            line('6600-00 Payroll Expenses', '12', zeros(Object.fromEntries(MONTHS.map((_, i) => [i, 10])))),
          ],
        },
      },
    ],
  },
}

describe('accounts into kinds', () => {
  it('reads income by its number, then its name', () => {
    expect(incomeKind({ number: '4180-03', name: 'Canola Sales' })).toBe('crop_sales')
    expect(incomeKind({ number: '4400-00', name: 'Cattle Sales' })).toBe('cattle_sales')
    expect(incomeKind({ number: '4300-01', name: 'Crop Insurance Proceeds' })).toBe('other_income')
    expect(incomeKind({ number: null, name: 'Calf sales' })).toBe('cattle_sales')
    expect(incomeKind({ number: null, name: 'Wheat' })).toBe('crop_sales')
    expect(incomeKind({ number: null, name: 'Sales' })).toBe('other_income')
  })

  it('leaves out entries that move no money', () => {
    expect(cashKindOf(acct('5400-00 Amortization Expense'), none)).toBeNull()
    expect(cashKindOf(acct('4960-02 Inventory Adjustment - Crop', 'INCOME'), none)).toBeNull()
    expect(cashKindOf(acct('2990 Future Income Taxes'), none)).toBeNull()
    expect(cashKindOf(acct('5010-00 Fertilizer Expense'), none)).toBe('fertilizer')
    expect(cashKindOf(acct('5855-00 Interest on Long Term Debt'), none)).toBe('land')
  })

  it('follows the owners’ own category for an account', () => {
    const o = new Map([['x', { account_id: 'x', category: 'chemical' as const, account_name: null, note: null }]])
    expect(cashKindOf(acct('5999-00 Odd one', 'EXPENSES', 'x'), o)).toBe('chemical')
  })
})

describe('monthsByKind', () => {
  it('puts each column in its calendar month and leaves out the total', () => {
    const y = monthsByKind(parseReport(PL), none, 'FY25')
    expect(y.byKind.get('fertilizer')).toEqual([0, 0, 0, 300, 0, 0, 0, 0, 0, 100, 0, 0]) // Oct 100, Apr 300
    expect(yearTotal(y, 'crop_sales')).toBe(1000)
    expect(y.byKind.get('crop_sales')![10]).toBe(600) // Nov
    expect(yearTotal(y, 'labour')).toBe(120)
    expect(y.byKind.has('depreciation')).toBe(false)
  })

  it('reads months by place when the titles are not months', () => {
    const odd = { ...PL, Columns: { Column: [{ ColTitle: '' }, ...MONTHS.map((_, i) => ({ ColTitle: `Col ${i}` })), { ColTitle: 'Total' }] } }
    const y = monthsByKind(parseReport(odd), none, 'FY25')
    expect(y.byKind.get('fertilizer')![9]).toBe(100)
  })
})

describe('seasonalShares', () => {
  const year = (fert: number[]): YearMonths => ({ label: '', byKind: new Map([['fertilizer', fert]]) })
  it('averages each year’s own pattern when two years have it', () => {
    const s = seasonalShares([year(zeros({ 9: 100, 3: 100 })), year(zeros({ 9: 1000 }))]).get('fertilizer')!
    expect(s.from).toBe('books')
    expect(s.years).toBe(2)
    expect(s.shares[9]).toBeCloseTo(0.75)
    expect(s.shares[3]).toBeCloseTo(0.25)
  })

  it('counts a refund month as nothing', () => {
    const s = seasonalShares([year(zeros({ 9: 100, 5: -50 })), year(zeros({ 9: 100 }))]).get('fertilizer')!
    expect(s.shares[9]).toBeCloseTo(1)
    expect(s.shares[5]).toBe(0)
  })

  it('falls back to the stated timing with under two years', () => {
    const s = seasonalShares([year(zeros({ 9: 100 }))]).get('fertilizer')!
    expect(s.from).toBe('assumed')
    expect(s.shares).toEqual(assumedShares('fertilizer'))
    expect(seasonalShares([]).get('seed')!.from).toBe('assumed')
  })

  it('assumed shares sum to one for every kind', () => {
    for (const k of ['crop_sales', 'cattle_sales', 'other_income', 'seed', 'labour', 'crop_insurance']) {
      expect(assumedShares(k).reduce((s, v) => s + v, 0)).toBeCloseTo(1)
    }
    expect(assumedShares('crop_sales')[10]).toBeCloseTo(1 / 6) // Nov
  })

  it('names the busy months', () => {
    expect(peakMonths(zeros({ 9: 0.5, 10: 0.3, 3: 0.15, 4: 0.05 }))).toBe('Oct 50%, Nov 30%, Apr 15%')
  })
})

describe('the plan’s figures', () => {
  const inputs = [
    { crop_id: 'c', crop_year: 2027, cost_per_acre: 50, name: 'Urea', category: 'fert' },
    { crop_id: 'c', crop_year: 2027, cost_per_acre: 20, name: 'Hail insurance', category: 'other' },
    { crop_id: 'c', crop_year: 2027, cost_per_acre: 30, name: 'Fixed', category: 'other', farm_fixed: true },
    { crop_id: 'd', crop_year: 2026, cost_per_acre: 10, name: 'Seed', category: 'seed' },
  ]
  const rows = [
    { cropId: 'c', acres: 100, revenuePerAcre: 500, planned: true, notOurs: false },
    { cropId: 'd', acres: 10, revenuePerAcre: 300, planned: true, notOurs: false },
    { cropId: 'c', acres: 50, revenuePerAcre: 80, planned: true, notOurs: true },
    { cropId: 'c', acres: 40, revenuePerAcre: 500, planned: false, notOurs: false },
  ]
  it('adds the budgets × planned acres by kind, carrying a missing year', () => {
    const p = planCosts(rows, 2027, inputs, 2026)
    expect(p.amounts).toEqual({ fertilizer: 5000, crop_insurance: 2000, seed: 100 })
    expect(p.acres).toBe(110)
    expect(p.budgetsFrom).toEqual([2026, 2027])
  })
  it('adds our crops’ sales', () => {
    expect(planCropSales(rows)).toEqual({ amount: 53_000, acres: 110 })
  })
})

describe('openItems', () => {
  it('places bills and invoices on their due dates, split by kind', () => {
    const { items, stale } = openItems(
      [
        { entity: 'Bill', party: 'Supplier', txnDate: '2026-09-20', due: '2026-11-15', balance: 300, lines: [{ kind: 'fertilizer', amount: 200 }, { kind: 'chemical', amount: 200 }] },
        { entity: 'Invoice', party: 'Buyer', txnDate: '2026-09-01', due: null, balance: 50, lines: [] },
        { entity: 'Invoice', party: 'Old', txnDate: '2023-01-01', due: '2023-02-01', balance: 70, lines: [] },
      ],
      '2026-10-07',
    )
    expect(items).toEqual([
      { date: '2026-11-15', side: 'out', amount: 150, kind: 'fertilizer', label: 'Supplier', source: 'payable' },
      { date: '2026-11-15', side: 'out', amount: 150, kind: 'chemical', label: 'Supplier', source: 'payable' },
      { date: '2026-09-01', side: 'in', amount: 50, kind: null, label: 'Buyer', source: 'receivable' },
    ])
    expect(stale).toEqual({ count: 1, amount: 70 })
  })
})

describe('projectLoanPayments', () => {
  it('repeats the last year’s payments a year on, held to what is owing', () => {
    const pays = [
      { account: 'a', label: 'Loan A', date: '2025-11-01', amount: 100 },
      { account: 'a', label: 'Loan A', date: '2026-05-01', amount: 100 },
      { account: 'b', label: 'Loan B', date: '2026-01-15', amount: 500 },
      { account: 'c', label: 'Paid off', date: '2026-02-01', amount: 40 },
      { account: 'a', label: 'Loan A', date: '2025-10-01', amount: 100 }, // more than a year ago
    ]
    const out = projectLoanPayments(pays, new Map([['a', 1000], ['b', 300], ['c', 0]]), '2026-10-07')
    expect(out.map((x) => [x.date, x.amount])).toEqual([
      ['2026-11-01', 100],
      ['2027-01-15', 300],
      ['2027-05-01', 100],
    ])
  })
})

describe('cashForecast', () => {
  const flat = Array(12).fill(1 / 12)
  it('spreads each year, places the known items and runs the balance', () => {
    const f = cashForecast({
      today: '2026-10-01',
      opening: 1000,
      kinds: [
        { key: 'labour', side: 'out', annual: 1200, shares: flat },
        { key: 'crop_sales', side: 'in', annual: 600, shares: zeros({ 11: 1 }) }, // December
      ],
      known: [
        { date: '2026-09-15', side: 'out', amount: 50, kind: null, label: 'Overdue', source: 'payable' },
        { date: '2027-01-15', side: 'out', amount: 400, kind: null, label: 'Loan', source: 'loan' },
        { date: '2027-12-01', side: 'out', amount: 999, kind: null, label: 'Too far', source: 'loan' },
      ],
    })
    expect(f.months).toHaveLength(12)
    expect(f.months[0].month).toBe('2026-10')
    expect(f.months[0].out).toBe(150) // 100 labour + 50 overdue lands now
    expect(f.months[2].in).toBe(600)
    expect(f.months[3].known.loan).toBe(-400)
    expect(f.months[11].balance).toBe(1000 + 600 - 1200 - 50 - 400)
    expect(f.low).toEqual({ month: '2027-09', balance: -50 })
    expect(f.totalOut).toBe(1650)
  })

  it('takes open bills off their own kind so they are not counted twice', () => {
    const f = cashForecast({
      today: '2026-10-01',
      opening: 0,
      kinds: [{ key: 'fertilizer', side: 'out', annual: 1000, shares: zeros({ 3: 1 }) }],
      known: [{ date: '2026-11-01', side: 'out', amount: 300, kind: 'fertilizer', label: 'Bill', source: 'payable' }],
    })
    expect(f.takenOff).toEqual({ fertilizer: 300 })
    expect(f.totalOut).toBe(1000)
    expect(f.months[1].out).toBe(300)
    expect(f.months[6].kinds.fertilizer).toBe(700) // April
  })

  it('counts only the days left in this month', () => {
    const f = cashForecast({ today: '2026-11-16', opening: 0, kinds: [{ key: 'labour', side: 'out', annual: 1200, shares: flat }], known: [] })
    expect(f.months[0].out).toBeCloseTo(50) // 15 of 30 days
    expect(f.months[1].out).toBeCloseTo(100)
  })
})

describe('kindLines', () => {
  const y = (label: string, fert: number, labour: number): YearMonths => ({
    label,
    byKind: new Map([
      ['fertilizer', zeros({ 9: fert })],
      ['labour', zeros({ 0: labour })],
    ]),
  })
  const plan = { planYear: 2027, costs: { amounts: { fertilizer: 900 }, acres: 100, budgetsFrom: [2027] }, sales: { amount: 5000, acres: 100 } }
  it('uses the plan where it has a figure, else last year’s books', () => {
    const lines = kindLines([y('FY26', 800, 120), y('FY25', 700, 110)], plan, true)
    const by = new Map(lines.map((l) => [l.key, l]))
    expect(by.get('fertilizer')).toMatchObject({ annual: 900, lastYear: 800, from: '2027 budgets × 100 ac planned' })
    expect(by.get('labour')).toMatchObject({ annual: 120, from: 'FY26 books' })
    expect(by.get('labour')!.timing.from).toBe('books')
    expect(by.get('crop_sales')).toMatchObject({ annual: 5000 })
    expect(by.get('crop_sales')!.timing.from).toBe('assumed')
    expect(by.has('seed')).toBe(false)
  })
  it('uses the books alone when asked', () => {
    const lines = kindLines([y('FY26', 800, 120)], plan, false)
    expect(lines.find((l) => l.key === 'fertilizer')!.annual).toBe(800)
    expect(lines.some((l) => l.key === 'crop_sales')).toBe(false)
  })
})

describe('dates', () => {
  it('adds months across a year end and finds the fiscal year', () => {
    expect(addMonths('2026-11', 3)).toBe('2027-02')
    expect(fiscalEndYear('2026-10-07')).toBe(2027)
    expect(fiscalEndYear('2027-08-31')).toBe(2027)
  })
})
