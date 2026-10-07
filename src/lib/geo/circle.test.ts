import { describe, expect, it } from 'vitest'
import { circleRing } from './circle'
import { haversineM } from './measure'

describe('circleRing', () => {
  it('keeps every point the radius from the centre and closes the ring', () => {
    const centre = [-108.74, 52.384]
    const ring = circleRing(centre, 800, 32)
    expect(ring).toHaveLength(33)
    expect(ring[0]).toEqual(ring[32])
    for (const p of ring) expect(Math.abs(haversineM(centre, p) - 800)).toBeLessThan(2)
  })
})
