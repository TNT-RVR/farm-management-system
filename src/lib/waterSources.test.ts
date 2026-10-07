import { describe, expect, it } from 'vitest'
import { isWaterSourceName, waterPointsFrom } from './water-sources'

describe('isWaterSourceName', () => {
  it('accepts the things cattle drink from', () => {
    for (const n of ['Dugout', 'North Pond', 'Watering hole', 'Water Hole 2', 'Trough by the gate']) {
      expect(isWaterSourceName(n)).toBe(true)
    }
  })

  it('rejects irrigation hardware', () => {
    for (const n of ['Pivot 3', 'Turbine', 'Pump house', 'Main pipeline']) {
      expect(isWaterSourceName(n)).toBe(false)
    }
  })

  it('lets exclusion win when a name contains both', () => {
    // The dangerous case: these read as water and are not drinkable. Treating
    // one as a source puts a confident 800 m grazing radius around a pump.
    expect(isWaterSourceName('Water pump')).toBe(false)
    expect(isWaterSourceName('Pivot pond corner')).toBe(false)
    expect(isWaterSourceName('Dugout pump')).toBe(false)
  })

  it('ignores case and surrounding words', () => {
    expect(isWaterSourceName('SOUTH DUGOUT (deep)')).toBe(true)
    expect(isWaterSourceName('the old slough')).toBe(true)
  })

  it('says no to an unnamed pin rather than guessing', () => {
    expect(isWaterSourceName('')).toBe(false)
    expect(isWaterSourceName(null)).toBe(false)
    expect(isWaterSourceName('Marker 4')).toBe(false)
  })
})

describe('waterPointsFrom', () => {
  const pt = (name: string, lon = -108.8, lat = 52.4): GeoJSON.Feature => ({
    type: 'Feature',
    properties: { name },
    geometry: { type: 'Point', coordinates: [lon, lat] },
  })

  it('keeps only the drinkable points', () => {
    const out = waterPointsFrom([pt('Dugout'), pt('Pivot 2'), pt('North pond')])
    expect(out.map((p) => p.name)).toEqual(['Dugout', 'North pond'])
  })

  it('ignores non-point geometry rather than guessing a centroid', () => {
    // A dugout drawn as a polygon would need a centroid, and which edge the
    // cattle stand at is not something to infer silently.
    const poly: GeoJSON.Feature = {
      type: 'Feature',
      properties: { name: 'Big dugout' },
      geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
    }
    expect(waterPointsFrom([poly])).toEqual([])
  })

  it('reads either casing of the name property', () => {
    const f: GeoJSON.Feature = {
      type: 'Feature',
      properties: { Name: 'Slough' },
      geometry: { type: 'Point', coordinates: [-108.8, 52.4] },
    }
    expect(waterPointsFrom([f])).toHaveLength(1)
  })

  it('drops a point with no usable coordinates', () => {
    const bad: GeoJSON.Feature = {
      type: 'Feature',
      properties: { name: 'Dugout' },
      geometry: { type: 'Point', coordinates: [Number.NaN, 52.4] },
    }
    expect(waterPointsFrom([bad])).toEqual([])
  })
})
