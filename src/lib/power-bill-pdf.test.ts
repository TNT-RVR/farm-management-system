import { describe, expect, it } from 'vitest'
import type { Word } from './ici-invoice-pdf'
import { columnLines, endMoney, isAzgardEquipmentInvoice, isAzgardRetailer, legalLand, longDate, parseBillNotice, parseEpcorBill, readPowerBillText } from './power-bill-pdf'
import { billKey, handSitePumps, noticeNote, sitePump } from '../../netlify/shared/power-bills-qb-read'

// Every account, site, meter, place and figure here is made up.

/** A page from rows of [y, [x, text]...]: each text split into words a few points apart. */
function page(rows: [number, ...[number, string][]][]): Word[] {
  const out: Word[] = []
  for (const [y, ...cells] of rows)
    for (const [x, text] of cells)
      text.split(' ').forEach((w, k) => out.push({ x: x + k * 6, y, text: w }))
  return out
}
const textOf = (pages: Word[][]) => columnLines(pages).join('\n')

const L = 75 // left column
const LI = 89 // left column, indented
const R = 340 // right column

// A two-location EPCOR bill in the 2030 style: a summary page, then a page whose
// second site starts at the foot of the left column and ends at the top of the right.
const summary = page([
  [66, [486, 'Page 1 of 3']],
  [76, [L, 'Your utilities bill']],
  [124, [L, 'Statement Date February 12, 2030']],
  [146, [L, 'EXAMPLE FARMS LTD']],
  [159, [L, 'Your account number 99990001'], [391, 'Utility Repair / Emergency Calls Only']],
  [172, [L, 'For service at 2 locations']],
  [242, [L, 'Amount of your last bill'], [284, '$234.56']],
  [275, [L, 'New charges'], [284, '$267.60']],
  [292, [92, 'Adjustments'], [284, '$1.14 CR']],
])
const detail = page([
  [81, [L, 'Your utilities bill'], [486, 'Page 2 of 3']],
  [93, [L, 'Statement Date February 12, 2030']],
  [123, [L, 'Your account number 99990001']],
  [133, [L, 'For service at 2 locations']],
  [140, [L, 'Your total adjustments'], [267, '$1.20 CR']],
  [167, [70, 'Details of your new charges for']],
  [176, [R, 'Meter: 000000000009990002']],
  [184, [R, 'Reading on Jan 19 (Actual) 1500.00']],
  [192, [70, 'NE-01-31-15-4'], [R, 'Amount used 500.00 kWh']],
  [204, [70, 'M.D. OF NOWHERE'], [R, 'Electric Energy Charges']],
  [212, [R, 'New charges based on 500.00 kWh']],
  [220, [R, 'Dec 20-Dec 31 500.00 kWh at 10.00¢ / kWh $50.00']],
  [228, [71, 'ELECTRICITY'], [R, 'Administration Charge $5.00']],
  [236, [R, 'Jan 16-Jan 19 100.00']],
  [244, [71, 'Service 1'], [R, 'MicroGen $10.00 CR']],
  [258, [71, 'Site: 0099900000011 - Irrigation Rate of Last Resort'], [R, 'Subtotal $45.00']],
  [266, [71, 'Billing period: Jan 1 to Jan 31, 2030'], [R, 'Delivery Charges']],
  [275, [71, 'Meter Readings by FortisAlberta Inc.'], [R, 'Consumption: 500.00 kWh']],
  [284, [71, 'Meter: 000000000009990001'], [R, 'Distribution Charge $10.00']],
  [292, [82, 'Reading on Jan 31 (Actual) 2000.00'], [R, 'Transmission Charge $5.00']],
  [300, [82, 'Amount used 1,000.00 kWh'], [R, 'Subtotal $15.00']],
  [310, [71, 'Electric Energy Charges'], [R, 'GST (reg.000000000RT) at 5% on $60.00 $3.00']],
  [320, [LI, 'Jan 1-Jan 31 1,000.00 kWh at 10.00¢ / kWh $100.00'], [R, 'Total for Service 2 $63.00']],
  [330, [LI, 'Administration Charge $5.00'], [R, 'Total $268.80']],
  [340, [LI, 'Subtotal $105.00'], [R, 'TOTAL $268.80']],
  [350, [71, 'Delivery Charges']],
  [360, [82, 'Consumption: 1,000.00 kWh']],
  [370, [82, 'Distribution Billing Demand 20.00 kW']],
  [380, [82, 'Contract Minimum Demand 25.00 kW']],
  [390, [82, 'New Charges:']],
  [400, [LI, 'Distribution Demand Charge $40.00']],
  [410, [LI, 'Distribution Charge $30.00']],
  [420, [LI, 'Transmission Charge $20.00']],
  [430, [LI, 'Balancing Pool Allocation Rider $2.00']],
  [440, [LI, '2030 Transmission Adjustment Rider $1.00 CR']],
  [450, [LI, 'Subtotal $91.00']],
  [460, [71, 'GST (reg.000000000RT) at 5% on $196.00 $9.80']],
  [470, [71, 'Total for Service 1 $205.80']],
  [480, [71, 'ELECTRICITY']],
  [490, [71, 'Service 2']],
  [500, [71, 'Site: 0099900000022 - Residential Rate of Last Resort']],
  [510, [71, 'Billing period: Dec 20 to Jan 19, 2030']],
  [520, [71, 'Meter Readings by FortisAlberta Inc.']],
])

describe('EPCOR bill', () => {
  const pages = [summary, detail]
  const bill = parseEpcorBill(pages)

  it('is told apart from a notice by its text', () => {
    expect(readPowerBillText(pages, textOf(pages)).kind).toBe('bill')
  })

  it('reads the account, statement date, new charges and adjustments', () => {
    expect(bill).toMatchObject({ account_number: '99990001', bill_date: '2030-02-12', total: 267.6, adjustments: -1.2, period_start: '2029-12-20', period_end: '2030-01-31' })
    expect(bill.warnings).toEqual([])
  })

  it('reads a site whole from the left column', () => {
    expect(bill.sites[0]).toEqual({
      site_id: '0099900000011',
      meter_number: '9990001',
      site_name: 'NE-01-31-15-4, M.D. OF NOWHERE',
      legal_land: 'NE 1-31-15 W4',
      rate_class: 'Irrigation Rate of Last Resort',
      period_start: '2030-01-01',
      period_end: '2030-01-31',
      kwh: 1000,
      // Distribution billing demand ranks above the contract minimum.
      demand_kw: 20,
      demand_unit: 'kW',
      energy_charge: 100,
      delivery_charge: 50,
      demand_charge: 40,
      // Administration 5.00 + riders 1.00.
      other_charges: 6,
      riders: 1,
      gst: 9.8,
      total: 205.8,
    })
  })

  it('follows a site from the foot of the left column to the top of the right', () => {
    expect(bill.sites).toHaveLength(2)
    expect(bill.sites[1]).toMatchObject({
      site_id: '0099900000022',
      meter_number: '9990002',
      // The billing period crosses the new year.
      period_start: '2029-12-20',
      period_end: '2030-01-19',
      kwh: 500,
      demand_kw: null,
      energy_charge: 50,
      delivery_charge: 15,
      demand_charge: null,
      // Administration 5.00, micro-generation credit 10.00; the bare date line is not a charge.
      other_charges: -5,
      riders: null,
      gst: 3,
      total: 63,
    })
  })

  it('says when a site does not add up', () => {
    const broken = page([
      [93, [L, 'Statement Date March 3, 2030']],
      [123, [L, 'Your account number 99990001']],
      [258, [71, 'Site: 0099900000011 - Farm Rate of Last Resort']],
      [270, [71, 'Electric Energy Charges']],
      [280, [LI, 'Mar 1-Mar 31 10.00 kWh at 10.00¢ / kWh $1.00']],
      [290, [LI, 'Subtotal $2.00']],
      [300, [71, 'Total $2.00']],
    ])
    const b = parseEpcorBill([broken])
    expect(b.sites).toHaveLength(1)
    expect(b.warnings.join(' ')).toMatch(/energy lines 1\.00 ≠ subtotal 2\.00/)
    expect(b.warnings.join(' ')).toMatch(/no kWh|No new-charges/)
  })

  it('reads the older single-location layout, with its unsigned amounts', () => {
    const old = page([
      [55, [L, 'Statement Date May 10, 2030']],
      [85, [L, 'Your account number 99990002']],
      [96, [L, 'For service at SW-04-34-18-4']],
      [106, [127, 'M.D. OF NOWHERE']],
      [140, [L, 'Details of your previous payments'], [352, 'Transmission Charge'], [526, '10.00']],
      [153, [352, 'A1 Rider'], [531, '0.50']],
      [165, [352, 'Subtotal of Delivery Charges'], [518, '$30.50']],
      [177, [L, 'New charges 82.00'], [335, 'GST (reg. 000000000RT) at 5% on $80.00'], [531, '4.00']],
      [188, [335, 'Your total electricity charges'], [513, '$84.00']],
      [199, [L, 'Your total adjustments'], [267, '$2.00 CR'], [336, 'TOTAL NEW CHARGES'], [513, '$84.00']],
      [315, [L, 'ELECTRICITY']],
      [325, [L, 'Site: 0099900000033 - A1 RESIDENTIAL RRO']],
      [333, [L, 'Billing period: Apr 1 to Apr 29, 2030']],
      [359, [L, 'Meter: 000000000009990003']],
      [387, [86, 'Amount of electric energy you used 400.00 kWh']],
      [404, [L, 'Electric Energy Charges']],
      [441, [92, 'Apr 1-Apr 29 400.00 kWh at 10.00¢ / kWh $40.00']],
      [452, [92, 'Administration Charge 9.50']],
      [463, [92, 'Subtotal of Electric Energy Charges $49.50']],
      [483, [L, 'Delivery Charges']],
      [502, [85, 'Consumption: 400.00 kWh']],
      [526, [92, 'Distribution Charge 20.00']],
    ])
    const b = parseEpcorBill([old])
    expect(b.warnings).toEqual([])
    expect(b.total).toBe(82)
    expect(b.sites).toEqual([
      expect.objectContaining({
        site_id: '0099900000033',
        site_name: 'SW-04-34-18-4, M.D. OF NOWHERE',
        legal_land: 'SW 4-34-18 W4',
        kwh: 400,
        energy_charge: 40,
        delivery_charge: 30,
        other_charges: 10,
        riders: 0.5,
        gst: 4,
        total: 84,
      }),
    ])
  })
})

describe('notices', () => {
  const fwd = (body: string) => `Someone\n---------- Forwarded message ---------\nFrom: <no-reply@epcor.com>\nDate: Tue, Sep 13, 2030 at 7:04 PM\nSubject: Something\n${body}`

  it('reads an ebill email: amount, due date, masked account', () => {
    const n = parseBillNotice(fwd('Your September ebill is ready.\nYour payment will be processed on the due date below.\nAccount Number *****001\nBill Amount 1,234.56\nDue Date 2030-Oct-03'))
    expect(n).toEqual({ kind: 'notice', what: 'ebill', retailer: 'EPCOR Energy', account_number: '*****001', bill_date: '2030-09-13', total: 1234.56, due_date: '2030-10-03' })
  })

  it('reads a payment receipt', () => {
    const n = parseBillNotice(fwd('Your automatic withdrawal for EPCOR account number 99990001 in the amount of $12.34\nwas received on 8/2/2030. Thank you'))
    expect(n).toMatchObject({ what: 'receipt', account_number: '99990001', bill_date: '2030-08-02', total: 12.34 })
  })

  it('reads a payment reminder', () => {
    const n = parseBillNotice(fwd('your automatic withdrawal for EPCOR account number 99990001 is\ncoming up. Your payment of $567.89 is scheduled to be withdrawn via ****0000 on\n2030/07/04.'))
    expect(n).toMatchObject({ what: 'reminder', total: 567.89, due_date: '2030-07-04' })
  })

  it('reads a card receipt from another retailer', () => {
    const n = parseBillNotice(
      'Someone\n---------- Forwarded message ---------\nFrom: OptionPay <user-0627@example.com>\nDate: Tue, Nov 18, 2030 at 3:14 PM\nSubject: EQUS REA LTD - Transaction #1\nTransaction Receipt\nTransaction Date: 11/18/2030 03:13 pm\nPayment Card Amount: $12.34\nAccount #: 99.01',
    )
    expect(n).toMatchObject({ what: 'receipt', retailer: 'EQUS REA', account_number: '99.01', bill_date: '2030-11-18', total: 12.34 })
  })

  it('is not a bill or notice when it is neither', () => {
    expect(readPowerBillText([], 'Statement\nCURRENT NATURAL GAS CHARGES 12.34\nSite ID 0000000000000\nEnergy Used (GJ) 1.0 kWh')).toEqual({ kind: 'other', looksLikePower: false })
    expect(readPowerBillText([], 'Invoice\nSite ID 0000000000000\nMeter 123\nEnergy 1,000 kWh')).toEqual({ kind: 'other', looksLikePower: true })
  })

  it('writes a short note for the bill', () => {
    expect(noticeNote({ kind: 'notice', what: 'ebill', retailer: 'EPCOR Energy', account_number: null, bill_date: null, total: 123.45, due_date: '2030-10-03' })).toBe(
      'EPCOR Energy ebill email: $123.45 due 2030-10-03. The bill itself is not attached in QuickBooks.',
    )
  })
})

describe('helpers', () => {
  it('reads amounts, credits and dates', () => {
    expect(endMoney('Subtotal 1,234.56')).toEqual({ label: 'Subtotal', value: 1234.56 })
    expect(endMoney('A1 Rider $0.50 CR')).toEqual({ label: 'A1 Rider', value: -0.5 })
    expect(endMoney('Payments $-12.00')?.value).toBe(-12)
    expect(endMoney('Reading on Jan 1')).toBeNull()
    expect(longDate('Statement Date February 12, 2030')).toBe('2030-02-12')
    expect(legalLand('SE-05-40-25-4')).toBe('SE 5-40-25 W4')
    expect(legalLand('135 TOWNSHIP ROAD 1')).toBeNull()
  })

  it('keys a bill by its account and statement date', () => {
    expect(billKey({ account_number: '0099990001', bill_date: '2030-02-12' })).toBe('epcor:99990001:2030-02-12')
    expect(billKey({ account_number: null, bill_date: '2030-02-12' })).toBeNull()
  })

  it('puts a site on a pump by its meter, its quarter, or a site ID set by hand', () => {
    const pumps = [
      { id: 'p1', name: 'Pump One', power_meter_number: '9990001', legal_land: 'NE 1-31-15' },
      { id: 'p2', name: 'Pump Two', power_meter_number: null, legal_land: 'SW 4-34-18' },
      { id: 'p3', name: 'Pump Three', power_meter_number: null, legal_land: null },
    ]
    type Site = Parameters<typeof sitePump>[0]
    const site = { site_id: '0099900000011', meter_number: '9990001', site_name: null, legal_land: null, rate_class: 'Irrigation' } as Site
    const s = (x: Partial<Site>): Site => ({ ...site, ...x })
    const none = new Map<string, string>()
    expect(sitePump(s({}), pumps, none)).toEqual({ pumpId: 'p1', pumpName: 'Pump One', by: 'meter' })
    expect(sitePump(s({ meter_number: '1112223', legal_land: 'SW 4-34-18 W4' }), pumps, none)).toMatchObject({ pumpId: 'p2', by: 'land' })
    // A house on a pump's quarter is not the pump.
    expect(sitePump(s({ meter_number: '1112223', legal_land: 'SW 4-34-18 W4', rate_class: 'Residential' }), pumps, none).pumpId).toBeNull()
    expect(sitePump(s({ meter_number: '1112223', site_id: '0099900000044' }), pumps, new Map([['99900000044', 'p3']]))).toMatchObject({ pumpId: 'p3', by: 'site' })
  })

  it('takes a site ID set by hand to its pump, unless it was put on two', () => {
    const row = (site_id: string, pump_id: string, by = true, unconfirmed = false) => ({ site_id, pump_id, pump_set_by_hand: by, pump_unconfirmed: unconfirmed })
    const m = handSitePumps([
      row('0099900000011', 'p1'),
      row('99900000011', 'p1'),
      row('0099900000022', 'p2'),
      row('0099900000022', 'p3'),
      row('0099900000033', 'p4', false),
      row('0099900000044', 'p5', true, true),
    ])
    expect([...m]).toEqual([['99900000011', 'p1']])
  })

  it('tells an Azgard Solar equipment invoice from a power bill', () => {
    // Made up, in the shape of the solar supplier's invoice: item lines, no energy.
    const text = [
      'To: Example Farms Ltd. Remit to: Ship to: Date: March 3, 2030',
      'Azgard Solar Inc. Invoice No.: 2030-0001',
      'I N V O I C E',
      'Item Description Quantity Unit Price Amount',
      '1 Solar Modules and Racking 2 $ 100.00 $ 200.00',
      'Subtotal: $ 200.00',
      'Plus: GST @ 5% $ 10.00',
      'TOTAL : $ 210.00',
    ].join('\n')
    expect(isAzgardEquipmentInvoice(text)).toBe(true)
    expect(readPowerBillText([], text)).toEqual({ kind: 'other', looksLikePower: false, note: expect.stringMatching(/equipment invoice/) })
    // A power bill that names Azgard is not one.
    expect(isAzgardEquipmentInvoice(`${text}\nSite ID 0099900000011 Energy 120 kWh`)).toBe(false)
    expect(isAzgardRetailer('Azgard Solar / UtilNet')).toBe(true)
    expect(isAzgardRetailer('UTILNET')).toBe(true)
    expect(isAzgardRetailer('EPCOR Energy')).toBe(false)
    expect(isAzgardRetailer(null)).toBe(false)
  })
})
