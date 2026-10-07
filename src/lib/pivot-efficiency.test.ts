import { describe, expect, it } from 'vitest'
import { passEfficiency, suggestEfficiency } from './pivot-efficiency'

describe('pivot efficiency', () => {
  it('needs a sprinkler package to suggest anything', () => {
    expect(suggestEfficiency({}).eff).toBeNull()
    expect(suggestEfficiency({ sprinkler_package: 'mixed' }).eff).toBeNull()
  })

  it('starts from the package and takes off for an end gun, no regulators and old nozzles', () => {
    expect(suggestEfficiency({ sprinkler_package: 'drops_mesa', end_gun: false, pressure_regulators: true, nozzles_replaced_year: 2022 }, 2026).eff).toBe(0.84)
    // 0.84 − 0.08 × 0.18 − 0.02 − 0.04 = 0.7656
    const worn = suggestEfficiency({ sprinkler_package: 'drops_mesa', end_gun: true, pressure_regulators: false, nozzles_replaced_year: 2008 }, 2026)
    expect(worn.eff).toBe(0.77)
    expect(worn.missing).toContain('drop height')
  })

  it('reads drops by their height', () => {
    expect(suggestEfficiency({ sprinkler_package: 'drops_mesa', drop_height_ft: 1.5, end_gun: false, pressure_regulators: true, nozzles_replaced_year: 2024 }, 2026).eff).toBe(0.88)
  })

  it('follows the manual: a fast circle keeps a smaller share', () => {
    // 900 gpm on a quarter (130 ac) in 48 h ≈ 18.65 mm a pass.
    const two = passEfficiency({ gpm: 900, acres: 130, circleHours: 48, pkg: 'impact_high' })!
    expect(two.passMm).toBeCloseTo(18.65, 1)
    expect(two.eff).toBeCloseTo(0.785, 2)
    expect(passEfficiency({ gpm: 900, acres: 130, circleHours: 24, pkg: 'impact_high' })!.eff).toBeLessThan(two.eff)
    expect(passEfficiency({ gpm: null, acres: 130, circleHours: 24, pkg: null })).toBeNull()
  })
})
