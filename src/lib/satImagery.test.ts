import { describe, expect, it } from 'vitest'
import { rasterSize, IMAGE_SIZE } from '../../netlify/shared/sat-imagery'

/** A bbox of roughly `metres` across, near the farm's latitude. */
const boxOf = (metres: number): [number, number, number, number] => {
  const lat = 52.4
  const dLat = metres / 111_132
  const dLon = metres / (111_320 * Math.cos((lat * Math.PI) / 180))
  return [-108.8, lat, -108.8 + dLon, lat + dLat]
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
