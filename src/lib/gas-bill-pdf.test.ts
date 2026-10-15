import { describe, expect, it } from 'vitest'
import type { Word } from './ici-invoice-pdf'
import { chargeKind, gasLegalLand, mdyDate, parseGasNotice, readGasBillText } from './gas-bill-pdf'
import { gasBillKey, gasNoticeNote, matchPin, placeKind } from '../../netlify/shared/gas-bills-qb-read'

// Every account, site, meter, place and figure here is made up.

/** A page from rows of [y, [x, text]...]: each text split into words a few points apart. */
function page(rows: [number, ...[number, string][]][]): Word[] {
  const out: Word[] = []
  for (const [y, ...cells] of rows)
    for (const [x, text] of cells)
      text.split(' ').forEach((w, k) => out.push({ x: x + k * 6, y, text: w }))
  return out
}
const textOf = (pages: Word[][]) => pages.map((p) => [...new Set(p.map((w) => w.y))].map((y) => p.filter((w) => w.y === y).map((w) => w.text).join(' ')).join('\n')).join('\n')

const R = 223 // the charges column of a classic site page
const A = 540 // its amounts

// ── The classic layout ──────────────────────────────────────────────────────
const summary = (charges: string, gst: string, budget = false) =>
  page([
    [60, [511, 'Page 1 of 4']],
    [119, [52, 'Account Number: 999900001'], [380, 'Statement Date: Feb 15 2030']],
    [229, [58, 'Previous Balance'], [427, '90.00']],
    [269, [58, 'CURRENT NATURAL GAS CHARGES'], [427, charges], [532, charges]],
    ...(budget ? ([[282, [58, 'BUDGET AMOUNT DUE'], [528, charges]]] as [number, ...[number, string][]][]) : []),
    [297, [58, `TOTAL GST AMOUNT $${gst} (GST#000000000)`]],
  ])

const sitePage = (cancel = false) =>
  page([
    [18, [509, 'Page 3 of 4']],
    [91, [75, 'RETAILER CHARGES Natural Gas Site ID 0009990000011']],
    [112, [43, 'NE 1 31 15W4 MD OF NOWHERE AB']],
    [137, [R, 'From To Energy Used (GJ)']],
    [143, [75, 'GJ Consumption by Billing Cycle']],
    [151, [217, 'Jan 11'], [270, 'Jan 31'], [377, '6.00']],
    [157, [76, '40']],
    [166, [217, 'Jan 31'], [270, 'Feb 09'], [377, '4.00']],
    [181, [417, 'Energy Rate ($/GJ) Energy Charge ($)']],
    [192, [76, '30'], [360, '6.00 x 4.000000 ='], [559, '24.00']],
    [205, [364, '4.00 x 4.000000 ='], [559, '16.00']],
    [233, [213, 'Current Energy Charges']],
    [245, [R, 'Administration Fee - Fixed'], [A, '10.00']],
    [256, [R, 'Cost of Gas - Variable'], [A, '40.00']],
    [264, [76, '10'], [232, 'Sub-Total']],
    [268, [A, '50.00']],
    [277, [R, 'GST'], [A, '2.50']],
    [289, [80, '0'], [213, 'CURRENT ENERGY BILLING'], [A, '52.50']],
    ...(cancel ? ([[355, [210, 'Feb 15 Cancel For Dec 30 -Jan 11 (Inc GST of $1.00)'], [A, '21.00 CR']]] as [number, ...[number, string][]][]) : []),
    [381, [75, 'DISTRIBUTOR AND GOVERNMENT CHARGES Natural Gas Site ID 0009990000011']],
    [403, [45, 'NE 1 31 15W4 MD OF NOWHERE AB']],
    [428, [46, 'Distribution services provided by:'], [R, 'From To Energy Used (GJ)']],
    [442, [46, 'ATCO Gas South'], [217, 'Jan 11'], [270, 'Feb 09'], [374, '10.00']],
    [473, [213, 'Current Distributor Charges']],
    [484, [R, 'Delivery Charge - Fixed'], [A, '25.00']],
    [492, [49, 'Meter: T00000-X00001'], [R, 'Delivery Charge - Variable']],
    [496, [A, '10.00']],
    [508, [154, 'Reading'], [R, 'Rate Riders'], [A, '5.00']],
    [517, [R, 'Federal Carbon Tax'], [A, '10.00']],
    [527, [52, 'Conversion Factor 1.0100000'], [232, 'Sub-Total'], [A, '50.00']],
    [538, [R, 'GST'], [A, '2.50']],
    [550, [213, 'CURRENT DISTRIBUTOR BILLING'], [A, '52.50']],
    [555, [52, 'Actual Feb 09 500']],
    [601, [221, 'Total Charges for Site 0009990000011'], [521, cancel ? '84.00' : '105.00']],
  ])

describe('the classic Direct Energy bill', () => {
  it('reads each site off the right-hand column, checked against its sub-totals', () => {
    const pages = [summary('105.00', '5.00'), sitePage()]
    const r = readGasBillText(pages, textOf(pages))
    expect(r.kind).toBe('bill')
    if (r.kind !== 'bill') return
    expect(r).toMatchObject({ layout: 'classic', account_number: '999900001', bill_date: '2030-02-15', total: 105, budget: false, gst: 5, warnings: [] })
    expect(r.sites).toHaveLength(1)
    expect(r.sites[0]).toMatchObject({
      site_id: '0009990000011',
      address: 'NE 1 31 15W4 MD OF NOWHERE AB',
      legal_land: 'NE 1-31-15 W4',
      meter_number: 'T00000-X00001',
      distributor: 'ATCO Gas South',
      period_start: '2030-01-11',
      period_end: '2030-02-09',
      gj: 10,
      conversion_factor: 1.01,
      meter_reading: 500,
      energy_charge: 40,
      admin_fee: 10,
      delivery_fixed: 25,
      delivery_variable: 10,
      riders: 5,
      carbon_levy: 10,
      other_charges: null,
      retail_subtotal: 50,
      distribution_subtotal: 50,
      gst: 5,
      total: 105,
    })
    // The GJ × rate lines are the cost of gas worked out, not charges of their own.
    expect(r.sites[0].lines.map((l) => l.label)).not.toContain('6.00 x 4.000000 =')
  })

  it('on a budget plan, checks the GST, not the plan amount', () => {
    const pages = [summary('80.00', '5.00', true), sitePage()]
    const r = readGasBillText(pages, textOf(pages))
    expect(r.kind === 'bill' && r.budget).toBe(true)
    expect(r.kind === 'bill' && r.warnings).toEqual([])
    const off = [summary('80.00', '4.00', true), sitePage()]
    const w = readGasBillText(off, textOf(off))
    expect(w.kind === 'bill' && w.warnings).toEqual(["Sites' GST 5.00 ≠ the bill's GST 4.00"])
  })

  it('says when the sites do not add up to the current charges', () => {
    const pages = [summary('100.00', '5.00'), sitePage()]
    const r = readGasBillText(pages, textOf(pages))
    expect(r.kind === 'bill' && r.warnings).toEqual(['Sites 105.00 ≠ current charges 100.00'])
  })

  it('takes a corrected bill’s cancelled days into its total and GST', () => {
    const pages = [summary('84.00', '4.00'), sitePage(true)]
    const r = readGasBillText(pages, textOf(pages))
    if (r.kind !== 'bill') throw new Error('not a bill')
    expect(r.warnings).toEqual([])
    expect(r.sites[0]).toMatchObject({ rebilled_start: '2029-12-30', rebilled_end: '2030-01-11', rebilled_charges: -20, gst: 4, total: 84 })
  })
})

// ── The 2026 layout ─────────────────────────────────────────────────────────
const L = 40
const lines2026 = (siteTotal = '73.50') =>
  page(
    (
      [
        'ADJUSTED INVOICE',
        'Account number 999900002',
        'Invoice number 123456789',
        'EXAMPLE FARMS LTD Billing date: Feb 18, 2030',
        'Statement Date Feb 18, 2030',
        'Total retailer gas charges (inc. GST 2.00) 42.00',
        'Total distribution gas charges (inc. GST 1.50) 31.50',
        'Current charges 73.50',
        'Total GST Amount $3.50 (GST #000000000)',
        'Location Summary',
        'NE 1 31 15 W4 MD OF NOWHERE AB 10.00 73.50',
        'Natural gas charges for site ID 0009990000022 | NE 1 31 15 W4 MD OF NOWHERE AB',
        'Consumption period 12/08/2029 To 02/09/2030 REFERENCE NUMBER',
        'Retailer charges - Direct Energy',
        'From To Status Energy used (GJ) Energy rate ($/GJ) Energy charges ($)',
        '12/08/2029 12/31/2029 Cancelled -5.00 3.000000 15.00 CR',
        '12/08/2029 12/31/2029 Replacement 6.00 3.000000 18.00',
        '01/11/2030 02/09/2030 Current 9.00 3.000000 27.00',
        'Current energy charges',
        'Administration Fee 10.00',
        'Cost of Gas - Variable 30.00',
        'Sub-total 40.00',
        'GST 2.00',
        'Total gas charges 42.00',
        'Distributor and government charges - charged by ATCO Gas South | Meter number T00000-X00002',
        'Current energy Meter reading Conversion Last actual meter Last actual',
        'used (GJ) date factor reading reading date',
        '10.00 02/09/2030 1.020000000 500 02/09/2030',
        'Cancel/rebill distributor adjustments',
        '12/08/2029 01/11/2030 Cancelled 5.00 CR',
        'Current distributor and government charges',
        'Delivery Charge - Fixed 20.00',
        'Delivery Charge - Variable 5.00',
        'Rate Riders 5.00',
        'Sub-total 30.00',
        'GST 1.50',
        'Total distributor and government charges 31.50',
        `Total current charges for site 0009990000022 ${siteTotal}`,
      ] as string[]
    ).map((t, k) => [100 + k * 12, [L, t]] as [number, [number, string]]),
  )

describe('the 2026 Direct Energy bill', () => {
  it('reads each site, its GJ net of a cancelled estimate, and checks it', () => {
    const pages = [lines2026()]
    const r = readGasBillText(pages, textOf(pages))
    if (r.kind !== 'bill') throw new Error('not a bill')
    expect(r).toMatchObject({ layout: '2026', account_number: '999900002', invoice_number: '123456789', bill_date: '2030-02-18', total: 73.5, gst: 3.5, adjusted: true, warnings: [] })
    expect(r.sites[0]).toMatchObject({
      site_id: '0009990000022',
      legal_land: 'NE 1-31-15 W4',
      meter_number: 'T00000-X00002',
      distributor: 'ATCO Gas South',
      period_start: '2029-12-08',
      period_end: '2030-02-09',
      gj: 10,
      conversion_factor: 1.02,
      meter_reading: 500,
      energy_charge: 30,
      admin_fee: 10,
      delivery_fixed: 20,
      delivery_variable: 5,
      riders: 5,
      carbon_levy: null,
      gst: 3.5,
      total: 73.5,
    })
    // The cancel/rebill lines are in the printed figures already, not charges of their own.
    expect(r.sites[0].lines).toHaveLength(5)
  })

  it('says when a site does not add up', () => {
    const pages = [lines2026('80.00')]
    const r = readGasBillText(pages, textOf(pages))
    expect(r.kind === 'bill' && r.warnings).toContain('Site 1 (0022): 70.00 + GST 3.50 ≠ total 80.00')
  })
})

describe('a forwarded notice', () => {
  const email = [
    'Example Person, CPA',
    '---------- Forwarded message ---------',
    'From: Direct Energy Regulated Services <someone@example.com>',
    'Date: Tue, Dec 19, 2030 at 12:31 PM',
    'Subject: Your December Bill is Available',
    'Customer Account Number: 999900003 | View your account »',
    'Total Amount Due Late Payment Penalty',
    'Date',
    '$123.45',
    'January 7, 2031',
    'Thank you! You are enrolled in Auto Pay.',
  ].join('\n')

  it('is its amount, account, day and due date', () => {
    expect(parseGasNotice(email)).toEqual({
      kind: 'notice',
      what: 'ebill',
      retailer: 'Direct Energy Regulated Services',
      account_number: '999900003',
      bill_date: '2030-12-19',
      total: 123.45,
      due_date: '2031-01-07',
    })
    expect(readGasBillText([], email).kind).toBe('notice')
  })

  it('is not someone else’s email', () => {
    expect(parseGasNotice(email.replace(/Direct Energy Regulated Services/g, 'Some Utility'))).toBeNull()
  })
})

describe('the small parts', () => {
  it('reads dates, legal land and charge kinds', () => {
    expect(mdyDate('01/31/2030')).toBe('2030-01-31')
    expect(gasLegalLand('SW 22 38 20W4 MD OF NOWHERE')).toBe('SW 22-38-20 W4')
    expect(gasLegalLand('123 TWP RD 4.5 MD OF NOWHERE')).toBeNull()
    expect(chargeKind('retail', 'Rider C6')).toBe('rider')
    expect(chargeKind('distribution', 'Federal Carbon Tax')).toBe('carbon')
    expect(chargeKind('distribution', 'Municipal Franchise Fee')).toBe('other')
  })

  it('leaves a bill in another layout alone', () => {
    expect(readGasBillText([], 'Your utilities bill\nStatement Date February 12, 2030\nSite: 0099900000011')).toEqual({ kind: 'other', looksLikeGas: false })
    expect(readGasBillText([], 'Some Gas Co\nNatural gas used 5.0 GJ')).toEqual({ kind: 'other', looksLikeGas: true })
  })
})

describe('the reader’s rules', () => {
  it('keys a bill by its account and statement date', () => {
    expect(gasBillKey({ account_number: '0099900001', bill_date: '2030-02-15' })).toBe('de:99900001:2030-02-15')
    expect(gasBillKey({ account_number: null, bill_date: '2030-02-15' })).toBeNull()
  })

  it('names a place’s kind', () => {
    expect(placeKind('Main Shop')).toBe('shop')
    expect(placeKind('Ranch house')).toBe('house')
    expect(placeKind('Grain dryer')).toBe('dryer')
    expect(placeKind('Bin yard')).toBe('bins')
    expect(placeKind('Calving barn')).toBe('other')
    expect(placeKind('')).toBeNull()
  })

  it('puts a site on the one map pin that names it', () => {
    const pins = [
      { id: 'p1', label: 'Natural Gas Meter (Main Shop)', properties: { description: 'Site 0009990000011' } },
      { id: 'p2', label: 'Gas meter', properties: { description: 'Meter T00000-X00002' } },
    ]
    expect(matchPin({ site_id: '0009990000011', meter_number: null }, pins)).toEqual({ featureId: 'p1', place: 'Main Shop', kind: 'shop' })
    expect(matchPin({ site_id: '0009990000099', meter_number: 'T00000-X00002' }, pins)).toEqual({ featureId: 'p2', place: 'Gas meter', kind: 'other' })
    expect(matchPin({ site_id: '0009990000099', meter_number: null }, pins)).toBeNull()
    // Two pins naming one site name neither.
    expect(matchPin({ site_id: '0009990000011', meter_number: null }, [...pins, { id: 'p3', label: 'Old meter', properties: { note: '9990000011' } }])).toBeNull()
  })

  it('writes a notice’s note', () => {
    expect(gasNoticeNote({ kind: 'notice', what: 'ebill', retailer: null, account_number: null, bill_date: null, total: 12.5, due_date: '2030-01-07' })).toBe(
      'Direct Energy bill email: $12.50 due 2030-01-07. The bill itself is not attached in QuickBooks.',
    )
  })
})
