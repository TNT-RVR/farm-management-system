import { describe, expect, it } from 'vitest'
import { availableWaterFrom, resolveSoil } from './soil-priority'

describe('resolveSoil', () => {
  it('prefers our own soil test over the survey', () => {
    // The whole rule: a core out of this field beats a lookup on the soil's
    // name. AGRASID gives every Cavendish polygon on this farm the same
    // figures because nobody sampled any of them.
    const r = resolveSoil({
      test: { omPct: 1.92 },
      survey: { organicCarbonPct: 0.9 },
    })
    expect(r.omPct.value).toBe(1.92)
    expect(r.omPct.source).toBe('test')
  })

  it('falls back to the survey where we have never sampled', () => {
    const r = resolveSoil({ test: null, survey: { organicCarbonPct: 0.9 } })
    expect(r.omPct.source).toBe('survey')
    // Organic CARBON, converted. Reporting 0.9 as organic matter would
    // understate an untested field by 42% — across a 2.5% threshold, the
    // difference between "low" and "fine".
    expect(r.omPct.value).toBeCloseTo(1.55, 2)
  })

  it('has no phosphorus or potassium to fall back on, and says so', () => {
    // AGRASID carries neither. An untested field must come back empty rather
    // than be scored as though somebody had measured it.
    const r = resolveSoil({ test: null, survey: { organicCarbonPct: 2, ph: 7.8 } })
    expect(r.olsenPPpm.value).toBeNull()
    expect(r.olsenPPpm.source).toBeNull()
    expect(r.kPpm.value).toBeNull()
  })

  it('takes water holding from the survey, because the lab never measures it', () => {
    const r = resolveSoil({
      test: { omPct: 2, olsenPPpm: 8, kPpm: 140 },
      survey: { fcPct: 9, wpPct: 5.2, texture: 'LS' },
    })
    expect(r.fcPct.source).toBe('survey')
    expect(r.texture.value).toBe('LS')
  })

  it('lets a person overrule the survey on water holding', () => {
    const r = resolveSoil({
      survey: { fcPct: 9, wpPct: 5.2 },
      manual: { fcPct: 14, wpPct: 6 },
    })
    expect(r.fcPct.value).toBe(14)
    expect(r.fcPct.source).toBe('manual')
    expect(r.fcPct.note).toBe('set by hand')
  })

  it('treats zero as a reading, not as missing', () => {
    // A salinity of zero is a measurement. Falling through to the survey on a
    // nullish check would report a number nobody took.
    const r = resolveSoil({ test: { ec: 0 }, survey: { ec: 1.4 } })
    expect(r.ec.value).toBe(0)
    expect(r.ec.source).toBe('test')
  })

  it('comes back empty rather than guessing when neither has anything', () => {
    const r = resolveSoil({})
    expect(r.omPct.value).toBeNull()
    expect(r.fcPct.value).toBeNull()
    expect(r.texture.value).toBeNull()
  })
})

describe('availableWaterFrom', () => {
  it('is the gap between the two, in inches per metre', () => {
    const r = availableWaterFrom(resolveSoil({ survey: { fcPct: 9, wpPct: 5.2 } }))
    expect(r.value).toBeCloseTo(1.5, 1)
    expect(r.source).toBe('survey')
  })

  it('is described by the weaker of its two sources', () => {
    // A hand-set field capacity over a surveyed wilting point is not a figure
    // somebody set — half of it is still the lookup.
    const mixed = availableWaterFrom(
      resolveSoil({ survey: { fcPct: 9, wpPct: 5.2 }, manual: { fcPct: 14 } }),
    )
    expect(mixed.source).toBe('survey')
    const both = availableWaterFrom(resolveSoil({ manual: { fcPct: 14, wpPct: 6 } }))
    expect(both.source).toBe('manual')
  })

  it('refuses a pair that cannot be right', () => {
    // Wilting point above field capacity is not a dry soil, it is a typo.
    expect(availableWaterFrom(resolveSoil({ manual: { fcPct: 5, wpPct: 9 } })).value).toBeNull()
    expect(availableWaterFrom(resolveSoil({})).value).toBeNull()
  })
})
