import { describe, expect, it } from 'vitest'
import { equipmentKind, isInspected, kindOptions } from './equipment-types'

describe('equipment kinds', () => {
  it('gathers Deere types into the kinds a person asks for', () => {
    expect(equipmentKind('Truck')).toBe('trucks')
    expect(equipmentKind('Pickup Truck')).toBe('trucks')
    expect(equipmentKind('Trailers')).toBe('trailers')
    expect(equipmentKind('Trailed Sprayers')).toBe('sprayers')
    expect(equipmentKind('Two-wheel Drive Tractors - Under 90 Hp')).toBe('tractors')
    expect(equipmentKind('Track Tractor')).toBe('tractors')
    expect(equipmentKind('Header Equipment')).toBe('combines')
    expect(equipmentKind('Round Baler')).toBe('hay')
    expect(equipmentKind('Air Seeder')).toBe('seeding')
    expect(equipmentKind('Forklift')).toBe('other')
    expect(equipmentKind(null)).toBe('other')
  })

  it('offers only the kinds present, All first and Other last', () => {
    expect(kindOptions(['Truck', 'Truck', 'Trailers', null])).toEqual([
      { key: 'all', label: 'All', count: 4 },
      { key: 'trucks', label: 'Trucks', count: 2 },
      { key: 'trailers', label: 'Trailers', count: 1 },
      { key: 'other', label: 'Other', count: 1 },
    ])
  })

  it('inspects semis and trailers, not pickups', () => {
    expect(isInspected('Truck')).toBe(true)
    expect(isInspected('Trailers')).toBe(true)
    expect(isInspected('Pickup Truck')).toBe(false)
  })
})
