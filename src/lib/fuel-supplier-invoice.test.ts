import { describe, expect, it } from 'vitest'
import { classifyFuel, dieselAssumedDyed, parseDate, parseFuelSupplierInvoice } from './fuel-supplier-invoice'

// Made-up invoices in the two loose shapes a PDF text layer can come out in,
// for an invoice not in the printed-table layout (read below).
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

// Made-up invoices in the layout the supplier's billing software prints (a
// QuickBooks Online invoice): wrapped activity names, the activity repeated as
// the description, a tax row with no date of its own. Every name and figure
// here is invented.
const TABLE_MONTH_FIRST = `
Overdue accounts are subject to an interest charge from the invoice date at a rate of 18% per annum.
Page 1 of 1
Example Fuels Ltd.
1 Main St
GST/HST Registration No.: 123456789
INVOICE
BILL TO
EXAMPLE FARM LTD
INVOICE 5001
DATE 07/04/2030
TERMS Net 30
DUE DATE 08/03/2030
DATE ACTIVITY DESCRIPTION QTY RATE AMOUNT
07/04/2030 Dyed Diesel 5,000 1.50 7,500.00
Provincial Tax Dyed
Diesel
5,000 0.05 250.00
For Credit Card Payments please click on the link below or call the Office
at 000-000-0000 000000-00
SUBTOTAL 7,750.00
GST @ 5% 387.50
TOTAL 8,137.50
BALANCE DUE CAD 8,137.50
`

const TABLE_DAY_FIRST = `
Page 1 of 1
Example Fuels
GST/HST Registration No.: 123456789
INVOICE
INVOICE 1200
DATE 03/02/2030
TERMS Net 30
DUE DATE 05/03/2030
DATE ACTIVITY DESCRIPTION QTY RATE AMOUNT
03/02/2030 Dyed Diesel 1234 2,000.50 1.10 2,200.55
03/02/2030 Federal Excise Tax
Dyed Diesel
Federal Excise Tax Dyed Diesel 2,000.50 0.03 60.02
03/02/2030 Dyed Gas 1,000 0.90 900.00
03/02/2030 Federal Excise Tax
Dyed Gas
Federal Excise Tax Dyed Gas 1,000 0.08 80.00
03/02/2030 DIESEL ENGINE OIL 15W40
208L Drum
DIESEL ENGINE OIL 15W40 208L Drum 1 900.00 900.00
SUBTOTAL 4,140.57
GST @ 5% 207.03
TOTAL 4,347.60
`

describe('parseFuelSupplierInvoice: the printed table', () => {
  it('reads a fuel row and folds its per-litre tax into a delivered $/L before GST', () => {
    const inv = parseFuelSupplierInvoice(TABLE_MONTH_FIRST)
    expect(inv).toMatchObject({ layout: 'table', invoiceNo: '5001', invoiceDate: '2030-07-04', dueDate: '2030-08-03', subtotal: 7750, gst: 387.5, total: 8137.5, warnings: [] })
    expect(inv.rows.map((r) => [r.kind, r.text])).toEqual([
      ['fuel', 'Dyed Diesel'],
      ['fuel_tax', 'Provincial Tax Dyed Diesel'],
    ])
    expect(inv.lines).toEqual([
      {
        lineNo: 1,
        product: 'farm_diesel',
        description: 'Dyed Diesel',
        litres: 5000,
        perL: 1.55,
        amount: 7750,
        fuelAmount: 7500,
        taxes: [{ name: 'Provincial Tax Dyed Diesel', amount: 250 }],
        checked: true,
      },
    ])
  })

  it('reads day-first dates by the due date, two fuels with their own taxes, and leaves oil out', () => {
    const inv = parseFuelSupplierInvoice(TABLE_DAY_FIRST)
    expect(inv.invoiceDate).toBe('2030-02-03')
    expect(inv.dueDate).toBe('2030-03-05')
    expect(inv.warnings).toEqual([])
    expect(inv.rows.map((r) => r.kind)).toEqual(['fuel', 'fuel_tax', 'fuel', 'fuel_tax', 'other'])
    expect(inv.rows[4].text).toBe('DIESEL ENGINE OIL 15W40 208L Drum')
    expect(inv.lines.map((l) => [l.lineNo, l.product, l.litres, l.perL, l.amount, l.checked])).toEqual([
      [1, 'farm_diesel', 2000.5, 1.13, 2260.57, true],
      [2, 'farm_gasoline', 1000, 0.98, 980, true],
    ])
  })

  it('uses the bill date to settle a date that reads both ways, when there are no terms', () => {
    const t = 'INVOICE 42\nDATE 05/06/2030\nDATE ACTIVITY DESCRIPTION QTY RATE AMOUNT\n05/06/2030 Dyed Gas 100 1.00 100.00\nSUBTOTAL 100.00'
    expect(parseFuelSupplierInvoice(t).invoiceDate).toBe('2030-05-06')
    expect(parseFuelSupplierInvoice(t, { hintDate: '2030-06-05' }).invoiceDate).toBe('2030-06-05')
  })

  it('says so when the rows do not add up to the subtotal, and marks the lines unchecked', () => {
    const t = 'INVOICE 43\nDATE 2030-01-02\nDATE ACTIVITY DESCRIPTION QTY RATE AMOUNT\n2030-01-02 Diesel 1,000 1.20 1,200.00\nSUBTOTAL 1,300.00'
    const inv = parseFuelSupplierInvoice(t)
    expect(inv.warnings).toHaveLength(1)
    expect(inv.lines[0]).toMatchObject({ product: 'farm_diesel', perL: 1.2, checked: false })
  })

  it('finds no fuel on an invoice of lubricants and jugs', () => {
    const t =
      'INVOICE 44\nDATE 2030-01-03\nDATE ACTIVITY DESCRIPTION QTY RATE AMOUNT\n2030-01-03 SAMPLE 50/50 BO 3.785L Red\nSAMPLE 50/50 BO 3.785L Red\n4 10.00 40.00\n2030-01-03 DEF JUG 9.46L 2 10.00 20.00\nSUBTOTAL 60.00'
    const inv = parseFuelSupplierInvoice(t)
    expect(inv.rows).toHaveLength(2)
    expect(inv.rows[0].text).toBe('SAMPLE 50/50 BO 3.785L Red')
    expect(inv.lines).toEqual([])
    expect(inv.warnings).toEqual([])
  })
})

describe('classifyFuel', () => {
  it('puts dyed and marked before plain diesel', () => {
    expect(classifyFuel('Dyed Diesel')).toBe('farm_diesel')
    expect(classifyFuel('MARKED DIESEL')).toBe('farm_diesel')
    expect(classifyFuel('Clear Diesel ULSD')).toBe('clear_diesel')
    expect(classifyFuel('Regular Unleaded')).toBe('gasoline')
    expect(classifyFuel('Marked gasoline')).toBe('farm_gasoline')
    expect(classifyFuel('Dyed Gas')).toBe('farm_gasoline')
    expect(classifyFuel('DEF 1000L tote')).toBe('other')
  })
  it('takes any diesel as dyed unless it says clear, undyed or on-road', () => {
    expect(classifyFuel('Diesel')).toBe('farm_diesel')
    expect(classifyFuel('ULSD')).toBe('farm_diesel')
    expect(classifyFuel('Undyed diesel')).toBe('clear_diesel')
    expect(classifyFuel('On-road diesel')).toBe('clear_diesel')
    expect(dieselAssumedDyed('Diesel')).toBe(true)
    expect(dieselAssumedDyed('Dyed Diesel')).toBe(false)
    expect(dieselAssumedDyed('Clear Diesel')).toBe(false)
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
  it('reads slashes day-first when told to', () => {
    expect(parseDate('05/06/2030')).toBe('2030-05-06')
    expect(parseDate('05/06/2030', 'dmy')).toBe('2030-06-05')
    expect(parseDate('30/09/2026', 'mdy')).toBe('2026-09-30')
  })
})
