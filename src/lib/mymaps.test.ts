import { describe, expect, it } from 'vitest'
import type { FeatureCollection } from 'geojson'
import { layerLegend } from './mymaps'

const fc = (features: unknown[]) => ({ type: 'FeatureCollection', features }) as FeatureCollection

const point = (layer: string, name: string, props: Record<string, string> = {}) => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [0, 0] },
  properties: { _layer: layer, name, ...props },
})

describe('layerLegend', () => {
  it('keeps one entry per name and colour, not one per feature', () => {
    const l = layerLegend(
      fc([
        point('Oil', 'Battery', { 'icon-color': '#ff0000' }),
        point('Oil', 'Battery', { 'icon-color': '#ff0000' }),
        point('Oil', 'Wellhead', { 'icon-color': '#00ff00' }),
      ]),
      'Oil',
    )
    expect(l).toEqual([
      { label: 'Battery', color: '#ff0000' },
      { label: 'Wellhead', color: '#00ff00' },
    ])
  })

  it('keeps the same name twice when the map draws it in two colours', () => {
    const l = layerLegend(
      fc([
        point('Oil', 'Well', { 'icon-color': '#ff0000' }),
        point('Oil', 'Well', { 'icon-color': '#0000ff' }),
      ]),
      'Oil',
    )
    expect(l).toHaveLength(2)
  })

  it('ignores features from other layers', () => {
    const l = layerLegend(fc([point('Oil', 'Well'), point('Gas', 'Riser')]), 'Oil')
    expect(l.map((e) => e.label)).toEqual(['Well'])
  })

  it('reads fill for polygons and stroke for lines', () => {
    const l = layerLegend(
      fc([
        {
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
          properties: { _layer: 'Leases', name: 'Lease A', fill: '#123456' },
        },
        {
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
          properties: { _layer: 'Leases', name: 'Pipeline', stroke: '#654321' },
        },
      ]),
      'Leases',
    )
    expect(l).toEqual([
      { label: 'Lease A', color: '#123456' },
      { label: 'Pipeline', color: '#654321' },
    ])
  })

  it('falls back to the layer name and Google blue rather than showing a blank', () => {
    const l = layerLegend(
      fc([{ type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { _layer: 'Oil' } }]),
      'Oil',
    )
    expect(l).toEqual([{ label: 'Oil', color: '#1a73e8' }])
  })
})
