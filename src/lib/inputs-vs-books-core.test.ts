import { describe, expect, it } from 'vitest'
import { byVendor, compareInputs } from './inputs-vs-books-core'
import type { BooksReport } from './qb-books-core'

// Made-up figures.
const acc = (id: string, name: string, v: number) => ({ id, name, number: /^(\d{4}-\d{2})/.exec(name)?.[1] ?? null, section: 'EXPENSES', path: [], amounts: [v] })
const report: BooksReport = {
  columns: ['Total'],
  start: '2025-09-01',
  end: '2026-08-31',
  basis: 'Accrual',
  totals: {},
  accounts: [acc('1', '5010-00 Fertilizer Expense', 100_000), acc('2', '5020-00 Chemical Expense', 40_000), acc('3', '5030-01 Seed Expense', 30_000), acc('4', '5050-01 Fuel & Oil Expense', 20_000), acc('5', '6600-00 Payroll', 99_000)],
}
const costs = (fertilizer: number, chemical: number, seed: number, fuel: number) => ({ fertilizer, chemical, seed, fuel })

describe('compareInputs', () => {
  const c = compareInputs({
    report,
    overrides: new Map(),
    rows: [
      { fieldId: 'a', field: '5', crop: { name: 'Canola' }, acres: 100, costs: costs(30_000, 10_000, 8_000, 3_000) },
      { fieldId: 'b', field: '9', crop: { name: 'Corn' }, acres: 50, costs: costs(20_000, 5_000, 6_000, 2_000) },
      { fieldId: 'b', field: '9', crop: { name: 'Carrots' }, acres: 20, costs: costs(0, 0, 0, 0) },
      { fieldId: 'c', field: 'Fallow', crop: null, acres: 30, costs: costs(0, 0, 0, 0) },
    ],
    ici: [
      { field_id: 'a', amount: 28_000 },
      { field_id: 'a', amount: '1000' },
      { field_id: null, amount: 5_000 },
    ],
  })
  it('sets the books against the app by kind', () => {
    expect(c.kinds.map((k) => [k.kind, k.books, k.app, k.gap])).toEqual([
      ['fertilizer', 100_000, 50_000, 50_000],
      ['chemical', 40_000, 15_000, 25_000],
      ['seed', 30_000, 14_000, 16_000],
      ['fuel', 20_000, 5_000, 15_000],
    ])
    expect(c.accountKind.has('5')).toBe(false)
  })
  it('adds a field up across its crops, with what ICI invoiced to it', () => {
    expect(c.fields.map((f) => f.fieldId)).toEqual(['a', 'b'])
    expect(c.fields[1]).toMatchObject({ crop: 'Corn, Carrots', acres: 70, appTotal: 33_000, invoiced: null })
    expect(c.fields[0].invoiced).toBe(29_000)
  })
})

it('byVendor adds up the input lines by vendor, biggest first', () => {
  const m = byVendor(
    [
      { account_id: '1', party_name: 'Retailer A', amount: 60 },
      { account_id: '1', party_name: 'Retailer B', amount: 90 },
      { account_id: '1', party_name: 'Retailer A', amount: '50' },
      { account_id: '9', party_name: 'Elsewhere', amount: 5 },
      { account_id: '2', party_name: null, amount: 7 },
    ],
    new Map([
      ['1', 'fertilizer'],
      ['2', 'chemical'],
    ]),
  )
  expect(m.get('fertilizer')).toEqual([
    { vendor: 'Retailer A', amount: 110 },
    { vendor: 'Retailer B', amount: 90 },
  ])
  expect(m.get('chemical')).toEqual([{ vendor: '(no vendor)', amount: 7 }])
})
