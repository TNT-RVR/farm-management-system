import { describe, expect, it } from 'vitest'
import { nearestFencePair, shortName, stayMonths, type PlanMapPasture } from './plan-geo'

// Two squares sharing the fence at lng -113.55, and a third well off to the east.
const sq = (id: string, w: number, e: number): PlanMapPasture => ({
  id,
  name: id,
  geojson: {
    type: 'MultiPolygon',
    coordinates: [[[[w, 52.4], [e, 52.4], [e, 52.41], [w, 52.41], [w, 52.4]]]],
  },
})
const P = [sq('D', -113.56, -113.55), sq('F', -113.55, -113.54), sq('K', -113.5, -113.49)]

describe('nearestFencePair', () => {
  it('finds the two pastures either side of a tapped fence', () => {
    expect(nearestFencePair(P, [-113.5502, 52.405])?.sort()).toEqual(['D', 'F'])
  })
  it('gives nothing when only one fence is near', () => {
    expect(nearestFencePair(P, [-113.495, 52.405])).toBeNull()
  })
})

describe('shortName', () => {
  it('uses the letter and part', () => {
    expect(shortName('Pasture E- West')).toBe('E West')
    expect(shortName('Pasture D')).toBe('D')
    expect(shortName('Home quarter')).toBe('Home quarter')
  })
})

describe('stayMonths', () => {
  it('names the month a stay sits in', () => {
    expect(stayMonths('2027-05-01', '2027-05-21')).toBe('May')
  })
  it('names both when it spans two', () => {
    expect(stayMonths('2027-07-28', '2027-08-11')).toBe('Jul–Aug')
  })
  it('gives nothing for an unreadable date', () => {
    expect(stayMonths('', '')).toBe('')
  })
})
