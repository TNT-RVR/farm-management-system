import { describe, expect, it } from 'vitest'
import type { MultiPolygon, Polygon } from 'geojson'
import { fieldAt, metresBetween, movedEnough, pointInBoundary } from './geofence'

/** A square roughly a quarter section, near East Ranch. */
const square: Polygon = {
  type: 'Polygon',
  coordinates: [
    [
      [-108.8, 52.4],
      [-108.79, 52.4],
      [-108.79, 52.41],
      [-108.8, 52.41],
      [-108.8, 52.4],
    ],
  ],
}

/** The same square with a hole punched out of the middle — a slough, say. */
const withHole: Polygon = {
  type: 'Polygon',
  coordinates: [
    square.coordinates[0],
    [
      [-108.797, 52.403],
      [-108.793, 52.403],
      [-108.793, 52.407],
      [-108.797, 52.407],
      [-108.797, 52.403],
    ],
  ],
}

describe('pointInBoundary', () => {
  it('knows inside from outside', () => {
    expect(pointInBoundary(-108.795, 52.405, square)).toBe(true)
    expect(pointInBoundary(-108.81, 52.405, square)).toBe(false)
    expect(pointInBoundary(-108.795, 52.45, square)).toBe(false)
  })

  it('treats a hole as outside', () => {
    // Dead centre, which is inside the outer ring and inside the hole.
    expect(pointInBoundary(-108.795, 52.405, withHole)).toBe(false)
    // Still in the field, just not in the slough.
    expect(pointInBoundary(-108.799, 52.4005, withHole)).toBe(true)
  })

  it('handles a multipolygon', () => {
    const multi: MultiPolygon = { type: 'MultiPolygon', coordinates: [square.coordinates] }
    expect(pointInBoundary(-108.795, 52.405, multi)).toBe(true)
    expect(pointInBoundary(-108.7, 52.405, multi)).toBe(false)
  })

  it('says no rather than throwing when there is no boundary', () => {
    expect(pointInBoundary(-108.795, 52.405, null)).toBe(false)
    expect(pointInBoundary(-108.795, 52.405, undefined)).toBe(false)
  })
})

describe('fieldAt', () => {
  it('finds the field a point sits in', () => {
    expect(
      fieldAt(-108.795, 52.405, [
        { fieldId: 'other', boundary: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } },
        { fieldId: 'ours', boundary: square },
      ]),
    ).toBe('ours')
  })

  it('is null out on the road', () => {
    expect(fieldAt(-108.85, 52.45, [{ fieldId: 'ours', boundary: square }])).toBeNull()
  })
})

describe('metresBetween', () => {
  it('measures a short hop about right', () => {
    // A hundredth of a degree of latitude is roughly 1.1 km.
    expect(metresBetween(-108.8, 52.4, -108.8, 52.41)).toBeGreaterThan(1050)
    expect(metresBetween(-108.8, 52.4, -108.8, 52.41)).toBeLessThan(1160)
  })

  it('is zero for the same point', () => {
    expect(metresBetween(-108.8, 52.4, -108.8, 52.4)).toBe(0)
  })
})

describe('movedEnough', () => {
  it('ignores a stationary phone twitching', () => {
    // GPS noise of a few metres must not re-trigger the check.
    expect(movedEnough({ lng: -108.8, lat: 52.4 }, { lng: -108.80002, lat: 52.40001 })).toBe(false)
  })

  it('notices a real move', () => {
    expect(movedEnough({ lng: -108.8, lat: 52.4 }, { lng: -108.8, lat: 52.402 })).toBe(true)
  })

  it('always checks the first reading', () => {
    expect(movedEnough(null, { lng: -108.8, lat: 52.4 })).toBe(true)
  })
})
