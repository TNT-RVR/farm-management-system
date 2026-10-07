import { describe, expect, it } from 'vitest'
import { classifyFuel, parseDate, parseFuelSupplierInvoice } from './fuel-supplier-invoice'

// Made-up invoices in the two shapes a PDF text layer usually comes out in.
// Replace with a real Fuel supplier invoice's text once one is to hand.
const ONE_LINE_PER_ITEM = `
FUEL SUPPLIER
Invoice # 104522
Invoice Date: 2026-09-30
Due Date: 2026-10-30
Bill To: Prairie Creek Farm
Product Qty (L) Price Amount
Dyed Diesel 2,450.0 1.9873 4,868.89
Clear Diesel ULSD 600.0 2.2140 1,328.40
Regular Unleaded Gasoline 300.0 1.5990 479.70
Carbon levy 0.00
GST 5% 333.85
Total $7,010.84
`

const COLUMNS_SPLIT = `
Fuel supplier Ltd.
INVOICE
Invoice No: PF-20931
Date: Sep 12, 2026
Description
Marked Diesel - Farm
3000
1.9550
5865.00
Federal excise tax
GST
293.25
Invoice Total
6158.25
`

describe('parseFuelSupplierInvoice', () => {
  it('reads one line per product, checked by litres x price = amount', () => {
    const inv = parseFuelSupplierInvoice(ONE_LINE_PER_ITEM)
    expect(inv.invoiceNo).toBe('104522')
    expect(inv.invoiceDate).toBe('2026-09-30')
    expect(inv.total).toBe(7010.84)
    expect(inv.lines.map((l) => [l.product, l.litres, l.perL, l.amount, l.checked])).toEqual([
      ['farm_diesel', 2450, 1.9873, 4868.89, true],
      ['clear_diesel', 600, 2.214, 1328.4, true],
      ['gasoline', 300, 1.599, 479.7, true],
    ])
  })

  it('reads a line whose numbers fell onto the lines below it', () => {
    const inv = parseFuelSupplierInvoice(COLUMNS_SPLIT)
    expect(inv.invoiceNo).toBe('PF-20931')
    expect(inv.invoiceDate).toBe('2026-09-12')
    expect(inv.lines).toHaveLength(1)
    expect(inv.lines[0]).toMatchObject({ product: 'farm_diesel', litres: 3000, perL: 1.955, amount: 5865, checked: true })
    expect(inv.total).toBe(6158.25)
  })

  it('does not take a tax line for a purchase', () => {
    const inv = parseFuelSupplierInvoice('Invoice 5555\nDate 2026-01-02\nFuel tax diesel 1000 0.13 130.00\nDyed diesel 1000 1.800 1800.00')
    expect(inv.lines).toHaveLength(1)
    expect(inv.lines[0].perL).toBe(1.8)
  })

  it('falls back to a price-shaped number, and says it was not checked', () => {
    const inv = parseFuelSupplierInvoice('Invoice 77701\nDate: 2026-03-04\nDyed Diesel 1500 L @ 1.875')
    expect(inv.lines[0]).toMatchObject({ litres: 1500, perL: 1.875, checked: false })
  })
})

describe('classifyFuel', () => {
  it('puts dyed and marked before plain diesel', () => {
    expect(classifyFuel('Dyed Diesel')).toBe('farm_diesel')
    expect(classifyFuel('MARKED DIESEL')).toBe('farm_diesel')
    expect(classifyFuel('Clear Diesel ULSD')).toBe('clear_diesel')
    expect(classifyFuel('Regular Unleaded')).toBe('gasoline')
    expect(classifyFuel('Marked gasoline')).toBe('farm_gasoline')
    expect(classifyFuel('DEF 1000L tote')).toBe('other')
  })
})

describe('parseDate', () => {
  it('reads the usual forms', () => {
    expect(parseDate('2026-09-30')).toBe('2026-09-30')
    expect(parseDate('Sep 30, 2026')).toBe('2026-09-30')
    expect(parseDate('30-Sep-2026')).toBe('2026-09-30')
    expect(parseDate('30/09/2026')).toBe('2026-09-30')
    expect(parseDate('09/30/2026')).toBe('2026-09-30')
  })
})
