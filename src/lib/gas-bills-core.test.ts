import { describe, expect, it } from 'vitest'
import { deliveredPricePerGj, gasByMonth, gasBySite, gasByYear, gasSiteCost, netGj, noticesWithoutBill, type GasBillRow, type GasSiteRow } from './gas-bills-core'
import { gasReportGroups } from './reports/gas'

// Every site, figure and date here is made up.

const site = (o: Partial<GasSiteRow> & Pick<GasSiteRow, 'id' | 'bill_id' | 'site_id'>): GasSiteRow => ({
  address: null,
  legal_land: null,
  meter_number: null,
  period_start: null,
  period_end: null,
  gj: null,
  energy_charge: null,
  admin_fee: null,
  delivery_fixed: null,
  delivery_variable: null,
  riders: null,
  carbon_levy: null,
  other_charges: null,
  rebilled_start: null,
  rebilled_end: null,
  rebilled_charges: null,
  gst: null,
  total: null,
  ...o,
})

const rows: GasSiteRow[] = [
  site({ id: 'a1', bill_id: 'b1', site_id: 'S1', period_start: '2030-01-01', period_end: '2030-01-31', gj: 30, energy_charge: 90, carbon_levy: 30, gst: 10.5, total: 220.5 }),
  site({ id: 'a2', bill_id: 'b2', site_id: 'S1', period_start: '2030-01-31', period_end: '2030-03-02', gj: 20, energy_charge: 60, gst: 5, total: 105 }),
  site({ id: 'c1', bill_id: 'b1', site_id: 'S2', period_start: '2030-01-01', period_end: '2030-01-31', gj: 10, energy_charge: 30, gst: 2.5, total: 52.5 }),
  site({ id: 'c0', bill_id: 'b0', site_id: 'S2', period_start: '2029-12-01', period_end: '2029-12-31', gj: 5, energy_charge: 15, gst: 1, total: 21 }),
]

describe('gas by site, month and year', () => {
  it('costs a site before GST', () => {
    expect(gasSiteCost(rows[0])).toBe(210)
    expect(gasSiteCost(site({ id: 'x', bill_id: 'x', site_id: 'x', energy_charge: 10, delivery_fixed: 5, rebilled_charges: -2 }))).toBe(13)
  })

  it('adds up by year and month, a bill in the month its period ends', () => {
    const years = gasByYear(rows)
    expect(years.map((y) => y.year)).toEqual(['2030', '2029'])
    expect(years[0]).toMatchObject({ bills: 2, gj: 60, cost: 360, gas: 180, carbon: 30, perGj: 6, gasPerGj: 3 })
    expect(gasByMonth(rows, '2030-01-01').map((m) => [m.month, m.gj])).toEqual([
      ['2030-03', 20],
      ['2030-01', 40],
    ])
  })

  it('adds up by site with its place, the costliest first', () => {
    const s = gasBySite(rows, [{ id: 'p', site_id: 'S1', place: 'Shop', place_kind: 'shop', address: null, legal_land: 'NE 1-31-15 W4', meter_number: null, place_set_by_hand: true }])
    expect(s.map((x) => [x.siteId, x.place, x.bills, x.gj, x.cost, x.last])).toEqual([
      ['S1', 'Shop', 2, 50, 310, '2030-03-02'],
      ['S2', null, 2, 15, 70, '2030-01-31'],
    ])
    expect(s[0].legalLand).toBe('NE 1-31-15 W4')
  })

  it('prices a GJ delivered from a date on', () => {
    expect(deliveredPricePerGj(rows, '2030-01-01')).toEqual({ perGj: 6, gasPerGj: 3, gj: 60, cost: 360 })
    expect(deliveredPricePerGj([], null)).toBeNull()
  })

  it('takes the days a corrected bill re-bills off its GJ, in proportion', () => {
    const early = site({ id: 'e', bill_id: 'b1', site_id: 'S1', period_start: '2030-01-01', period_end: '2030-01-31', gj: 30 })
    const fix = site({ id: 'f', bill_id: 'b2', site_id: 'S1', period_start: '2030-01-21', period_end: '2030-03-02', gj: 50, rebilled_start: '2030-01-21', rebilled_end: '2030-01-31' })
    const net = netGj([early, fix])
    // Ten of the earlier bill's 30 days, a third of its 30 GJ.
    expect(net.get('e')).toBe(30)
    expect(net.get('f')).toBe(40)
  })

  it('counts a notice only when its bill is not read', () => {
    const b = (o: Partial<GasBillRow>): GasBillRow => ({
      id: 'x',
      source: 'quickbooks',
      status: 'read',
      file_name: null,
      account_number: '1',
      bill_date: '2030-01-15',
      period_start: null,
      period_end: null,
      total: 10,
      budget_plan: false,
      adjusted: false,
      error: null,
      notes: null,
      qb_txn_ref: null,
      ...o,
    })
    const bills = [b({ id: 'r' }), b({ id: 'n1', status: 'notice' }), b({ id: 'n2', status: 'notice', bill_date: '2030-02-15' })]
    expect(noticesWithoutBill(bills).map((x) => x.id)).toEqual(['n2'])
  })

  it('makes the report’s groups for a year', () => {
    const r = gasReportGroups(rows, [], 2030)
    expect(r.groups.map((g) => g.title)).toEqual(['Site …S1 · site S1', 'Site …S2 · site S2'])
    expect(r.all.gj).toBe(60)
    expect(r.all.cost).toBe(360)
    expect(r.groups[0].totals?.[11]).toBeCloseTo(6.2)
  })
})
