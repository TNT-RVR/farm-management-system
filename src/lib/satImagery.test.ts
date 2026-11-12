import { describe, expect, it } from 'vitest'
import { rasterSize, IMAGE_SIZE, ndviRasterEvalscript } from '../../netlify/shared/sat-imagery'

/** A bbox of roughly `metres` across, near the farm's latitude. */
const boxOf = (metres: number): [number, number, number, number] => {
  const lat = 52.4
  const dLat = metres / 111_132
  const dLon = metres / (111_320 * Math.cos((lat * Math.PI) / 180))
  return [-113.6, lat, -113.6 + dLon, lat + dLat]
}

describe('rasterSize', () => {
  it('gives one output pixel per 10 m of ground', () => {
    // The whole point: an NDVI raster must show what was measured, at the size
    // it was measured. A 520 m field is ~52 real pixels across and no output
    // size makes that number larger.
    const { width, height } = rasterSize(boxOf(520))
    expect(width).toBeGreaterThanOrEqual(50)
    expect(width).toBeLessThanOrEqual(55)
    expect(height).toBeGreaterThanOrEqual(50)
    expect(height).toBeLessThanOrEqual(55)
  })

  it('scales with the field rather than using one fixed size', () => {
    const small = rasterSize(boxOf(300))
    const large = rasterSize(boxOf(1600))
    expect(large.width).toBeGreaterThan(small.width * 4)
  })

  it('does not upsample an ordinary field to meet a floor', () => {
    // The floor is only a guard against a degenerate box. Set too high it
    // quietly upsamples real fields by a non-integer factor, which invents
    // detail and makes the pixel grid visibly uneven.
    const small = rasterSize(boxOf(300))
    expect(small.width).toBeGreaterThanOrEqual(28)
    expect(small.width).toBeLessThanOrEqual(32)
  })

  it('refuses to blow up on a section-sized paddock', () => {
    // Pasture K is 1,666 acres. Uncapped this would ask for a very large image
    // to resolve detail the sensor never had.
    const huge = rasterSize(boxOf(60_000))
    expect(huge.width).toBeLessThanOrEqual(2048)
  })

  it('corrects longitude for latitude', () => {
    // A degree of longitude is ~64 km at 52.4°N, not 111. Without the cosine
    // the raster would be stretched east-west by a third.
    const square = rasterSize(boxOf(1000))
    expect(Math.abs(square.width - square.height)).toBeLessThanOrEqual(2)
  })

  it('is independent of the photograph size', () => {
    // The photograph is a fixed square because smoothing is cosmetic there;
    // the data layer is sized to the measurement. Coupling them would drag one
    // of the two decisions along with the other.
    expect(IMAGE_SIZE).toBe(1024)
    expect(rasterSize(boxOf(520)).width).not.toBe(IMAGE_SIZE)
  })
})

describe('the index raster evalscript', () => {
  /**
   * Run the generated script the way Sentinel Hub does, so the test exercises
   * the real string rather than a paraphrase of it. The script is plain ES5
   * with no imports, so a Function wrapper is a faithful enough host: it only
   * has to define setup/shade/evaluatePixel and hand evaluatePixel back.
   */
  const evaluator = (lo: number, hi: number, index: 'ndvi' | 'ndre' = 'ndvi') => {
    const script = ndviRasterEvalscript(lo, hi, index).replace('//VERSION=3', '')
    return new Function(`${script}; return evaluatePixel;`)() as (
      s: Record<string, number>,
    ) => number[]
  }
  /** A pixel that passes every mask, so only the arithmetic is under test. */
  const px = (nir: number, red: number) => ({ B08: nir, B04: red, B05: red, SCL: 4, CLP: 0, dataMask: 1 })

  it('leaves a hole where the index has no denominator', () => {
    // Both bands exactly zero divides nothing by nothing. dataMask does not
    // catch it -- a pixel at the edge of a scene's footprint can read zero
    // reflectance and still be "in" the data. Unguarded, Math.round(NaN * 6)
    // indexes the colour ramp with NaN, shade() hands back undefined, and the
    // whole request dies as "evalscript.js:37: TypeError". That is how the
    // biggest paddocks lost their NDVI, NDRE and per-field rasters on scene
    // after scene while true colour of the same scene came back fine.
    const evaluatePixel = evaluator(0.15, 0.95)
    expect(() => evaluatePixel(px(0, 0))).not.toThrow()
    expect(evaluatePixel(px(0, 0))).toEqual([0, 0, 0, 0])
  })

  it('survives a degenerate scale, which divides by zero the other way', () => {
    const evaluatePixel = evaluator(0.5, 0.5)
    expect(() => evaluatePixel(px(0.4, 0.1))).not.toThrow()
    const out = evaluatePixel(px(0.4, 0.1))
    expect(out).toHaveLength(4)
    expect(out.every((n) => Number.isFinite(n))).toBe(true)
  })

  it('still paints a real reading', () => {
    // The guard must not swallow ordinary pixels: NDVI 0.6 is mid-ramp and
    // opaque, not a hole.
    const evaluatePixel = evaluator(0.15, 0.95)
    const out = evaluatePixel(px(0.4, 0.1))
    expect(out[3]).toBe(1)
    expect(out.slice(0, 3).some((n) => n > 0)).toBe(true)
  })

  it('masks cloud and nodata as before', () => {
    const evaluatePixel = evaluator(0.15, 0.95)
    expect(evaluatePixel({ ...px(0.4, 0.1), dataMask: 0 })).toEqual([0, 0, 0, 0])
    expect(evaluatePixel({ ...px(0.4, 0.1), SCL: 9 })).toEqual([0, 0, 0, 0])
    expect(evaluatePixel({ ...px(0.4, 0.1), CLP: 0.9 })).toEqual([0, 0, 0, 0])
  })
})
