import { describe, expect, it } from 'vitest'
import { bearingBetween, circleRing, destination } from './circle'
import { haversineM } from './measure'

describe('circleRing', () => {
  it('keeps every point the radius from the centre and closes the ring', () => {
    const centre = [-113.54, 52.384]
    const ring = circleRing(centre, 800, 32)
    expect(ring).toHaveLength(33)
    expect(ring[0]).toEqual(ring[32])
    for (const p of ring) expect(Math.abs(haversineM(centre, p) - 800)).toBeLessThan(2)
  })

  it('starts due north and steps clockwise', () => {
    const centre = [-113.54, 52.384]
    const ring = circleRing(centre, 400, 4)
    expect(bearingBetween(centre, ring[0])).toBeCloseTo(0, 6)
    expect(bearingBetween(centre, ring[1])).toBeCloseTo(90, 1)
  })
})

describe('destination and bearingBetween', () => {
  it('walk out and point back the way they came', () => {
    const from = [-113.54, 52.384]
    for (const b of [0, 45, 135, 200, 315]) {
      const to = destination(from, b, 1500)
      expect(haversineM(from, to)).toBeCloseTo(1500, 0)
      expect(bearingBetween(from, to)).toBeCloseTo(b, 3)
    }
  })

  it('says north is 0 and west is 270, never negative', () => {
    expect(bearingBetween([-111, 49], [-111, 50])).toBeCloseTo(0, 6)
    expect(bearingBetween([-111, 49], [-112, 49])).toBeGreaterThan(269)
    expect(bearingBetween([-111, 49], [-112, 49])).toBeLessThan(271)
  })
})
