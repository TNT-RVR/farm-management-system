import { describe, expect, it } from 'vitest'
import {
  CLEAR_EXPRESSION,
  NDVI_EXPRESSION,
  L2_OFFSET,
  L2_SCALE,
} from '../../netlify/shared/sat-landsat'

/** The expression the endpoint evaluates, run here on the same arithmetic. */
const evaluate = (expr: string, bands: Record<string, number>): number => {
  const names = Object.keys(bands)
  // eslint-disable-next-line no-new-func
  const fn = new Function(...names, 'where', `return ${expr}`)
  return fn(...names.map((n) => bands[n]), (c: boolean, a: number, b: number) => (c ? a : b))
}

describe('the Landsat scaling correction', () => {
  it('matches the published Collection 2 surface reflectance transform', () => {
    expect(L2_SCALE).toBe(0.0000275)
    expect(L2_OFFSET).toBe(-0.2)
  })

  it('agrees with NDVI computed from unscaled reflectance', () => {
    // The real means from field 0 on 29 July 2026, LC08_L2SP_040025.
    const red = 8654.9557
    const nir08 = 21363.731
    const sr = (dn: number) => dn * L2_SCALE + L2_OFFSET
    const expected = (sr(nir08) - sr(red)) / (sr(nir08) + sr(red))
    expect(evaluate(NDVI_EXPRESSION, { red, nir08 })).toBeCloseTo(expected, 12)
  })

  it('lands where the live endpoint landed, not where raw DN would', () => {
    // NDVI is invariant under a scale factor but NOT under the offset. Raw DN
    // gives 0.4230 for this field — a plausible-looking number for a crop in
    // trouble, and wrong by nearly half. The endpoint returned 0.8204.
    //
    // Not exactly 0.8204: the endpoint averages NDVI per pixel, this averages
    // the bands and then takes the ratio, and a ratio of means is not the mean
    // of ratios. The 0.0009 between them is that difference and nothing else —
    // small here because the field is uniform. The point of the assertion is
    // the 0.4 gap against raw DN, not the third decimal.
    const red = 8654.9557
    const nir08 = 21363.731
    expect(evaluate(NDVI_EXPRESSION, { red, nir08 })).toBeCloseTo(0.8204, 2)
    const rawDn = (nir08 - red) / (nir08 + red)
    expect(rawDn).toBeCloseTo(0.423, 3)
  })

  it('agrees with Sentinel-2 on the same field within the week', () => {
    // Sentinel-2 read 0.879 on 4 August; Landsat reads 0.820 on 29 July.
    // Independent sensors and processing chains, so this is the corroboration
    // that the ~0.44 smoke readings were the contaminated ones.
    const ndvi = evaluate(NDVI_EXPRESSION, { red: 8654.9557, nir08: 21363.731 })
    expect(Math.abs(ndvi - 0.879)).toBeLessThan(0.1)
  })
})

describe('the clear-sky expression', () => {
  const clear = (qa_pixel: number) => evaluate(CLEAR_EXPRESSION, { qa_pixel })

  it('accepts the Collection 2 clear codes', () => {
    expect(clear(21824)).toBe(1) // clear land
    expect(clear(21952)).toBe(1) // clear water
  })

  it('rejects cloud, shadow and snow', () => {
    expect(clear(22080)).toBe(0)
    expect(clear(22280)).toBe(0) // dilated cloud
    expect(clear(23888)).toBe(0) // cloud
    expect(clear(24088)).toBe(0) // cloud shadow
    expect(clear(30048)).toBe(0) // snow
    expect(clear(54596)).toBe(0) // cirrus, high confidence
  })

  it('uses no operator the endpoint rejects', () => {
    // Bitwise operators and added comparisons both return 500 from TiTiler.
    // The threshold form is the one that survives, and this test is here so a
    // later "tidy-up" into the bitwise form fails locally instead of in prod.
    expect(CLEAR_EXPRESSION).not.toMatch(/&|\|/)
    expect(NDVI_EXPRESSION).not.toMatch(/&|\||nan/)
  })
})
