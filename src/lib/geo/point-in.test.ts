import { describe, expect, it } from 'vitest'
import type { MultiPolygon } from 'geojson'
import { locate, pointInMultiPolygon, pointInRing } from './point-in'

// A quarter section-ish square near Home Ranch, with a hole (a slough).
const square: MultiPolygon = {
  type: 'MultiPolygon',
  coordinates: [
    [
      [
        [-113.5, 52.3],
        [-113.49, 52.3],
        [-113.49, 52.307],
        [-113.5, 52.307],
        [-113.5, 52.3],
      ],
      [
        [-113.496, 52.303],
        [-113.494, 52.303],
        [-113.494, 52.305],
        [-113.496, 52.305],
        [-113.496, 52.303],
      ],
    ],
  ],
}

describe('pointInRing', () => {
  it('knows inside from outside', () => {
    expect(pointInRing([-113.495, 52.302], square.coordinates[0][0])).toBe(true)
    expect(pointInRing([-113.51, 52.302], square.coordinates[0][0])).toBe(false)
  })

  it('does not need the ring closed', () => {
    const open = square.coordinates[0][0].slice(0, -1)
    expect(pointInRing([-113.495, 52.302], open)).toBe(true)
  })
})

describe('pointInMultiPolygon', () => {
  it('treats the slough as not the field', () => {
    // Standing in the hole is standing in water, not in the crop.
    expect(pointInMultiPolygon([-113.495, 52.304], square)).toBe(false)
    expect(pointInMultiPolygon([-113.4905, 52.3065], square)).toBe(true)
  })
})

describe('locate', () => {
  const items = [{ item: 'home quarter', shape: square, anchor: [-113.495, 52.3035] as [number, number] }]

  it('names the field underfoot', () => {
    expect(locate([-113.492, 52.301], items)).toEqual({ item: 'home quarter', inside: true, distanceM: 0 })
  })

  it('offers the field from the headland just outside it', () => {
    // A truck parked at the approach is a few metres past the line and the
    // reading it is about to enter is still for this field.
    const r = locate([-113.5003, 52.3035], items)
    expect(r?.item).toBe('home quarter')
    expect(r?.inside).toBe(false)
  })

  it('offers nothing from the shop', () => {
    // Five kilometres off, a guess is worse than a blank.
    expect(locate([-113.55, 52.35], items)).toBeNull()
  })
})
