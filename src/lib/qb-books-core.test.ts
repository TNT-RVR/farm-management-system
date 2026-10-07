import { describe, expect, it } from 'vitest'
import { defaultCategory, fiscalYear, fixedFromBooks, parseReport, partNote, type CategoryOverride } from './qb-books-core'

// A Profit and Loss shaped the way QuickBooks returns it. Made-up figures.
const row = (name: string, id: string, amount: number) => ({ ColData: [{ value: name, id }, { value: String(amount) }] })
const PL = {
  Header: { StartPeriod: '2025-09-01', EndPeriod: '2026-08-31', ReportBasis: 'Accrual' },
  Columns: { Column: [{ ColTitle: '', ColType: 'Account' }, { ColTitle: 'Total', ColType: 'Money' }] },
  Rows: {
    Row: [
      {
        Header: { ColData: [{ value: 'Income' }, { value: '' }] },
        Rows: {
          Row: [
            row('4130-00 Potato Sales', '1', 500_000),
            {
              Header: { ColData: [{ value: '4900-00 Other farm income', id: '2' }, { value: '' }] },
              Rows: { Row: [row('4956-00 Management Fee', '3', 30_000)] },
              Summary: { ColData: [{ value: 'Total 4900-00 Other farm income' }, { value: '30000' }] },
            },
          ],
        },
        Summary: { ColData: [{ value: 'Total Income' }, { value: '530000' }] },
      },
      {
        Header: { ColData: [{ value: 'Expenses' }, { value: '' }] },
        Rows: {
          Row: [
            row('6600-00 Payroll Expenses_', '10', 80_000),
            row('5867-00 Hired Mans House', '11', 10_000),
            {
              // A parent with postings of its own, and a child.
              Header: { ColData: [{ value: '5705-00 Repairs & Maintenance', id: '12' }, { value: '1000' }] },
              Rows: { Row: [row('5705-01 Repairs & Maintenance - Equip', '13', 40_000), row('5705-10 Twine & Containers Expense', '14', 500)] },
              Summary: { ColData: [{ value: 'Total 5705-00' }, { value: '41500' }] },
            },
            row('5855-00 Interest on Long Term Debt', '15', 20_000),
            row('5805-01 General Insurance Expense', '16', 10_000),
            row('5010-00 Fertilizer Expense', '17', 60_000),
            row('5400-00 Amortization Expense', '18', 50_000),
            row('5825-01 Charitable Donations', '19', 5_000),
            row('5999-00 Something New', '20', 700),
            row('5210-01 Salt & Mineral Expense', '21', 3_000),
          ],
        },
      },
      { Summary: { ColData: [{ value: 'Net Income' }, { value: '1' }] } },
    ],
  },
}

describe('parseReport', () => {
  const r = parseReport(PL)
  it('reads every account with its section and parents, and skips totals', () => {
    expect(r.start).toBe('2025-09-01')
    expect(r.accounts.map((a) => a.id)).toEqual(['1', '3', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20', '21'])
    expect(r.accounts.find((a) => a.id === '13')).toMatchObject({ number: '5705-01', section: 'EXPENSES', path: ['5705-00 Repairs & Maintenance'], amounts: [40_000] })
    expect(r.accounts.find((a) => a.id === '3')!.section).toBe('INCOME')
  })
})

describe('defaultCategory', () => {
  const c = (name: string, section = 'EXPENSES') => defaultCategory({ name, number: /^(\d{4}-\d{2})/.exec(name)?.[1] ?? null, section })
  it('reads the chart the way the 2026 review did', () => {
    expect(c('5867-00 Hired Mans House').category).toBe('labour')
    expect(c('5705-10 Twine & Containers Expense').category).toBe('marketing')
    expect(c('5705-03 Small Tools & Supplies').category).toBe('machinery')
    expect(c('5865-00 Property Taxes').category).toBe('land')
    expect(c('7010-00 JV (all) Crop insurance premiums').category).toBe('crop_insurance')
    expect(c('5805-03 Life insurance - non deductible').category).toBe('not_farm')
    expect(c('5320-10 Bees - other expenses').category).toBe('not_farm')
    expect(c('5861-00 CRA Interest & Penalties').category).toBe('not_farm')
    expect(c('Cost of Goods Sold', 'COST OF GOODS SOLD').category).toBe('not_farm')
    expect(c('4956-00 Management Fee', 'INCOME').category).toBe('income')
  })
  it('marks an account no rule knows', () => {
    expect(c('5999-00 Something New')).toEqual({ category: 'overhead', guessed: true })
  })
})

describe('fixedFromBooks', () => {
  const r = parseReport(PL)
  it('takes the management fee off labour and overhead by size, then the crops share', () => {
    const f = fixedFromBooks(r, new Map(), { cropShare: 0.8, takeOffFee: true })
    expect(f.parts.labour.total).toBe(90_000)
    expect(f.parts.overhead.total).toBe(10_700) // insurance + the unknown account
    expect(f.parts.machinery.total).toBe(41_000)
    expect(f.fee).toBe(30_000)
    expect(f.parts.labour.fee + f.parts.overhead.fee).toBeCloseTo(30_000, 6)
    expect(f.parts.labour.fee / f.parts.overhead.fee).toBeCloseTo(90_000 / 10_700, 6)
    expect(f.parts.land.crops).toBe(16_000)
    expect(f.parts.machinery.fee).toBe(0)
    expect(f.guessed.map((a) => a.id)).toEqual(['20'])
    expect(f.leftOut.map((o) => o.category)).toEqual(['fertilizer', 'marketing', 'cattle', 'not_farm'])
  })
  it('follows a saved category over the number', () => {
    const o = new Map<string, CategoryOverride>([['20', { account_id: '20', category: 'not_farm', account_name: null, note: null }]])
    const f = fixedFromBooks(r, o, { cropShare: 1, takeOffFee: false })
    expect(f.parts.overhead.total).toBe(10_000)
    expect(f.guessed).toEqual([])
    expect(f.fee).toBe(0)
  })
})

it('fiscalYear and partNote', () => {
  expect(fiscalYear(2026)).toEqual({ start: '2025-09-01', end: '2026-08-31', label: 'Sep 2025 – Aug 2026' })
  const r = parseReport(PL)
  expect(partNote(r.accounts.filter((a) => a.id === '10' || a.id === '11'), 'Sep 2025 – Aug 2026')).toBe(
    'QuickBooks P&L Sep 2025 – Aug 2026: payroll 80,000.00 + hired mans house 10,000.00',
  )
})
