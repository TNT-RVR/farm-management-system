import { describe, expect, it } from 'vitest'
import type { Feature } from 'geojson'
import { featureKey, isIrrigatedFieldFeature, isWaterPlumbing } from './mymap-hidden'

const f = (layer: string, name: string, geometry: Feature['geometry']): Feature => ({
  type: 'Feature',
  properties: { _layer: layer, name },
  geometry,
})

describe('featureKey', () => {
  it('tells two same-named pins apart by where they are', () => {
    const a = f('Water', 'Abandoned Well', { type: 'Point', coordinates: [-108.7, 52.4] })
    const b = f('Water', 'Abandoned Well', { type: 'Point', coordinates: [-108.71, 52.4] })
    expect(featureKey(a)).not.toBe(featureKey(b))
    expect(featureKey(a)).toBe('Water|Point|Abandoned Well|-108.70000,52.40000')
  })

  it('keys a polygon by its first corner', () => {
    const p = f('Lease Land/Irrigated Fields', 'Lease (NE 13-71-14 W4)', {
      type: 'Polygon',
      coordinates: [[[-108.5, 52.3], [-108.4, 52.3], [-108.4, 52.4], [-108.5, 52.3]]],
    })
    expect(featureKey(p)).toBe('Lease Land/Irrigated Fields|Polygon|Lease (NE 13-71-14 W4)|-108.50000,52.30000')
  })
})

describe('what the cattle map leaves out by default', () => {
  it('drops the pivots from the lease layer and keeps the leases', () => {
    const poly: Feature['geometry'] = { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }
    expect(isIrrigatedFieldFeature(f('Lease Land/Irrigated Fields', '#6 (Kellers)', poly))).toBe(true)
    expect(isIrrigatedFieldFeature(f('Lease Land/Irrigated Fields', 'Lease (SW 7-71-13 W4)', poly))).toBe(false)
    expect(isIrrigatedFieldFeature(f('Gates', '#6', poly))).toBe(false)
  })

  it('drops pipes and pumps from the water layer and keeps the dugouts', () => {
    expect(isWaterPlumbing(f('Water', '#4 Mainline', { type: 'LineString', coordinates: [[0, 0], [1, 1]] }))).toBe(true)
    expect(isWaterPlumbing(f('Water', 'North Turbine', { type: 'Point', coordinates: [0, 0] }))).toBe(true)
    expect(isWaterPlumbing(f('Water', 'Old Dugout', { type: 'Point', coordinates: [0, 0] }))).toBe(false)
  })
})
