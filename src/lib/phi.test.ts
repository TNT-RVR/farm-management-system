import { describe, expect, it } from 'vitest'
import { deereCropCode, fieldPhi, phiDaysFor } from './phi'

describe('pre-harvest intervals', () => {
  it('maps the app crops to Deere codes', () => {
    expect(deereCropCode('Beans-Pinto')).toBe('EDIBLE_BEANS')
    expect(deereCropCode('Durum Wheat')).toBe('WHEAT_DURUM')
    expect(deereCropCode('Buckwheat')).toBeNull()
  })

  it("uses the crop's own row, else a single label-wide interval, else unknown", () => {
    const rows = [
      { crop: 'canola', preharvest_interval_days: 60 },
      { crop: 'dry beans', preharvest_interval_days: 30 },
    ]
    expect(phiDaysFor(rows, 'CANOLA')).toBe(60)
    expect(phiDaysFor(rows, 'CORN_WET')).toBeNull()
    expect(phiDaysFor([{ crop: 'wheat', preharvest_interval_days: 45 }, { crop: 'barley', preharvest_interval_days: 45 }], 'CORN_WET')).toBe(45)
    expect(phiDaysFor([{ crop: 'canola', preharvest_interval_days: null }], 'CANOLA')).toBeNull()
  })

  it('finds the last day a spray holds harvest back, and a harvest that came too soon', () => {
    const apps = [
      { fieldId: 'f', product: 'A', appliedOn: '2026-07-01', phiDays: 60 },
      { fieldId: 'f', product: 'B', appliedOn: '2026-08-10', phiDays: 7 },
      { fieldId: 'f', product: 'C', appliedOn: '2026-08-12', phiDays: null },
    ]
    const r = fieldPhi('f', apps, '2026-08-25')
    expect(r.safeFrom).toBe('2026-08-30')
    expect(r.limiting?.product).toBe('A')
    expect(r.unknown.map((u) => u.product)).toEqual(['C'])
    expect(r.violation).toEqual({ harvestedOn: '2026-08-25', daysEarly: 5 })
    expect(fieldPhi('f', apps, '2026-09-02').violation).toBeNull()
  })
})
