import { describe, expect, it } from 'vitest'
import { basisNote, basisWhy, cleanFromDockage, cleanRatioByCrop, dockagePct, resolveYield } from './clean-yield'

const row = (crop_id: string | null, yield_per_acre: number | null, clean_yield_per_acre: number | null) => ({
  crop_id,
  yield_per_acre,
  clean_yield_per_acre,
})

describe('dockage, both ways round', () => {
  it('works the percentage out from the two yields', () => {
    expect(dockagePct(50, 48)).toBe(4)
    expect(dockagePct(100, 100)).toBe(0)
  })

  it('works the clean yield out from the percentage', () => {
    expect(cleanFromDockage(50, 4)).toBe(48)
    expect(cleanFromDockage(50, 0)).toBe(50)
  })

  it('refuses what it cannot mean', () => {
    expect(dockagePct(0, 48)).toBeNull()
    expect(dockagePct(null, 48)).toBeNull()
    expect(dockagePct(50, null)).toBeNull()
    expect(cleanFromDockage(50, null)).toBeNull()
    expect(cleanFromDockage(50, -1)).toBeNull()
    // Half the load as dockage is a typing slip, not a clean-out.
    expect(cleanFromDockage(50, 60)).toBeNull()
  })
})

describe("a crop's average clean-out", () => {
  it('averages the fields that have both figures', () => {
    const m = cleanRatioByCrop([row('canola', 50, 48), row('canola', 100, 94), row('canola', 60, null)])
    // 0.96 and 0.94 average to 0.95; the field with no clean-out is not in it.
    expect(m.get('canola')!.ratio).toBeCloseTo(0.95, 6)
    expect(m.get('canola')!.fields).toBe(2)
  })

  it('leaves out what cannot be a clean-out', () => {
    const m = cleanRatioByCrop([
      row('beans', 50, 55), // cleaner than field-run
      row('beans', 50, 20), // less than half left
      row('beans', 0, 10), // nothing to compare with
      row(null, 50, 48), // no crop
      row('beans', 50, 49),
    ])
    expect(m.get('beans')).toEqual({ ratio: 0.98, fields: 1 })
  })

  it('has nothing to say about a crop nobody has cleaned', () => {
    expect(cleanRatioByCrop([row('corn', 180, null)]).get('corn')).toBeUndefined()
  })
})

describe('which yield to plan on', () => {
  const avg = { ratio: 0.95, fields: 4 }

  it("uses the field's own clean-out first, unmarked", () => {
    const r = resolveYield({ preClean: 50, clean: 48, cropAverage: avg })!
    expect(r).toEqual({ value: 48, basis: 'clean' })
    expect(basisNote(r)).toBeNull()
    expect(basisWhy(r)).toBeNull()
  })

  it("falls back to the crop's average, and says so", () => {
    const r = resolveYield({ preClean: 50, clean: null, cropAverage: avg })!
    expect(r.value).toBeCloseTo(47.5, 6)
    expect(r.basis).toBe('crop-average')
    expect(basisNote(r)).toBe('average clean-out (5%)')
    expect(basisWhy(r)).toContain('4 fields')
  })

  it('falls back to field-run only when the crop has no average either', () => {
    const r = resolveYield({ preClean: 50, clean: null, cropAverage: null })!
    expect(r).toEqual({ value: 50, basis: 'pre-clean' })
    expect(basisNote(r)).toBe('pre-clean')
  })

  it('has nothing to offer with no yield at all', () => {
    expect(resolveYield({ preClean: null, clean: null })).toBeNull()
    expect(resolveYield({ preClean: 0, clean: 0 })).toBeNull()
  })
})
