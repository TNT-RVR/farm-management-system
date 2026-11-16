import { describe, expect, it } from 'vitest'
import { cleanBreakout, cropFallbackDockage, type BreakoutLoad } from './clean-breakout'

const load = (p: Partial<BreakoutLoad>): BreakoutLoad => ({
  net_kg: 0,
  bushels: 0,
  weight_cleaned: false,
  delivery_site_id: null,
  ...p,
})

/** A bin load: field-run, 60 lb/bu beans. */
const bin = (kg: number) => load({ net_kg: kg, bushels: (kg * 2.20462262) / 60 })
/** A load hauled to the plant, weight field-run. */
const toPlant = (kg: number, dockage?: number) =>
  load({ net_kg: kg, bushels: (kg * 2.20462262) / 60, delivery_site_id: 'bunge', dockage_pct: dockage ?? null })
/** A load hauled to the plant whose only weight is the clean one. */
const cleanedToPlant = (kg: number) =>
  load({ net_kg: kg, bushels: (kg * 2.20462262) / 60, delivery_site_id: 'bunge', weight_cleaned: true })

describe('cleanBreakout', () => {
  it('leaves an all-field-run season alone', () => {
    const b = cleanBreakout([bin(100_000), bin(50_000)], null)
    expect(b.stored.fieldRunKg).toBe(150_000)
    expect(b.stored.cleanKg).toBeNull()
    expect(b.plant.loads).toBe(0)
    expect(b.mixed).toBe(false)
  })

  it('takes the crop average off grain still in the bin, and says it is not measured', () => {
    const b = cleanBreakout([bin(100_000)], 5.6)
    expect(b.stored.cleanKg).toBeCloseTo(94_400, 6)
    expect(b.stored.measured).toBe(false)
    expect(b.fallbackPct).toBe(5.6)
  })

  it('uses a load’s own receipt dockage and calls that measured', () => {
    const b = cleanBreakout([toPlant(40_000, 5.2)], 5.6)
    expect(b.plant.cleanKg).toBeCloseTo(37_920, 6)
    expect(b.plant.measured).toBe(true)
  })

  /**
   * 5/Creek Flat, 2026: three bins of pinto field-run and one load whose only
   * weight is the clean one. The whole point of the split.
   */
  it('grosses a cleaned load back up to field-run', () => {
    const b = cleanBreakout([bin(49_325), bin(91_440), bin(87_010), cleanedToPlant(45_590)], 5.6)
    expect(b.mixed).toBe(true)
    expect(b.stored.fieldRunKg).toBe(227_775)
    expect(b.plant.cleanKg).toBe(45_590)
    expect(b.plant.fieldRunKg).toBeCloseTo(48_294.49, 1)
    // The clean weight was measured; the field-run figure beside it was not.
    expect(b.plant.measured).toBe(true)
    expect(b.plant.fieldRunMeasured).toBe(false)
    expect(b.stored.fieldRunMeasured).toBe(true)
    expect(b.stored.measured).toBe(false)
    expect(b.total.fieldRunMeasured).toBe(false)
    expect(b.total.fieldRunKg).toBeCloseTo(276_069.49, 1)
    // In pounds, what the field's yield row reads: 608,628.5. The database
    // rounds each bin load's bushels to two places on the way through
    // grain_movements, so it lands about half a pound lower in 608,000.
    expect(b.total.fieldRunKg * 2.20462262).toBeGreaterThan(608_627)
    expect(b.total.fieldRunKg * 2.20462262).toBeLessThan(608_630)
  })

  it('a cleaned load with no dockage anywhere stands for its own weight, unmeasured', () => {
    const b = cleanBreakout([cleanedToPlant(45_590)], null)
    expect(b.plant.fieldRunKg).toBe(45_590)
    expect(b.plant.cleanKg).toBe(45_590)
    expect(b.plant.measured).toBe(false)
  })

  it('one load with no dockage voids its side’s clean total rather than half-counting', () => {
    const b = cleanBreakout([toPlant(40_000, 5.2), toPlant(40_000)], null)
    expect(b.plant.cleanKg).toBeNull()
    expect(b.total.cleanKg).toBeNull()
    expect(b.plant.fieldRunKg).toBe(80_000)
  })

  it('ignores a dockage that cannot be one', () => {
    expect(cleanBreakout([bin(100_000)], 0)?.stored.cleanKg).toBeNull()
    expect(cleanBreakout([bin(100_000)], 80)?.stored.cleanKg).toBeNull()
    expect(cleanBreakout([toPlant(40_000, 90)], 5.6).plant.cleanKg).toBeCloseTo(37_760, 6)
  })

  it('counts bushels the same way as kilograms', () => {
    const b = cleanBreakout([cleanedToPlant(45_590)], 5.6)
    expect(b.plant.fieldRunBu).toBeCloseTo((48_294.49 * 2.20462262) / 60, 1)
  })
})

describe('cropFallbackDockage', () => {
  const t = (crop_id: string | null, crop_year: number, dockage_pct: number | null) => ({ crop_id, crop_year, dockage_pct })

  it('prefers the crop year’s own receipts', () => {
    const rows = [t('pinto', 2026, 5.2), t('pinto', 2026, 5.9), t('pinto', 2026, 5.7), t('pinto', 2025, 12)]
    expect(cropFallbackDockage(rows, 'pinto', 2026, null)).toBe(5.6)
  })

  it('falls back to any year, then to the crop’s estimate', () => {
    expect(cropFallbackDockage([t('pinto', 2025, 4)], 'pinto', 2026, null)).toBe(4)
    expect(cropFallbackDockage([], 'pinto', 2026, 3.5)).toBe(3.5)
    expect(cropFallbackDockage([], 'pinto', 2026, null)).toBeNull()
    expect(cropFallbackDockage([], 'pinto', 2026, 0)).toBeNull()
  })

  it('skips other crops and unusable figures', () => {
    expect(cropFallbackDockage([t('gn', 2026, 9), t('pinto', 2026, null)], 'pinto', 2026, null)).toBeNull()
  })
})
