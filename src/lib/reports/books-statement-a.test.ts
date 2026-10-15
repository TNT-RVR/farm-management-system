import { describe, expect, it } from 'vitest'
import { parseReport, type CategoryOverride } from '@/lib/qb-books-core'
import { booksStatementA, fetchedLabel, partTotal, qbInput, statementALine } from './books-statement-a'
import { PL } from './__fixtures__/qb-books'
import { longDate } from './framework'

const on = (name: string, category: Parameters<typeof statementALine>[1], section = 'EXPENSES') => statementALine({ name, section }, category)

describe('statementALine (RC4060 chapter 3)', () => {
  it('puts allowable costs on their lines', () => {
    expect(on('5010-00 Fertilizer Expense', 'fertilizer')).toMatchObject({ part: 'allowable', line: '9662' })
    expect(on('5050-00 Fuel Expense', 'fuel')).toMatchObject({ part: 'allowable', line: '9764' })
    expect(on('5705-10 Twine & Containers Expense', 'marketing')).toMatchObject({ part: 'allowable', line: '9661' })
    expect(on('5070-00 Canola Levy', 'marketing')).toMatchObject({ part: 'allowable', line: '9836' })
    expect(on('5210-02 Veterinary', 'cattle')).toMatchObject({ part: 'allowable', line: '9713' })
    expect(on('5860-00 Electricity', 'overhead')).toMatchObject({ part: 'allowable', line: '9799' })
    expect(on('6600-00 Payroll Expenses_', 'labour')).toMatchObject({ part: 'allowable', line: '9815' })
    expect(on('6600-00 Payroll Expenses_', 'labour').confirm).toMatch(/9816/)
  })
  it('keeps non-allowable costs apart', () => {
    expect(on('5811-00 Family Wages', 'labour')).toMatchObject({ part: 'non_allowable', line: '9816' })
    expect(on('5855-00 Interest on Long Term Debt', 'land')).toMatchObject({ part: 'non_allowable', line: '9805' })
    expect(on('5865-00 Property Taxes', 'land')).toMatchObject({ part: 'non_allowable', line: '9810' })
    expect(on('5400-00 Amortization Expense', 'depreciation')).toMatchObject({ part: 'non_allowable', line: '9936' })
    expect(on('5705-01 Repairs & Maintenance - Equip', 'machinery')).toMatchObject({ part: 'non_allowable', line: '9760' })
    expect(on('5705-03 Small Tools & Supplies', 'machinery')).toMatchObject({ part: 'non_allowable', line: '9820' })
    expect(on('5740-00 Custom Work', 'custom_work')).toMatchObject({ part: 'non_allowable', line: '9798' })
    expect(on('5080-00 Seed Cleaning', 'marketing')).toMatchObject({ part: 'non_allowable', line: '9798' })
    expect(on('5710-00 Land Rent', 'land_rent')).toMatchObject({ part: 'non_allowable', line: '9811' })
    expect(on('5805-01 General Insurance Expense', 'overhead')).toMatchObject({ part: 'non_allowable', line: '9804' })
    expect(on('5999-00 Something New', 'overhead')).toMatchObject({ part: 'non_allowable', line: '9896' })
  })
  it('makes seed, feed and pasture commodity purchases', () => {
    expect(on('5030-00 Seed Expense', 'seed')).toMatchObject({ part: 'purchases', line: 'by crop' })
    expect(on('5200-00 Feed Purchased', 'cattle')).toMatchObject({ part: 'purchases', line: '571 / 046' })
    expect(on('5715-00 Pasture Rent', 'land_rent')).toMatchObject({ part: 'purchases', line: '586' })
  })
  it('reads income accounts', () => {
    const inc = (name: string, section = 'INCOME') => statementALine({ name, section }, 'income')
    expect(inc('4130-00 Potato Sales')).toMatchObject({ part: 'income', line: '147' })
    expect(inc('4110-00 Canola Sales')).toMatchObject({ part: 'income', line: '010' })
    expect(inc('4300-00 Cattle Sales')).toMatchObject({ part: 'income', line: '719' })
    expect(inc('4100-00 Grain Sales')).toMatchObject({ part: 'income', line: 'code needed' })
    expect(inc('4956-00 Management Fee')).toMatchObject({ part: 'other_income', line: '9600' })
    expect(inc('4700-00 Rental Income')).toMatchObject({ part: 'left_off', line: 'T776' })
    expect(inc('4800-00 Interest Income', 'OTHER INCOME')).toMatchObject({ part: 'other_income', line: '9607' })
    expect(inc('4850-00 Crop Insurance Proceeds')).toMatchObject({ part: 'income', line: '401' })
  })
  it('leaves what was not farm production off the form', () => {
    expect(on('Cost of Goods Sold', 'not_farm', 'COST OF GOODS SOLD')).toMatchObject({ part: 'left_off', line: 'none' })
    expect(on('5825-01 Charitable Donations', 'not_farm')).toMatchObject({ part: 'left_off' })
  })
})

describe('booksStatementA', () => {
  const r = parseReport(PL)
  const sa = booksStatementA(r, new Map())
  const amount = (part: keyof typeof sa.lines, line: string) => partTotal(sa.lines[part].filter((l) => l.line === line))
  it('adds each line’s accounts, parts apart', () => {
    expect(sa.start).toBe('2025-09-01')
    expect(sa.basis).toBe('Accrual')
    expect(amount('allowable', '9815')).toBe(90_000) // payroll and the hired man's house
    expect(amount('non_allowable', '9816')).toBe(20_000)
    expect(partTotal(sa.lines.income)).toBe(880_000)
    expect(partTotal(sa.lines.other_income)).toBe(30_000)
    expect(partTotal(sa.lines.purchases)).toBe(25_000)
    expect(partTotal(sa.lines.allowable)).toBe(233_500)
    expect(partTotal(sa.lines.non_allowable)).toBe(155_000)
    expect(sa.lines.left_off.map((l) => l.line).sort()).toEqual(['T776', 'none', 'none'])
    expect(sa.net).toBe(494_500)
  })
  it('follows an owner’s category, and an income account moved to costs counts against them', () => {
    const o = new Map<string, CategoryOverride>([
      ['e14', { account_id: 'e14', category: 'crop_insurance', account_name: null, note: null }],
      ['i4', { account_id: 'i4', category: 'land_rent', account_name: null, note: null }],
    ])
    const moved = booksStatementA(r, o)
    expect(partTotal(moved.lines.allowable.filter((l) => l.line === '9665'))).toBe(10_000)
    expect(partTotal(moved.lines.non_allowable.filter((l) => l.line === '9811'))).toBe(15_000 - 12_000)
  })
})

describe('qbInput', () => {
  it('passes the note on when the books cannot be read', () => {
    expect(qbInput({ ok: false, note: 'QuickBooks not connected: figures from the app only.' })).toEqual({ ok: false, note: 'QuickBooks not connected: figures from the app only.' })
  })
  it('says when QuickBooks was read, farm time', () => {
    expect(fetchedLabel('2026-10-07T16:41:00Z')).toBe(`${longDate('2026-10-07')}, 10:41`)
    expect(fetchedLabel('2026-10-08T03:00:00Z')).toBe(`${longDate('2026-10-07')}, 21:00`)
  })
})
