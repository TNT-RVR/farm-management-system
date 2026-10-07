import { describe, expect, it } from 'vitest'
import { groupTotal, parseReport } from '@/lib/qb-books-core'
import { balanceSheet, booksRatios, incomeStatement, lenderBooks } from './lender-books'
import { BS, PL, withoutGroups } from './__fixtures__/qb-books'
import { longDate } from './framework'

describe('incomeStatement', () => {
  const is = incomeStatement(parseReport(PL), new Map())
  it('gives income by account, the management fee as other income, costs by kind', () => {
    expect(is.income.map((x) => x.item)).toEqual(['Potato Sales', 'Grain Sales', 'Cattle Sales', 'Rental Income'])
    expect(is.otherIncome.map((x) => [x.item, x.amount])).toEqual([['Management Fee', 30_000]])
    expect(is.totalIncome).toBe(922_000)
    expect(is.expenses.find((x) => x.category === 'labour')!.amount).toBe(110_000)
    expect(is.expenses.find((x) => x.category === 'overhead')!.amount).toBe(17_000)
    expect(is.totalExpenses).toBe(413_500)
  })
  it('shows cost of goods sold and the rest that is not farm apart', () => {
    expect(is.notFarm.map((x) => [x.item, x.amount])).toEqual([
      ['Cost of goods sold', 9_000],
      ['Not farm production', 5_000],
    ])
    expect(is.totalIncome - is.totalExpenses - is.notFarmTotal).toBe(is.net)
    expect(is.net).toBe(494_500)
    expect(is.depreciation).toBe(50_000)
    expect(is.termInterest).toBe(20_000)
  })
})

describe('balanceSheet', () => {
  it('reads the groupings, with the equity no account holds', () => {
    const bs = balanceSheet(parseReport(BS))
    expect(bs.asOf).toBe('2026-08-31')
    expect([bs.currentAssets, bs.totalAssets, bs.currentLiabilities, bs.termDebt, bs.totalLiabilities, bs.equity]).toEqual([400_000, 1_000_000, 220_000, 280_000, 500_000, 500_000])
    expect(bs.equityUnlisted).toBe(199_900)
    expect(bs.currentPortion).toBe(40_000)
    expect(bs.groups.find((g) => g.key === 'BankAccounts')!.total).toBe(50_000)
  })
  it('works from the headings when the group keys are missing', () => {
    const r = parseReport(withoutGroups(BS))
    expect(groupTotal(r, 'LongTermLiabilities')).toBe(280_000)
    expect(groupTotal(r, 'AP')).toBe(80_000)
    const bs = balanceSheet(r)
    expect([bs.currentAssets, bs.currentLiabilities, bs.equity]).toEqual([400_000, 220_000, 500_000])
  })
})

describe('booksRatios', () => {
  const bs = balanceSheet(parseReport(BS))
  const is = incomeStatement(parseReport(PL), new Map())
  const v = (name: string, r = booksRatios(bs, is)) => r.find((x) => x.name === name)!.value
  it('works out the lender’s ratios', () => {
    expect(v('Working capital')).toBe(180_000)
    expect(v('Current ratio')).toBeCloseTo(400 / 220, 6)
    expect(v('Debt to asset')).toBe(0.5)
    expect(v('Debt to equity')).toBe(1)
    expect(v('Equity to asset')).toBe(0.5)
    // (net + amortization + term interest) ÷ (term interest + current portion)
    expect(v('Debt service coverage')).toBeCloseTo((494_500 + 50_000 + 20_000) / (20_000 + 40_000), 6)
  })
  it('leaves debt service coverage out with no principal in the books', () => {
    const r = booksRatios({ ...bs, currentPortion: null }, is)
    expect(v('Debt service coverage', r)).toBeNull()
    expect(r.find((x) => x.name === 'Debt service coverage')!.missing).toMatch(/loan schedules/)
  })
})

describe('lenderBooks', () => {
  it('lays out the income statement, balance sheet and ratios, marked as from QuickBooks', () => {
    const lb = lenderBooks({ pl: parseReport(PL), plFetched: '2026-10-07T16:41:00Z', bs: parseReport(BS), bsFetched: '2026-10-07T16:41:00Z', overrides: new Map(), fyLabel: 'Sep 2025 – Aug 2026' })
    expect(lb.sections.map((s) => s.title)).toEqual(['Income statement from the books, Sep 2025 – Aug 2026', `Balance sheet from the books, ${longDate('2026-08-31')}`, `Ratios from the books, ${longDate('2026-08-31')}`])
    const net = lb.sections[0].rows.find((r) => r[0] === 'Net income')!
    expect(net[2]).toBe(494_500)
    expect(lb.sections[0].rows[0][4]).toBe(`From QuickBooks, ${longDate('2026-10-07')}, 10:41`)
    const sheet = lb.sections[1].rows
    expect(sheet.find((r) => r[0] === 'Total current liabilities')![2]).toBe(220_000)
    expect(sheet.find((r) => r[1] === 'Net income and other equity with no account')![2]).toBe(199_900)
    expect(lb.meta.map((m) => m[0])).toEqual(['Net income (QuickBooks)', 'Current ratio (QuickBooks)'])
  })
  it('gives the income statement alone when there is no balance sheet', () => {
    const lb = lenderBooks({ pl: parseReport(PL), plFetched: null, bs: null, bsFetched: null, overrides: new Map(), fyLabel: 'Sep 2025 – Aug 2026' })
    expect(lb.sections).toHaveLength(1)
    expect(lb.balance).toBeNull()
  })
})

describe('balanceSheet, a company on IFRS', () => {
  // QuickBooks keys "Current Assets" OtherCurrentAssets and "Current
  // Liabilities" OtherCurrentLiabilities here: the groupings inside must not
  // be counted on top. Made-up figures.
  const acct = (name: string, id: string, v: number) => ({ ColData: [{ value: name, id }, { value: String(v) }] })
  const grp = (group: string, title: string, rows: unknown[], sum: number) => ({ group, Header: { ColData: [{ value: title }, { value: '' }] }, Rows: { Row: rows }, Summary: { ColData: [{ value: `Total ${title}` }, { value: String(sum) }] } })
  const BS = {
    Header: { EndPeriod: '2026-08-31' },
    Columns: { Column: [{ ColType: 'Account' }, { ColType: 'Money' }] },
    Rows: {
      Row: [
        grp('TotalAssets', 'Assets', [
          grp('OtherCurrentAssets', 'Current Assets', [grp('BankAccounts', 'Cash and Cash Equivalent', [acct('Chequing', '1', -100)], -100), grp('AR', 'Accounts Receivable (A/R)', [acct('Accounts Receivable', '2', 300)], 300), acct('Grain Inventory', '3', 800)], 1000),
          grp('OtherAssets', 'Non-current Assets', [grp('FixedAssets', 'Property, plant and equipment', [acct('Equipment', '4', 5000)], 5000), acct('Notes receivable', '5', 1000)], 6000),
        ], 7000),
        grp('TotalLiabilitiesAndEquity', 'Liabilities and Equity', [
          grp('Liabilities', 'Liabilities', [
            grp('OtherCurrentLiabilities', 'Current Liabilities', [grp('AP', 'Accounts Payable (A/P)', [acct('Accounts Payable', '6', 400)], 400), acct('GST Payable', '7', 100)], 500),
            grp('LongTermLiabilities', 'Non-current Liabilities', [acct('Pivot loan', '8', 4500)], 4500),
          ], 5000),
          { group: 'Equity', Header: { ColData: [{ value: 'Equity' }, { value: '' }] }, Rows: { Row: [acct('Retained Earnings', '9', 1800), { group: 'NetIncome', ColData: [{ value: 'Net Income' }, { value: '200' }] }] }, Summary: { ColData: [{ value: 'Total Equity' }, { value: '2000' }] } },
        ], 7000),
      ],
    },
  }
  it('takes the tiers from their own totals and lists each account once', () => {
    const bs = balanceSheet(parseReport(BS))
    expect(bs).toMatchObject({ currentAssets: 1000, totalAssets: 7000, currentLiabilities: 500, termDebt: 4500, totalLiabilities: 5000, equity: 2000, equityUnlisted: 200 })
    const by = Object.fromEntries(bs.groups.map((g) => [g.key, g.accounts.map((a) => a.id)]))
    expect(by).toMatchObject({ BankAccounts: ['1'], AR: ['2'], OtherCurrentAssets: ['3'], FixedAssets: ['4'], OtherAssets: ['5'], AP: ['6'], OtherCurrentLiabilities: ['7'], LongTermLiabilities: ['8'], Equity: ['9'] })
  })
})
