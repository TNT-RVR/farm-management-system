import { describe, expect, it } from 'vitest'
import { forageYieldPerAcre, ratedYieldPerAcre } from './forage-yield'

describe('ratedYieldPerAcre', () => {
  it('reads a paddock at the ranch level times its own cover', () => {
    expect(ratedYieldPerAcre(512, 1)).toBe(512)
    expect(ratedYieldPerAcre(512, 1.39)).toBeCloseTo(711.7, 1)
    expect(ratedYieldPerAcre(512, 0.792)).toBeCloseTo(405.5, 1)
  })

  it('stops rounding a paddock down to a word', () => {
    // Pasture K measures 0.79 of its ranch's median. The four-word table read
    // that as "Poor", which at this zone is 19% under its own measurement.
    const measured = ratedYieldPerAcre(512, 0.792)!
    const bucketed = forageYieldPerAcre(379, 'Poor')
    expect(measured).toBeGreaterThan(bucketed)
    expect(bucketed / measured).toBeLessThan(0.86)
  })

  it('takes the number the database hands back as a string', () => {
    expect(ratedYieldPerAcre(500, '1.25')).toBe(625)
  })

  it('falls back rather than inventing a cover', () => {
    expect(ratedYieldPerAcre(512, null)).toBeNull()
    expect(ratedYieldPerAcre(512, undefined)).toBeNull()
    expect(ratedYieldPerAcre(512, 0)).toBeNull()
    expect(ratedYieldPerAcre(512, -1)).toBeNull()
    expect(ratedYieldPerAcre(512, Number.NaN)).toBeNull()
  })

  it('falls back rather than inventing a level', () => {
    expect(ratedYieldPerAcre(0, 1.2)).toBeNull()
    expect(ratedYieldPerAcre(Number.NaN, 1.2)).toBeNull()
  })

  it('leaves a ranch where it was when the level is the table’s own Fair', () => {
    // Nothing moves until somebody sets a level: a median paddock on the
    // table's Fair row still reads the table's Fair row.
    const fair = forageYieldPerAcre(379, 'Fair')
    expect(ratedYieldPerAcre(fair, 1)).toBe(fair)
  })
})
