import { describe, expect, it } from 'vitest'
import { classifyWaterName, newPinsFrom } from './cattle-water'

describe('classifyWaterName', () => {
  it('reads the drinkable kinds off the name', () => {
    expect(classifyWaterName('Old Dugout')).toEqual({ kind: 'dugout', drinkable: true })
    expect(classifyWaterName('West Water Trough')).toEqual({ kind: 'trough', drinkable: true })
    expect(classifyWaterName('Sec 12 Slough')).toEqual({ kind: 'pond', drinkable: true })
  })

  it('knows plumbing is not a drink', () => {
    expect(classifyWaterName('Maple (#9) Pump').drinkable).toBe(false)
    expect(classifyWaterName('Pivot #3').drinkable).toBe(false)
    expect(classifyWaterName('Windmill Hydrant').drinkable).toBe(false)
    expect(classifyWaterName('Barnyard Well')).toEqual({ kind: 'well', drinkable: false })
    expect(classifyWaterName('Potential Trough').drinkable).toBe(false)
    expect(classifyWaterName('Water for Flood Irrigation').drinkable).toBe(false)
  })

  it('takes an unnamed pin as drinkable, to be corrected rather than hidden', () => {
    expect(classifyWaterName('')).toEqual({ kind: 'other', drinkable: true })
    expect(classifyWaterName(null)).toEqual({ kind: 'other', drinkable: true })
  })
})

describe('newPinsFrom', () => {
  it('leaves out pins already placed within ten metres', () => {
    const existing = [{ lon: -108.79, lat: 52.396 }]
    const pins = [
      { lon: -108.79, lat: 52.396, name: 'same' },
      { lon: -108.79005, lat: 52.396, name: 'four metres off' },
      { lon: -108.795, lat: 52.396, name: 'a field away' },
    ]
    expect(newPinsFrom(pins, existing).map((p) => p.name)).toEqual(['a field away'])
  })
})
