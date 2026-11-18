import { describe, expect, it } from 'vitest'
import type { FieldRequirement } from './fertilizer-plan'
import type { Prescription } from './fertility-rx'
import { cropMismatches, rxAgainstSoilTest, sameCrop } from './rx-check'

const zone = (acres: number, n: number, p2o5 = 0, k2o = 0) => ({ id: String(Math.random()), zone: 1, fertility_index: null, acres, yield_goal: null, n, p2o5, k2o, s: null, extra: {}, products: {} })
const rx = (field_id: string | null, zones: ReturnType<typeof zone>[], crop = 'Corn'): Prescription => ({
  id: 'rx-' + field_id,
  crop_year: 2026,
  field_id,
  field_label: 'Label ' + field_id,
  legal: null,
  crop_type: crop,
  variety: null,
  acres: null,
  yield_goal: null,
  yield_unit: null,
  description: null,
  total_acres: zones.reduce((s, z) => s + z.acres, 0),
  products: [],
  source_file: null,
  source_page: null,
  zones,
})
const req = (fieldId: string, crop: string, nLines: number[], acres = 100): FieldRequirement => ({
  fieldId,
  fieldName: 'Field ' + fieldId,
  cropLabel: crop,
  acres,
  lines: nLines.map((n) => ({ nutrient: 'N', product: '46-0-0 urea', timing: null, lbPerAc: n, productLbPerAc: n / 0.46, productLbTotal: null, note: null })),
})

describe('rxAgainstSoilTest', () => {
  it('weights the Rx by zone acres and sets it beside the soil-test programme', () => {
    const [r] = rxAgainstSoilTest([rx('a', [zone(60, 240), zone(40, 210)])], [req('a', 'Corn', [40, 10])], new Map([['a', ['Grain Corn']]]))
    expect(r.rx.n).toBeCloseTo(228, 6)
    expect(r.test?.n).toBe(50)
    expect(r.nGap).toBeCloseTo(178, 6)
    expect(r.cropDiffers).toBe(false)
  })

  it('keeps a field with an Rx and no soil test, with no gap claimed', () => {
    const [r] = rxAgainstSoilTest([rx('b', [zone(113, 150)], 'Canola')], [], new Map())
    expect(r.test).toBeNull()
    expect(r.nGap).toBeNull()
    expect(r.fieldName).toBe('Label b')
  })

  it('leaves out an Rx tied to no field and puts the biggest ask first', () => {
    const rows = rxAgainstSoilTest(
      [rx(null, [zone(10, 100)]), rx('a', [zone(10, 100)]), rx('c', [zone(10, 200)])],
      [req('a', 'Corn', [90]), req('c', 'Corn', [50])],
      new Map(),
    )
    expect(rows.map((r) => r.fieldId)).toEqual(['c', 'a'])
  })
})

describe('sameCrop', () => {
  it('matches a crop to its plan names and catches a different crop', () => {
    expect(sameCrop('Corn', 'Grain Corn')).toBe(true)
    expect(sameCrop('Canola', 'Seed Canola')).toBe(true)
    expect(sameCrop('Potato (Chipper)', 'Potato - Creamer')).toBe(true)
    expect(sameCrop('Corn', 'Green Feed')).toBe(false)
    expect(sameCrop('Carrots', 'Beans-Great Northern')).toBe(false)
    expect(sameCrop('Potato (Fresh Pack)', 'Grain Corn')).toBe(false)
  })

  it('lists the fields whose soil test was written for another crop', () => {
    const m = cropMismatches([req('a', 'Carrots', [173]), req('b', 'Wheat', [90])], new Map([['a', ['Beans-Great Northern']], ['b', ['Spring Wheat']]]))
    expect(m).toEqual([{ fieldName: 'Field a', testCrop: 'Carrots', planCrops: ['Beans-Great Northern'] }])
  })
})
