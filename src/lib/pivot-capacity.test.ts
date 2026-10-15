import { describe, expect, it } from 'vitest'
import { pivotCapacityMmDay } from './et'

// This figure is a ceiling the balance uses to decide whether a field can be
// caught up at all, and it is now derived rather than typed — so nobody is
// eyeballing it for sanity any more. The conversion constant and the guards
// against dividing by a missing acreage are worth pinning down.
describe('pivotCapacityMmDay', () => {
  it('matches the gpm arithmetic quoted in the column help', () => {
    // 800 US gpm = 50.463 L/s, on 130 irrigated acres → 8.3 mm/day.
    const mm = pivotCapacityMmDay({ system_capacity_ls: 50.463, acres_irrigated: 130 })
    expect(mm).toBeCloseTo(8.3, 1)
  })

  it('agrees with the L/s per hectare form', () => {
    // mm/day = L/s × 8.64 ÷ ha. 50 L/s over 50 ha → 8.64 mm/day.
    const hectaresAsAcres = 50 / 0.404685642
    const mm = pivotCapacityMmDay({ system_capacity_ls: 50, acres_irrigated: hectaresAsAcres })
    expect(mm).toBeCloseTo(8.64, 2)
  })

  it('scales the way the physics does', () => {
    const base = pivotCapacityMmDay({ system_capacity_ls: 50, acres_irrigated: 130 })!
    // Twice the flow on the same ground is twice the depth.
    expect(pivotCapacityMmDay({ system_capacity_ls: 100, acres_irrigated: 130 })).toBeCloseTo(
      base * 2,
      6,
    )
    // The same water over twice the ground is half the depth.
    expect(pivotCapacityMmDay({ system_capacity_ls: 50, acres_irrigated: 260 })).toBeCloseTo(
      base / 2,
      6,
    )
  })

  it('accepts the numeric-as-string values postgrest returns', () => {
    expect(pivotCapacityMmDay({ system_capacity_ls: '50.463', acres_irrigated: '130' })).toBeCloseTo(
      8.3,
      1,
    )
  })

  it('returns null rather than a wrong number when the pivot record is incomplete', () => {
    // Falling back is the caller's job; guessing here would put a plausible but
    // invented ceiling in front of a manager.
    expect(pivotCapacityMmDay({ system_capacity_ls: null, acres_irrigated: 130 })).toBeNull()
    expect(pivotCapacityMmDay({ system_capacity_ls: 50, acres_irrigated: null })).toBeNull()
    expect(pivotCapacityMmDay({})).toBeNull()
  })

  it('refuses zero or negative acreage instead of dividing by it', () => {
    expect(pivotCapacityMmDay({ system_capacity_ls: 50, acres_irrigated: 0 })).toBeNull()
    expect(pivotCapacityMmDay({ system_capacity_ls: 50, acres_irrigated: -130 })).toBeNull()
    expect(pivotCapacityMmDay({ system_capacity_ls: 0, acres_irrigated: 130 })).toBeNull()
  })

  it('rejects unparseable values rather than yielding NaN', () => {
    expect(pivotCapacityMmDay({ system_capacity_ls: 'n/a', acres_irrigated: 130 })).toBeNull()
  })

  it('gives a believable answer for a southern-Alberta quarter-section pivot', () => {
    // ~1000 gpm (63 L/s) on 130 acres — should land near the 8 mm/day the app
    // has been defaulting to, which is the check that the units are right.
    const mm = pivotCapacityMmDay({ system_capacity_ls: 63, acres_irrigated: 130 })!
    expect(mm).toBeGreaterThan(5)
    expect(mm).toBeLessThan(15)
  })
})
