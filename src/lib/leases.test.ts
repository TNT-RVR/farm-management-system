import { describe, expect, it } from 'vitest'
import { annualRent, leaseAlerts, noticeBy, paymentsForYear, scheduleOf, type LeaseLike } from './leases'

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

describe('rent dates that are not real days', () => {
  const withSchedule = (payment_schedule: unknown): LeaseLike => ({ ...lease, payment_schedule })

  it('drops a month-day that never happens, and keeps 29 February', () => {
    expect(scheduleOf(withSchedule([{ date: '02-31', share: 1 }])).map((s) => s.date)).toEqual([])
    expect(scheduleOf(withSchedule([{ date: '04-31', share: 1 }])).map((s) => s.date)).toEqual([])
    expect(scheduleOf(withSchedule([{ date: '13-01', share: 1 }])).map((s) => s.date)).toEqual([])
    expect(scheduleOf(withSchedule([{ date: '00-10', share: 1 }])).map((s) => s.date)).toEqual([])
    expect(scheduleOf(withSchedule([{ date: '02-29', share: 1 }])).map((s) => s.date)).toEqual(['02-29'])
  })

  it('moves a 29 February rent date to the 28th in a common year', () => {
    const feb29 = withSchedule([{ date: '02-29', share: 1 }])
    expect(paymentsForYear(feb29, 2026)).toEqual([{ due_on: '2026-02-28', amount: 16000 }])
    expect(paymentsForYear({ ...feb29, end_date: '2028-12-31' }, 2028)).toEqual([{ due_on: '2028-02-29', amount: 16000 }])
  })

  it('drops a rent date that never happens, rather than quietly sliding it', () => {
    // Date.parse does not refuse 2026-02-31: it rolls over to 3 March. So the
    // reminder used to fire on a day two off from the one it displayed.
    expect(Date.parse('2026-02-31T12:00:00Z')).toBe(Date.parse('2026-03-03T12:00:00Z'))
    const alerts = leaseAlerts([withSchedule([{ date: '02-31', share: 1 }])], [], '2026-03-05')
    expect(alerts.filter((a) => a.kind === 'rent')).toEqual([])
  })
})
