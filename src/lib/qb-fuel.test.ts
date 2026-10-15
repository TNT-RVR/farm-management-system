import { describe, expect, it } from 'vitest'
import { latestQbBills, latestQbPrices, litresIn, perLIn, qbFuelKind, readQbFuelBills, withInvoiceReadings, type QbFuelLineRow } from './qb-fuel'

// Made-up lines in the shapes QuickBooks holds Fuel supplier bills in.
const line = (o: Partial<QbFuelLineRow> & { qb_id: string; txn_date: string }): QbFuelLineRow => ({
  entity: 'Bill',
  line_no: 1,
  doc_number: `D${o.qb_id}`,
  description: null,
  amount: 100,
  account_name: 'Fuel & Oil Expense',
  attachable_id: null,
  ...o,
})

describe('qbFuelKind', () => {
  it('reads the fuel a description names', () => {
    expect(qbFuelKind('Dyed Diesel')).toBe('farm_diesel')
    expect(qbFuelKind('Dyed Gas \n Provincial Tax Dyed')).toBe('farm_gasoline')
    expect(qbFuelKind('Regular Gas')).toBe('gasoline')
    expect(qbFuelKind('Clear Diesel')).toBe('clear_diesel')
  })
  it('keeps DEF, propane, lubricants, mixed and blank lines apart from fuel', () => {
    expect(qbFuelKind('DEF JUG 9.46L BO')).toBe('def')
    expect(qbFuelKind('Diesel Exhaust Fluid tote')).toBe('def')
    expect(qbFuelKind('Direct Load Propane')).toBe('propane')
    expect(qbFuelKind('Gear Oil')).toBe('other')
    expect(qbFuelKind('Chevron Delo 50/50 BO 3.785L Red')).toBe('other')
    expect(qbFuelKind('dyed gas and diesel')).toBe('mixed')
    expect(qbFuelKind('Fuel for spring')).toBe('unknown')
    expect(qbFuelKind(null)).toBe('unknown')
  })
})

describe('litresIn / perLIn', () => {
  it('reads litres bought, not pack sizes', () => {
    expect(litresIn('7,500L Dyed Diesel')).toBe(7500)
    expect(litresIn('Dyed diesel 3200.5 litres')).toBe(3200.5)
    expect(litresIn('1,250 ltr regular gas')).toBe(1250)
    expect(litresIn('DEF JUG 9.46L BO')).toBeNull()
    expect(litresIn('P66 Powertran Fluid 20L Pail')).toBeNull()
    expect(litresIn('Dyed Diesel')).toBeNull()
  })
  it('reads a written price per litre', () => {
    expect(perLIn('Dyed diesel @ $1.2345/L')).toBe(1.2345)
    expect(perLIn('gas 1.11 per litre')).toBe(1.11)
    expect(perLIn('Dyed diesel @ 1.234')).toBe(1.234)
    expect(perLIn('Dyed Diesel')).toBeNull()
  })
})

describe('readQbFuelBills', () => {
  it('prices a line that gives its litres, before GST', () => {
    const [b] = readQbFuelBills([line({ qb_id: '10', txn_date: '2030-03-01', description: '5,000L Dyed Diesel', amount: 6000 })])
    expect(b).toMatchObject({ kind: 'farm_diesel', litres: 5000, perL: 1.2, amount: 6000, docNumber: 'D10', assumedDyed: false })
  })

  it('works the litres back from a written price', () => {
    const [b] = readQbFuelBills([line({ qb_id: '11', txn_date: '2030-03-02', description: 'Regular gas @ $1.25/L', amount: 500 })])
    expect(b).toMatchObject({ kind: 'gasoline', perL: 1.25, litres: 400 })
  })

  it('takes plain "diesel" as dyed, whatever the size; clear only when it says so', () => {
    const [bulk] = readQbFuelBills([line({ qb_id: '12', txn_date: '2030-03-03', description: '4,000L Diesel', amount: 4400 })])
    expect(bulk).toMatchObject({ kind: 'farm_diesel', assumedDyed: true, perL: 1.1 })
    const [small] = readQbFuelBills([line({ qb_id: '13', txn_date: '2030-03-03', description: '500L Diesel', amount: 650 })])
    expect(small).toMatchObject({ kind: 'farm_diesel', assumedDyed: true, perL: 1.3 })
    const [clear] = readQbFuelBills([line({ qb_id: '14', txn_date: '2030-03-03', description: '500L Clear Diesel', amount: 650 })])
    expect(clear).toMatchObject({ kind: 'clear_diesel', assumedDyed: false })
    const [dyed] = readQbFuelBills([line({ qb_id: '15', txn_date: '2030-03-03', description: '500L Dyed Diesel', amount: 650 })])
    expect(dyed).toMatchObject({ kind: 'farm_diesel', assumedDyed: false })
  })

  it('folds the cents line of a bill into its fuel, and drops credits and non-fuel lines', () => {
    const bills = readQbFuelBills([
      line({ qb_id: '20', txn_date: '2030-04-01', description: '2,000L Dyed Diesel', amount: 2399.9 }),
      line({ qb_id: '20', line_no: 2, txn_date: '2030-04-01', description: '2,000L Dyed Diesel', amount: 0.1 }),
      line({ qb_id: '21', txn_date: '2030-04-02', description: 'Gear Oil', amount: 50 }),
      line({ qb_id: '22', entity: 'VendorCredit', txn_date: '2030-04-03', description: 'Dyed Diesel', amount: 80 }),
      line({ qb_id: '23', txn_date: '2030-04-04', description: null, amount: 30, account_name: 'Small Tools & Supplies' }),
    ])
    expect(bills).toHaveLength(1)
    expect(bills[0]).toMatchObject({ amount: 2400, litres: 2000, perL: 1.2 })
  })

  it('lists a bill with no litres, unpriced', () => {
    const [b] = readQbFuelBills([line({ qb_id: '30', txn_date: '2030-05-01', description: 'Dyed Gas', amount: 999, attachable_id: '777' })])
    expect(b).toMatchObject({ kind: 'farm_gasoline', perL: null, litres: null, amount: 999, attachableId: '777' })
  })

  it('refuses a price no fuel has cost', () => {
    const [b] = readQbFuelBills([line({ qb_id: '31', txn_date: '2030-05-02', description: '100L Dyed Diesel', amount: 5000 })])
    expect(b.perL).toBeNull()
  })
})

describe('withInvoiceReadings', () => {
  const bills = readQbFuelBills([
    line({ qb_id: '50', txn_date: '2030-06-01', description: null, amount: 5000, attachable_id: '900' }),
    line({ qb_id: '50', line_no: 2, txn_date: '2030-06-01', description: 'DEF JUG 9.46L BO', amount: 40 }),
    line({ qb_id: '51', txn_date: '2030-06-02', description: 'Dyed Gas', amount: 700 }),
  ])
  const read = [
    { qb_txn_ref: 'Bill:50', product: 'farm_diesel' as const, description: 'Dyed Diesel', litres: 3000, price_per_l: 1.2, amount: 3600, invoice_no: '7001', invoice_date: '2030-06-01' },
    { qb_txn_ref: 'Bill:50', product: 'farm_gasoline' as const, description: 'Dyed Gas', litres: 1400, price_per_l: 1, amount: 1400, invoice_no: '7001', invoice_date: '2030-06-01' },
  ]
  it('shows a read bill as its invoice lines, one per fuel, and keeps its other lines', () => {
    const out = withInvoiceReadings(bills, read)
    const b50 = out.filter((b) => b.qbId === '50')
    expect(b50.map((b) => [b.kind, b.litres, b.perL, b.amount, b.fromInvoice ?? false])).toEqual(
      expect.arrayContaining([
        ['farm_diesel', 3000, 1.2, 3600, true],
        ['farm_gasoline', 1400, 1, 1400, true],
        ['def', null, null, 40, false],
      ]),
    )
    expect(b50).toHaveLength(3)
    expect(b50.find((b) => b.kind === 'farm_diesel')).toMatchObject({ attachableId: '900', docNumber: '7001', assumedDyed: false })
  })
  it('leaves bills not read yet as they are', () => {
    expect(withInvoiceReadings(bills, read).find((b) => b.qbId === '51')).toMatchObject({ kind: 'farm_gasoline', perL: null })
    expect(withInvoiceReadings(bills, [])).toBe(bills)
  })
})

describe('latest per fuel', () => {
  const bills = readQbFuelBills([
    line({ qb_id: '40', txn_date: '2030-01-10', description: '3,000L Dyed Diesel', amount: 3300 }),
    line({ qb_id: '41', txn_date: '2030-02-10', description: '3,000L Dyed Diesel', amount: 3600 }),
    line({ qb_id: '42', txn_date: '2030-03-10', description: 'Dyed Diesel', amount: 4000 }),
  ])
  it('the newest priced bill sets the price; a newer unpriced one is still the latest bill', () => {
    expect(latestQbPrices(bills).get('farm_diesel')).toMatchObject({ qbId: '41', perL: 1.2 })
    expect(latestQbBills(bills).get('farm_diesel')).toMatchObject({ qbId: '42', perL: null })
  })
})
