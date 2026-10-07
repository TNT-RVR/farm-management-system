import { describe, expect, it } from 'vitest'
import { isDeleted, itemAccountsFrom, toEntityRow, toLines } from '../../netlify/shared/quickbooks-map'

// Shapes as QuickBooks Online returns them (v3 API, minorversion 75).
const bill = {
  Id: '146',
  DocNumber: 'INV10003',
  TxnDate: '2026-09-14',
  TotalAmt: 1250.5,
  Balance: 1250.5,
  CurrencyRef: { value: 'CAD', name: 'Canadian Dollar' },
  VendorRef: { value: '56', name: 'your retailer' },
  PrivateNote: 'Fall urea',
  MetaData: { CreateTime: '2026-09-14T10:00:00-07:00', LastUpdatedTime: '2026-09-15T08:30:00-07:00' },
  Line: [
    { Id: '1', LineNum: 1, Description: 'Urea 46-0-0', Amount: 1000, DetailType: 'AccountBasedExpenseLineDetail', AccountBasedExpenseLineDetail: { AccountRef: { value: '7', name: 'Fertilizer' }, ClassRef: { value: '2', name: 'Field 4' } } },
    { Id: '2', LineNum: 2, Amount: 250.5, DetailType: 'ItemBasedExpenseLineDetail', ItemBasedExpenseLineDetail: { ItemRef: { value: '11', name: 'Delivery' }, Qty: 1, UnitPrice: 250.5 } },
    { Amount: 1250.5, DetailType: 'SubTotalLineDetail', SubTotalLineDetail: {} },
  ],
}

describe('toEntityRow', () => {
  it('lifts the filterable fields out of a bill and keeps it whole', () => {
    const r = toEntityRow('9341', 'Bill', bill, 'now')
    expect(r).toMatchObject({
      realm_id: '9341',
      entity: 'Bill',
      qb_id: '146',
      txn_date: '2026-09-14',
      doc_number: 'INV10003',
      party_type: 'vendor',
      party_id: '56',
      party_name: 'your retailer',
      total: 1250.5,
      balance: 1250.5,
      currency: 'CAD',
      memo: 'Fall urea',
      qb_updated_at: '2026-09-15T08:30:00-07:00',
      refs: null,
    })
    expect(r.raw).toBe(bill)
  })
  it('reads the payee of an expense from EntityRef, whatever kind it is', () => {
    const r = toEntityRow('1', 'Purchase', { Id: '9', EntityRef: { value: '3', name: 'Kyle', type: 'Employee' }, TotalAmt: 40 })
    expect(r).toMatchObject({ party_type: 'employee', party_name: 'Kyle', total: 40 })
  })
  it('records what an attachment is attached to', () => {
    const r = toEntityRow('1', 'Attachable', {
      Id: '500',
      FileName: 'INV10003.pdf',
      AttachableRef: [{ EntityRef: { type: 'Bill', value: '146' } }, { EntityRef: { type: 'Purchase', value: '9' } }],
    })
    expect(r.refs).toEqual(['Bill:146', 'Purchase:9'])
    expect(r.name).toBe('INV10003.pdf')
  })
  it('names list entities by their own name', () => {
    expect(toEntityRow('1', 'Vendor', { Id: '56', DisplayName: 'ICI' }).name).toBe('ICI')
    expect(toEntityRow('1', 'Account', { Id: '7', Name: 'Fertilizer', FullyQualifiedName: 'Crop inputs:Fertilizer' }).name).toBe('Crop inputs:Fertilizer')
  })
})

describe('toLines', () => {
  it('drops subtotal lines and fills an item line\'s account from the item', () => {
    const items = itemAccountsFrom([{ Id: '11', ExpenseAccountRef: { value: '9', name: 'Freight' } }])
    const lines = toLines('Bill', bill, items)
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatchObject({ amount: 1000, account_name: 'Fertilizer', class_name: 'Field 4', description: 'Urea 46-0-0' })
    expect(lines[1]).toMatchObject({ amount: 250.5, item_name: 'Delivery', account_name: 'Freight', qty: 1, unit_price: 250.5 })
  })
  it('signs journal entry credits negative so a sum is the net', () => {
    const je = {
      Id: '3',
      Line: [
        { Amount: 100, DetailType: 'JournalEntryLineDetail', JournalEntryLineDetail: { PostingType: 'Debit', AccountRef: { value: '1', name: 'Fuel' } } },
        { Amount: 100, DetailType: 'JournalEntryLineDetail', JournalEntryLineDetail: { PostingType: 'Credit', AccountRef: { value: '2', name: 'Bank' } } },
      ],
    }
    expect(toLines('JournalEntry', je).map((l) => l.amount)).toEqual([100, -100])
  })
  it('uses the income account for an item sold on an invoice', () => {
    const items = itemAccountsFrom([{ Id: '4', IncomeAccountRef: { name: 'Canola sales' }, ExpenseAccountRef: { name: 'Seed' } }])
    const inv = { Id: '8', Line: [{ Amount: 5000, DetailType: 'SalesItemLineDetail', SalesItemLineDetail: { ItemRef: { value: '4', name: 'Canola' }, Qty: 100 } }] }
    expect(toLines('Invoice', inv, items)[0].account_name).toBe('Canola sales')
  })
})

it('spots a deletion in the change feed', () => {
  expect(isDeleted({ Id: '146', status: 'Deleted' })).toBe(true)
  expect(isDeleted(bill)).toBe(false)
})
