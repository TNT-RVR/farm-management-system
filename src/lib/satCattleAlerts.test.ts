import { describe, expect, it } from 'vitest'
import { cattleAlertCopy, cattleAlertFor } from '../../netlify/shared/sat-cattle-alerts'

describe('cattleAlertFor', () => {
  it('puts an overgrazed paddock above everything else', () => {
    // A paddock that is overgrazed AND going backwards under stock needs one
    // clear instruction. Saying it twice in two alerts halves the weight of
    // each.
    expect(
      cattleAlertFor({ readiness: 'overgrazed', regrowthPerDay: -0.02, cattleOnNow: true }),
    ).toBe('pasture_overgrazed')
  })

  it('flags forage going backwards while cattle are still on', () => {
    expect(
      cattleAlertFor({ readiness: 'ready', regrowthPerDay: -0.01, cattleOnNow: true }),
    ).toBe('regrowth_negative_while_stocked')
  })

  it('does not flag a decline on an empty paddock', () => {
    // Forage falling on ground with no cattle on it is senescence or drought,
    // not a stocking problem, and there is nothing to move.
    expect(
      cattleAlertFor({ readiness: 'ready', regrowthPerDay: -0.01, cattleOnNow: false }),
    ).toBe('pasture_ready')
  })

  it('only calls an EMPTY paddock ready', () => {
    // "Ready" is a rotation decision. A paddock with cattle already on it is
    // not one.
    expect(cattleAlertFor({ readiness: 'ready', regrowthPerDay: 0.01, cattleOnNow: true })).toBeNull()
    expect(cattleAlertFor({ readiness: 'optimal', regrowthPerDay: 0.01, cattleOnNow: false })).toBe(
      'pasture_ready',
    )
  })

  it('stays quiet about a paddock that is simply not ready', () => {
    expect(
      cattleAlertFor({ readiness: 'not_ready', regrowthPerDay: 0.01, cattleOnNow: false }),
    ).toBeNull()
  })

  it('treats speckle-sized regrowth as no trend', () => {
    // The threshold has to sit above the noise in the index, or every paddock
    // with cattle on it alerts every week.
    expect(
      cattleAlertFor({ readiness: 'ready', regrowthPerDay: -0.0005, cattleOnNow: true }),
    ).toBeNull()
  })

  it('says nothing when the trend is unknown', () => {
    // Too few looks to fit a slope is not evidence of decline.
    expect(
      cattleAlertFor({ readiness: 'ready', regrowthPerDay: null, cattleOnNow: true }),
    ).toBeNull()
  })
})

describe('cattleAlertCopy', () => {
  it('tells the reader what to do, not just what happened', () => {
    const move = cattleAlertCopy('pasture_overgrazed', 'Pasture K', 'Below the residual floor.')
    expect(move.title).toMatch(/move cattle off/i)

    const stocked = cattleAlertCopy('regrowth_negative_while_stocked', 'Pasture B', 'x')
    expect(stocked.description).toMatch(/taking more than it is growing/i)
  })

  it('carries the reasoning through from the readiness view', () => {
    const c = cattleAlertCopy('pasture_ready', 'Pasture C', 'Enough forage and adequately rested.')
    expect(c.description).toContain('Enough forage and adequately rested.')
  })

  it('never states a biomass in kg', () => {
    // §14.3: no absolute biomass before local calibration, and an alert is
    // exactly where a confident wrong number would do the most damage.
    for (const t of ['pasture_overgrazed', 'regrowth_negative_while_stocked', 'pasture_ready'] as const) {
      const c = cattleAlertCopy(t, 'Pasture A', 'reason')
      expect(`${c.title} ${c.description}`).not.toMatch(/kg|lb|tonne/i)
    }
  })
})
