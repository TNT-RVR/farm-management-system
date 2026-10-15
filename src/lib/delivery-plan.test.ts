import { describe, expect, it } from 'vitest'
import { loadsFor, planDeliveries } from './delivery-plan'

describe('delivery plan', () => {
  const bins = [
    { binId: 'a', name: '#1', cropId: 'canola', bu: 3000, carryOver: false },
    { binId: 'b', name: '#2', cropId: 'canola', bu: 5000, carryOver: false },
    { binId: 'c', name: '#3', cropId: 'canola', bu: 1000, carryOver: true },
    { binId: 'd', name: '#4', cropId: 'wheat', bu: 4000, carryOver: false },
  ]
  it('fills the earliest contract first, carry-over first, then the fullest bin', () => {
    const plan = planDeliveries(
      [
        { id: 'late', label: 'Nov', cropId: 'canola', remainingBu: 6000, deliveryStart: null, deliveryEnd: '2026-11-30' },
        { id: 'early', label: 'Oct', cropId: 'canola', remainingBu: 4000, deliveryStart: null, deliveryEnd: '2026-10-31' },
      ],
      bins,
    )
    expect(plan[0].contract.id).toBe('early')
    expect(plan[0].draws).toEqual([
      { binId: 'c', name: '#3', bu: 1000 },
      { binId: 'b', name: '#2', bu: 3000 },
    ])
    expect(plan[1].draws).toEqual([
      { binId: 'a', name: '#1', bu: 3000 },
      { binId: 'b', name: '#2', bu: 2000 },
    ])
    expect(plan[1].shortfallBu).toBe(1000)
  })
  it('counts Super B loads', () => {
    // 3,000 bu canola at 50 lb = 68 t → 2 loads.
    expect(loadsFor(3000, 50)).toBe(2)
    expect(loadsFor(0, 50)).toBeNull()
  })
})
