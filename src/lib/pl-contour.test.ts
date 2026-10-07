import { describe, expect, it } from 'vitest'
import { bandBreaks, bandOf, colourAt, contourLines, imageCorners, rasterize, smooth, upsample } from './pl-contour'

const grid = (w: number, h: number, f: (x: number, y: number) => number | null) => {
  const cells: { gx: number; gy: number; value: number }[] = []
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = f(x, y)
      if (v != null) cells.push({ gx: 100 + x, gy: 200 + y, value: v })
    }
  return rasterize(cells)!
}

describe('smooth', () => {
  it('leaves a flat field flat, edges included', () => {
    const s = smooth(grid(10, 10, () => 500))
    for (const v of s.v) expect(v).toBeCloseTo(500, 4)
  })

  it('knocks down a single wild square', () => {
    const s = smooth(grid(9, 9, (x, y) => (x === 4 && y === 4 ? 5000 : 500)))
    expect(s.v[4 * 9 + 4]).toBeLessThan(2500)
  })

  it('does not fade the field edge toward zero', () => {
    // Crop on the west half; one far square keeps the raster six wide.
    const s = smooth(grid(6, 6, (x, y) => (x < 3 || (x === 5 && y === 5) ? 400 : null)))
    expect(s.v[0]).toBeCloseTo(400, 4)
    expect(s.v[2]).toBeCloseTo(400, 4)
    // Open ground beside the crop stays empty.
    expect(Number.isNaN(s.v[4])).toBe(true)
  })

  it('fills a pinhole but not open ground', () => {
    const s = smooth(grid(5, 5, (x, y) => (x === 2 && y === 2 ? null : 300)))
    expect(s.v[2 * 5 + 2]).toBeCloseTo(300, 4)
  })
})

describe('bandBreaks', () => {
  it('uses a round step and puts a line at break-even', () => {
    const b = bandBreaks([-230, 910])
    expect(b).toContain(0)
    const steps = new Set(b.slice(1).map((v, i) => Math.round(v - b[i])))
    expect(steps.size).toBe(1)
    expect([...steps][0]).toBe(200)
  })
})

describe('bandOf', () => {
  it('counts the breaks at or below the value', () => {
    expect(bandOf(-50, [0, 200])).toBe(0)
    expect(bandOf(0, [0, 200])).toBe(1)
    expect(bandOf(250, [0, 200])).toBe(2)
  })
})

describe('upsample and contours', () => {
  // West to east, $0 to $900/ac.
  const r = grid(10, 4, (x) => x * 100)
  const img = upsample(r, 4)

  it('is north-up and keeps the values', () => {
    expect(img.w).toBe(40)
    expect(img.h).toBe(16)
    // The outermost pixels sit past the edge cells' centres, so they read those cells exactly.
    expect(img.v[1]).toBeCloseTo(0, 3) // west edge
    expect(img.v[img.w - 2]).toBeCloseTo(900, 3) // east edge
  })

  it('draws a north-south line where a west-east gradient crosses the break', () => {
    const [line] = contourLines(img, [450], imageCorners(r))
    const lons = line.segments.flat().map((p) => p[0])
    // Every point of the 450 line sits at the same longitude, halfway across.
    expect(Math.max(...lons) - Math.min(...lons)).toBeLessThan(1e-9)
  })
})

describe('colourAt', () => {
  it('interpolates between stops', () => {
    const stops = [
      { value: 0, colour: '#000000' },
      { value: 100, colour: '#ffffff' },
    ]
    expect(colourAt(stops, 50)).toEqual([128, 128, 128])
    expect(colourAt(stops, -10)).toEqual([0, 0, 0])
  })
})
