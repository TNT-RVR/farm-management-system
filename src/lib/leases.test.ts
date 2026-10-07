import { describe, expect, it } from 'vitest'
import { annualRent, leaseAlerts, noticeBy, paymentsForYear, type LeaseLike } from './leases'

const lease: LeaseLike = {
  id: 'l1',
  landlord: 'Smith',
  acres: 160,
  rent_per_acre: 100,
  rent_total: null,
  start_date: '2024-01-01',
  end_date: '2026-12-31',
  notice_days: 90,
  payment_schedule: [
    { date: '04-01', share: 0.5 },
    { date: '11-01', share: 0.5 },
  ],
  active: true,
}

describe('leases', () => {
  it('works out rent and the payment dates', () => {
    expect(annualRent(lease)).toBe(16000)
    expect(paymentsForYear(lease, 2026)).toEqual([
      { due_on: '2026-04-01', amount: 8000 },
      { due_on: '2026-11-01', amount: 8000 },
    ])
    expect(paymentsForYear(lease, 2027)).toEqual([])
  })
  it('puts the notice date the notice period before the end', () => {
    expect(noticeBy(lease)).toBe('2026-10-02')
  })
  it('flags the notice deadline and rent coming due, not paid rent', () => {
    const a = leaseAlerts([lease], [{ lease_id: 'l1', due_on: '2026-04-01', amount: 8000, paid_on: '2026-03-30' }], '2026-09-28')
    expect(a.map((x) => x.kind)).toEqual(['renewal'])
    expect(a[0].days).toBe(4)
    const b = leaseAlerts([lease], [{ lease_id: 'l1', due_on: '2026-04-01', amount: 8000, paid_on: '2026-03-30' }], '2026-10-20')
    expect(b.map((x) => x.kind)).toEqual(['renewal', 'rent'])
    expect(b[1].days).toBe(12)
  })
})
