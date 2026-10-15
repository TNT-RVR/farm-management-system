import { describe, expect, it } from 'vitest'
import { longDate } from './framework'
import {
  cattleSales,
  checkoffOn,
  commissionByKey,
  commissionFor,
  cropPeriods,
  filingNote,
  fromTonnes,
  grainSales,
  latestClosed,
  periodOf,
  periodsFor,
  refundOn,
  refundSection,
  REFUND_COLUMNS,
  toTonnes,
  type SCrop,
  type STicket,
} from './checkoff-refunds'

const canola = commissionByKey('canola')!
const grains = commissionByKey('grains')!
const pulse = commissionByKey('pulse')!
const oats = commissionByKey('oats')!
const beef = commissionByKey('beef')!

const crops: SCrop[] = [
  { id: 'can', name: 'BASF Canola', yield_unit: 'bu', test_weight_lb_per_bu: null },
  { id: 'dur', name: 'Durum Wheat', yield_unit: 'bu', test_weight_lb_per_bu: '60' },
  { id: 'pin', name: 'Beans-Pinto', yield_unit: 'lbs', test_weight_lb_per_bu: null },
  { id: 'corn', name: 'Grain Corn', yield_unit: 'bu', test_weight_lb_per_bu: 56 },
]
const col = (label: string) => REFUND_COLUMNS.findIndex((c) => c.label === label)

describe('which commission collects', () => {
  it('sorts the farm’s crops by name', () => {
    expect(commissionFor('BASF Canola')?.key).toBe('canola')
    expect(commissionFor('Seed Canola')?.key).toBe('canola')
    expect(commissionFor('Durum Wheat')?.key).toBe('grains')
    expect(commissionFor('Barley')?.key).toBe('grains')
    expect(commissionFor('Beans-Great Northern')?.key).toBe('pulse')
    expect(commissionFor('Peas')?.key).toBe('pulse')
    expect(commissionFor('Oats')?.key).toBe('oats')
    // No Alberta corn check-off.
    expect(commissionFor('Grain Corn')).toBeNull()
    expect(commissionFor('Vandermeer Corn')).toBeNull()
  })
})

describe('rate maths', () => {
  const sale = { tonnes: 10, gross: 5000, head: 20 }
  it('charges canola $1.75/t from 1 Aug 2025 and $1.00 before', () => {
    expect(checkoffOn(canola.rateFor('Canola', '2025-08-01')!, sale)).toBe(17.5)
    expect(checkoffOn(canola.rateFor('Canola', '2025-07-31')!, sale)).toBe(10)
    expect(refundOn(canola, 'Canola', { ...sale, date: '2026-03-01' })).toBe(17.5)
  })
  it('charges wheat and durum $1.09/t and barley $1.20/t', () => {
    expect(checkoffOn(grains.rateFor('Durum Wheat', '2026-03-01')!, sale)).toBe(10.9)
    expect(checkoffOn(grains.rateFor('Barley', '2026-03-01')!, sale)).toBe(12)
  })
  it('charges pulses 0.75% of the value, and nothing it can work out without one', () => {
    expect(checkoffOn(pulse.rateFor('Beans-Pinto', '2026-03-01')!, sale)).toBe(37.5)
    expect(checkoffOn(pulse.rateFor('Beans-Pinto', '2026-03-01')!, { ...sale, gross: null })).toBeNull()
  })
  it('has no oat levy before 1 Aug 2024', () => {
    expect(oats.rateFor('Oats', '2024-07-31')).toBeNull()
    expect(checkoffOn(oats.rateFor('Oats', '2024-08-01')!, sale)).toBe(7.5)
  })
  it('takes $4.50 a head off cattle and refunds only the $2.00 Alberta part', () => {
    expect(checkoffOn(beef.rateFor('calves', '2026-10-01')!, sale)).toBe(90)
    expect(refundOn(beef, 'calves', { ...sale, date: '2026-10-01' })).toBe(40)
  })
})

describe('units', () => {
  it('weighs bushels at the crop’s bushel weight and pounds as pounds', () => {
    expect(toTonnes(1000, 'bu', crops[0])).toBeCloseTo((1000 * 50) / 2204.62262, 3)
    expect(toTonnes(1000, 'bu', crops[1])).toBeCloseTo((1000 * 60) / 2204.62262, 3)
    expect(toTonnes(2204.62262, 'lbs', crops[2])).toBeCloseTo(1, 6)
    expect(toTonnes(22.0462262, 'cwt', crops[2])).toBeCloseTo(1, 6)
    expect(fromTonnes(1, crops[2])).toBeCloseTo(2204.62, 1)
    expect(fromTonnes(toTonnes(500, 'bu', crops[0]), crops[0])).toBeCloseTo(500, 6)
  })
  it('will not weigh bushels of a crop with no bushel weight', () => {
    expect(toTonnes(100, 'bu', { id: 'x', name: 'Carrots', yield_unit: 'bu', test_weight_lb_per_bu: null })).toBeNull()
  })
})

describe('periods', () => {
  it('puts a delivery in the crop commissions’ half-year', () => {
    expect(periodOf(canola, '2026-08-15')).toMatchObject({ start: '2026-08-01', end: '2027-01-31', deadline: '2027-02-28' })
    expect(periodOf(canola, '2026-07-31')).toMatchObject({ start: '2026-02-01', end: '2026-07-31', deadline: '2026-08-31' })
    expect(periodOf(pulse, '2026-01-31')?.start).toBe('2025-08-01')
    expect(cropPeriods(2028)[0].deadline).toBe('2028-02-29')
  })
  it('uses calendar halves for the beef service charge', () => {
    expect(periodOf(beef, '2026-10-20')).toMatchObject({ start: '2026-07-01', end: '2026-12-31', deadline: '2027-01-31' })
    expect(periodOf(beef, '2026-06-30')?.deadline).toBe('2026-07-31')
  })
  it('picks the latest closed period, the open one, or every one closing in a year', () => {
    expect(latestClosed(canola, '2026-10-03').label).toBe('1 Feb to 31 Jul 2026')
    expect(latestClosed(beef, '2026-10-03').label).toBe('1 Jan to 30 Jun 2026')
    expect(latestClosed(canola, '2026-02-01').end).toBe('2026-01-31')
    expect(periodsFor(canola, 'current', 2026, '2026-10-03')[0].end).toBe('2027-01-31')
    expect(periodsFor(grains, 'year', 2026, '2026-10-03').map((p) => p.end)).toEqual(['2026-01-31', '2026-07-31'])
  })
})

describe('deliveries as the commissions levy them', () => {
  const ticket = (over: Partial<STicket>): STicket => ({ id: 't', crop_year: 2025, crop_id: 'can', contract_id: null, buyer: 'Bunge Lethbridge', ticket_no: '1001', delivered_on: '2026-03-02', net_lb: null, dockage_pct: null, net_units: null, unit: null, bin_load_id: null, ...over })
  const base = { loads: [], moves: [], contracts: [{ id: 'k1', buyer_contact_id: 'c1', contract_number: 'BASF-7', price_per_unit: '15.5' }], crops, prices: [{ crop_id: 'can', crop_year: 2025, price_per_unit: 14 }] }
  const names = { buyer: (id: string | null) => (id === 'c1' ? 'BASF' : null), site: () => 'Richardson Taber', currentYear: 2026 }

  it('uses the ticket’s settlement net, else its weight less dockage', () => {
    const [a, b] = grainSales({ ...base, tickets: [ticket({ net_units: 1000, unit: 'bu' }), ticket({ id: 't2', ticket_no: '1002', net_lb: 50000, dockage_pct: 2 })] }, names)
    expect(a.tonnes).toBeCloseTo((1000 * 50) / 2204.62262, 3)
    expect(b.tonnes).toBeCloseTo((50000 / 2204.62262) * 0.98, 3)
    expect(b.basis).toContain('2% dockage')
  })

  it('values at the contract’s price, else the crop’s price for the year', () => {
    const [onContract, spot] = grainSales({ ...base, tickets: [ticket({ net_units: 1000, unit: 'bu', contract_id: 'k1' }), ticket({ id: 't2', ticket_no: '1002', net_units: 1000, unit: 'bu' })] }, names)
    expect(onContract.gross).toBeCloseTo(15500, 0)
    expect(onContract.basis).toContain('contract BASF-7')
    expect(spot.gross).toBeCloseTo(14000, 0)
  })

  it('counts a ticketed load and a ticketed bin delivery once, as the ticket', () => {
    const r = grainSales(
      {
        ...base,
        tickets: [ticket({ net_units: 1000, unit: 'bu', bin_load_id: 'L1' })],
        loads: [
          { id: 'L1', crop_year: 2025, crop_id: 'can', contract_id: null, delivery_site_id: 's', loaded_on: '2026-03-02', net_kg: 22000, bushels: 970 },
          { id: 'L2', crop_year: 2025, crop_id: 'pin', contract_id: null, delivery_site_id: 's', loaded_on: '2026-03-05', net_kg: 10000, bushels: null },
        ],
        moves: [
          { crop_year: 2025, crop_id: 'can', contract_id: null, bushels: 1000, moved_at: '2026-03-02T10:00:00', ticket_number: '1001' },
          { crop_year: 2025, crop_id: 'dur', contract_id: null, bushels: 500, moved_at: '2026-04-01T10:00:00', ticket_number: 'load:abc' },
        ],
      },
      names,
    )
    expect(r).toHaveLength(3)
    expect(r[1]).toMatchObject({ commodity: 'Beans-Pinto', tonnes: 10, buyer: 'Richardson Taber', ticket: null })
    expect(r[2]).toMatchObject({ commodity: 'Durum Wheat', date: '2026-04-01', ticket: null })
    expect(r[2].tonnes).toBeCloseTo((500 * 60) / 2204.62262, 3)
  })
})

describe('the refund section', () => {
  const p = periodOf(canola, '2026-03-02')!
  const sales = [
    { date: '2026-03-02', buyer: 'Bunge', ticket: '1001', commodity: 'BASF Canola', cropName: 'BASF Canola', tonnes: 20, head: null, gross: 14000, basis: 'ticket weight' },
    { date: '2026-08-02', buyer: 'Bunge', ticket: '1002', commodity: 'BASF Canola', cropName: 'BASF Canola', tonnes: 20, head: null, gross: 14000, basis: 'ticket weight' },
  ]

  it('keeps only the period’s sales and adds them up', () => {
    const s = refundSection(canola, p, sales)
    expect(s.count).toBe(1)
    expect(s.checkoff).toBe(35)
    expect(s.refund).toBe(35)
    expect(s.totals[col('Refund claimable')]).toBe(35)
  })

  it('leaves the settlement number and what was deducted blank, and calls the check-off an estimate', () => {
    const [row] = refundSection(canola, p, sales).rows
    expect(row[col('Settlement no.')]).toBeNull()
    expect(row[col('Deducted per settlement')]).toBeNull()
    expect(row[col('Status')]).toBe('Estimate')
    expect(row[col('Ticket no.')]).toBe('1001')
  })

  it('takes calves on their delivery day, by head', () => {
    const calves = cattleSales([{ id: 'c', ranch: 'Home Ranch', animal_class: 'steers', head: '100', sale_date: '2026-03-01', delivery_date: '2026-10-20', total_lb: '60000', total_price: '210000', buyer: 'Cargill' }])
    const s = refundSection(beef, periodOf(beef, '2026-10-20')!, calves)
    expect(s.rows[0][col('Head')]).toBe(100)
    expect(s.checkoff).toBe(450)
    expect(s.refund).toBe(200)
    expect(s.rows[0][col('Net tonnes')]).toBeNull()
  })

  it('says when to file and leaves the producer’s numbers to fill in', () => {
    const n = filingNote(canola, p, '2026-10-03')
    expect(n).toContain(`Deadline passed ${longDate('2026-08-31')}`)
    expect(n).toContain('fill in')
    expect(filingNote(canola, periodOf(canola, '2026-10-01')!, '2026-10-03')).toContain(`File by ${longDate('2027-02-28')}`)
  })
})
