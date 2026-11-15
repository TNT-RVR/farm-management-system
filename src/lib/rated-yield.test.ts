import { describe, expect, it } from 'vitest'
import { forageYieldPerAcre, ratedAnchors, ratedYieldPerAcre } from './forage-yield'

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

describe('ratedAnchors', () => {
  const pastures = [
    { id: 'a', grass_quality_rel: 1.4 },
    { id: 'b', grass_quality_rel: '0.8' },
    { id: 'c', grass_quality_rel: null },
  ]

  it('reads every rated paddock off the one level', () => {
    const m = ratedAnchors(pastures, 780, null, 'rated')
    expect(m.get('a')).toEqual({ lbPerAcre: 1092, source: 'rated' })
    expect(m.get('b')).toEqual({ lbPerAcre: 624, source: 'rated' })
  })

  it('leaves a paddock with no measured cover for the caller', () => {
    expect(ratedAnchors(pastures, 780, null, 'rated').has('c')).toBe(false)
  })

  it('never overrides a clip-and-weigh', () => {
    const clipped = new Map([['a', { lbPerAcre: 1500, source: 'measured' as const }]])
    const m = ratedAnchors(pastures, 780, clipped, 'rated')
    expect(m.get('a')).toEqual({ lbPerAcre: 1500, source: 'measured' })
    expect(clipped.size).toBe(1)
  })

  it('does not count the grazing record twice', () => {
    // The level Sam set was read partly off the same collars. Measuring the
    // record against the TABLE would find that shortfall again and multiply
    // his number by it; measuring it against the LEVEL leaves it alone.
    const level = 780
    const fromTable = forageYieldPerAcre(379, 'Fair')
    const liftAgainstTable = level / fromTable
    expect(liftAgainstTable).toBeGreaterThan(1.5)
    const m = ratedAnchors(pastures, level, null, 'rated')
    expect(m.get('a')!.lbPerAcre).toBeCloseTo(level * 1.4, 6)
    expect(m.get('a')!.lbPerAcre).toBeLessThan(level * liftAgainstTable * 1.4)
  })
})
