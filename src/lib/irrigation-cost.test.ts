import { describe, expect, it } from 'vitest'
import { inchesFrom, irrigationCost, pivotRunsOnUs } from './irrigation-cost'
import { GAL_PER_ACRE_INCH, pumpKwh } from './water-review'

describe('inchesFrom', () => {
  it('reads inches, millimetres and acre-feet', () => {
    expect(inchesFrom(1, 'in', 100)).toBe(1)
    expect(inchesFrom(25.4, 'mm', 100)).toBeCloseTo(1, 9)
    expect(inchesFrom(10, 'af', 120)).toBeCloseTo(1, 9)
    expect(inchesFrom(10, 'af', null)).toBeNull()
    expect(inchesFrom(0, 'in', 100)).toBeNull()
  })
})

describe('pivotRunsOnUs', () => {
  it('skips a pivot never run, or one the landowner runs', () => {
    expect(pivotRunsOnUs({ operated_by: null, not_used: false }).ok).toBe(true)
    expect(pivotRunsOnUs({ operated_by: null, not_used: true }).ok).toBe(false)
    const r = pivotRunsOnUs({ operated_by: 'A Landowner', not_used: false })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.why).toContain('A Landowner')
  })
})

describe('irrigationCost', () => {
  const base = { acres: 100, gpm: 1000, hp: 100, pricePerKwh: 0.1, inches: 1 }
  it('is the pivot pages’ sum for that depth', () => {
    const c = irrigationCost(base)!
    const hours = (100 * GAL_PER_ACRE_INCH) / (1000 * 60)
    expect(c.hours).toBeCloseTo(hours, 9)
    expect(c.kwh).toBeCloseTo(pumpKwh(100, hours), 9)
    expect(c.power).toBeCloseTo(pumpKwh(100, hours) * 0.1, 9)
    expect(c.perAcreInch).toBeCloseTo(c.total! / 100, 9)
    expect(c.acreFeet).toBeCloseTo(100 / 12, 9)
  })
  it('adds labour hours at the wage', () => {
    const c = irrigationCost({ ...base, wage: 20, labourHours: 2 })!
    expect(c.labour).toBe(40)
    expect(c.total).toBeCloseTo(c.power! + 40, 9)
  })
  it('reads against the allotment and the licence share', () => {
    const c = irrigationCost({ ...base, inches: 2, allottedIn: 10, usedIn: 3, licenceAf: 50 })!
    expect(c.allotment).toMatchObject({ pct: 20, afterPct: 50 })
    // 2 in over 100 ac = 16.67 af of a 50 af share; 3 in used = 25 af
    expect(c.licence!.pct).toBeCloseTo((200 / 12 / 50) * 100, 6)
    expect(c.licence!.afterPct).toBeCloseTo((500 / 12 / 50) * 100, 6)
  })
  it('has no cost without a pump horsepower, and nothing without acres or flow', () => {
    expect(irrigationCost({ ...base, hp: null })!.total).toBeNull()
    expect(irrigationCost({ ...base, gpm: null })).toBeNull()
    expect(irrigationCost({ ...base, acres: 0 })).toBeNull()
  })
})
