import { describe, expect, it } from 'vitest'
import { bushelsPer, combineCropOf } from './combine-field'
import { DROP_PAN, lossFromPan, seedsFromGrams } from './combine'

describe('loss check field defaults', () => {
  it('maps the farm crops onto the calculator crops', () => {
    expect(combineCropOf('BASF Canola')).toBe('canola')
    expect(combineCropOf('Durum Wheat')).toBe('durum')
    expect(combineCropOf('Grain Corn')).toBe('corn')
    expect(combineCropOf('Silage Corn')).toBeNull()
    expect(combineCropOf('Beans - Pinto')).toBe('beans')
  })
  it('turns yield units into bushels', () => {
    expect(bushelsPer('bu', 50)).toBe(1)
    expect(bushelsPer('lbs', 60)).toBeCloseTo(1 / 60)
    expect(bushelsPer('MT', 50)).toBeCloseTo(44.09, 2)
    expect(bushelsPer('ac', 50)).toBeNull()
  })
})

describe('agrees with the Bushel Plus 3B calculator', () => {
  it('3.8 g, 40" wide pan, 36 ft cut, 6 ft spread, canola 50 lb/bu → 0.4 bu/ac', () => {
    const r = lossFromPan({ seeds: seedsFromGrams(3.8, 3.5), panAreaSqFt: DROP_PAN.sqFt, headerFt: 36, dischargeFt: 6, spec: { gramsPer1000: 3.5, lbPerBushel: 50 } })
    expect(r.buPerAcre).toBeCloseTo(0.444, 3)
    expect(r.buPerAcre.toFixed(1)).toBe('0.4')
  })
})

describe('how a saved check was taken', () => {
  it('uses the recorded mode, else reads it from the spread', async () => {
    const { lossCheckMode } = await import('./combine')
    expect(lossCheckMode({ discharge_mode: 'windrow', discharge_ft: 30 })).toBe('windrow')
    expect(lossCheckMode({ discharge_mode: null, discharge_ft: 6 })).toBe('windrow')
    expect(lossCheckMode({ discharge_mode: null, discharge_ft: 30 })).toBe('spreader')
  })
})
