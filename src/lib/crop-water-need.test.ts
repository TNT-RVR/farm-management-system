import { describe, expect, it } from 'vitest'
import { aimmCalibration, albertaNeedIn, CROP_WATER, cropWaterFor, fieldNeed, profileAwhc, scsStorageFactor, soilRainFactor, windowRain } from './crop-water-need'

describe('crop water need', () => {
  it('counts May to September rain as the province does (210 mm)', () => {
    expect(windowRain('05-01', '09-30')).toBeCloseTo(209.8, 1)
    // Half of May: 17 of its 31 days.
    expect(windowRain('05-15', '05-31')).toBeCloseTo((35.9 * 17) / 31, 5)
  })

  it('gives the farm figures from the Alberta sheets', () => {
    const at = (key: string) => Math.round(albertaNeedIn(CROP_WATER.find((c) => c.key === key)!) * 10) / 10
    // Alfalfa: (561 − 210) / 0.84 = 418 mm.
    expect(at('alfalfa')).toBe(16.5)
    expect(at('grain_corn')).toBe(17.2)
    expect(at('silage_corn')).toBe(16.5)
    expect(at('potato')).toBe(14.4)
    expect(at('wheat')).toBe(13.4)
    expect(at('barley')).toBe(11.7)
    expect(at('canola')).toBe(13)
    expect(at('dry_bean')).toBe(8.5)
    expect(at('pea')).toBe(8.6)
    expect(at('green_feed')).toBe(6.7)
  })

  it('matches crop names to their sheet', () => {
    expect(cropWaterFor('High-Moisture Corn')?.key).toBe('grain_corn')
    expect(cropWaterFor('Silage Corn')?.key).toBe('silage_corn')
    expect(cropWaterFor('Beans-Pinto')?.key).toBe('dry_bean')
    expect(cropWaterFor('Durum Wheat')?.key).toBe('wheat')
    expect(cropWaterFor('Alfalfa Seed')).toBeNull()
    expect(cropWaterFor('Sainfoin')).toBeNull()
    expect(cropWaterFor('Soybeans')).toBeNull()
  })

  it('keeps less rain on a sandy soil, never more than a loam', () => {
    expect(scsStorageFactor(75)).toBeCloseTo(1, 1)
    const potato = cropWaterFor('Potato')!
    // #2 is a loamy sand, 115 mm/m.
    const sand = soilRainFactor(potato, 115)
    expect(sand).toBeLessThan(0.92)
    expect(sand).toBeGreaterThan(0.85)
    expect(soilRainFactor(potato, 220)).toBe(1)
    expect(soilRainFactor(potato, null)).toBe(1)
  })

  it('reads a profile’s water-holding per metre', () => {
    expect(profileAwhc([{ depth_cm: 15, aw_fc_mm: 17.3 }, { depth_cm: 100, aw_fc_mm: 115.1 }])).toBeCloseTo(115.1, 5)
    expect(profileAwhc([{ depth_cm: 60, aw_fc_mm: 60 }])).toBeCloseTo(100, 5)
    expect(profileAwhc(null)).toBeNull()
  })

  it('takes one AIMM season half way', () => {
    const cal = aimmCalibration([{ year: 2026, cropName: 'Grain Corn', days: 150, potentialEtcMm: 440, effectiveIrrigationMm: 200, overIrrigationMm: 20, stressDays: 5 }])
    // 440 / 550 = 0.8 → 0.9; 10% drained → 5%.
    expect(cal.etFactor).toBeCloseTo(0.9, 5)
    expect(cal.lossShare).toBeCloseTo(0.05, 5)
    // A late-planted season (Crown Hill's green feed, 98 days) says nothing;
    // an odd one moves the need at most 15% after one season.
    expect(aimmCalibration([{ year: 2026, cropName: 'Green Feed', days: 98, potentialEtcMm: 327, effectiveIrrigationMm: 0, overIrrigationMm: 0, stressDays: 68 }]).seasons).toBe(0)
    expect(aimmCalibration([{ year: 2026, cropName: 'Grain Corn', days: 125, potentialEtcMm: 300, effectiveIrrigationMm: 0, overIrrigationMm: 0, stressDays: 66 }]).etFactor).toBeCloseTo(0.85, 5)
    // An unknown crop says nothing.
    expect(aimmCalibration([{ year: 2026, cropName: 'Sainfoin', days: 150, potentialEtcMm: 400, effectiveIrrigationMm: 0, overIrrigationMm: 0, stressDays: 0 }]).seasons).toBe(0)
  })

  it('moves a field off the farm figure for soil, pivot and AIMM', () => {
    const loam = fieldNeed({ cropName: 'Potato', farmIn: 14.4, awhcMmM: 180, efficiency: 0.84 })
    expect(loam.needIn).toBeCloseTo(14.4, 5)
    const sandy = fieldNeed({ cropName: 'Potato', farmIn: 14.4, awhcMmM: 115, efficiency: 0.84 })
    expect(sandy.needIn!).toBeGreaterThan(15)
    // A better pivot needs less at the pivot.
    expect(fieldNeed({ cropName: 'Potato', farmIn: 14.4, awhcMmM: 180, efficiency: 0.9 }).needIn!).toBeCloseTo((14.4 * 0.84) / 0.9, 5)
    // A manager's own figure is the base it scales.
    expect(fieldNeed({ cropName: 'Potato', farmIn: 12, awhcMmM: 115, efficiency: 0.84 }).needIn!).toBeCloseTo((12 * sandy.needIn!) / 14.4, 5)
    // No Alberta sheet: only the pivot moves it.
    expect(fieldNeed({ cropName: 'Sainfoin', farmIn: 14, awhcMmM: 115, efficiency: 0.84 }).needIn).toBeCloseTo(14, 5)
    expect(fieldNeed({ cropName: 'Sainfoin', farmIn: null, awhcMmM: 115, efficiency: 0.84 }).needIn).toBeNull()
  })
})
