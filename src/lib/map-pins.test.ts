import { describe, expect, it } from 'vitest'
import { classifyPin, PINS, pinImageId, withPins } from './map-pins'

describe('which pin a My Maps point gets', () => {
  it.each([
    ['Gates', 'AC-1', '', 'gate'],
    ['Oil', '0114945', '', 'oil_well'],
    ['Oil', '0081102', 'Abandoned well', 'abandoned_oil_well'],
    ['Oil', 'Oil Battery 7-12', '', 'oil_battery'],
    ['Gas', 'Natural Gas Meter (Main Shop)', '', 'gas_meter'],
    ['Gas', 'Gas Meter (Secondary Line Shut Off)', '', 'gas_shutoff'],
    ['Electrical', 'Creek flat SW 27-71-13 Meter', '', 'power_meter'],
    ['Electrical', 'Turbines NW 18-71-13', '', 'wind_turbine'],
    ['Electrical', 'Shop transformer', '', 'transformer'],
    ['Electrical', 'Pivot power shut off', '', 'power_shutoff'],
    ['Water', 'Old Dugout', 'Meter #4', 'dugout'],
    ['Water', 'Abandoned Well', '', 'abandoned_water_well'],
    ['Water', 'Shop Yard', 'Well', 'water_well'],
    ['Water', 'Pivot 3', 'Meter 1122', 'pivot'],
    ['Water', 'River pump', '', 'pump'],
    ['Water', 'Turbine at the canal', '', 'pump'],
    ['Water', 'Yard hydrant', '', 'hydrant'],
    ['Water', 'East trough', '', 'trough'],
    ['Water', 'Meter 5', '', 'water_meter'],
    ['Historical Resources', 'Stone Circle', '', 'stone_circle'],
    ['Historical Resources', 'Stone Arc', '', 'stone_circle'],
    ['Historical Resources', 'Cairn', '', 'cairn'],
  ])('%s / %s', (layer, name, desc, want) => {
    expect(classifyPin(layer, { name, description: desc })).toBe(want)
  })

  it('reads the My Maps data columns, where historical sites keep what they are', () => {
    expect(classifyPin('Historical Resources', { name: '', description: '', Type: 'Stone Circle', 'Borden Number': 'XxXx-00' })).toBe('stone_circle')
    expect(classifyPin('Historical Resources', { name: '', Type: 'Cairn' })).toBe('cairn')
    // Style fields are not words about the point.
    expect(classifyPin('Historical Resources', { name: '', styleUrl: '#icon-circle' })).toBeNull()
  })

  it('works pins out at draw time, so an old saved download still gets them', () => {
    const fc = withPins({
      type: 'FeatureCollection' as const,
      features: [
        { type: 'Feature' as const, geometry: { type: 'Point' }, properties: { _layer: 'Oil', name: '0114945' } as Record<string, unknown> },
        { type: 'Feature' as const, geometry: { type: 'LineString' }, properties: { _layer: 'Oil', name: 'flowline' } as Record<string, unknown> },
      ],
    })
    expect(fc.features[0].properties?._pin).toBe('oil_well')
    expect(fc.features[1].properties?._pin).toBeUndefined()
  })

  it('leaves the rest as plain dots', () => {
    expect(classifyPin('Historical Resources', { name: 'Hearth' })).toBeNull()
    expect(classifyPin('Legal Land Descriptions', { name: 'NE 12-71-15' })).toBeNull()
    // "Charc…" is not an arc.
    expect(classifyPin('Historical Resources', { name: 'Charcoal scatter' })).toBeNull()
  })

  it('has an icon for every type it can return', () => {
    for (const k of Object.keys(PINS)) {
      expect(PINS[k as keyof typeof PINS].svg).toMatch(/^<(circle|rect)/)
      expect(pinImageId(k as keyof typeof PINS)).toBe(`pin-${k}`)
    }
  })
})

describe('oil well status', () => {
  it('tells RecCertified from Active, and inactive is not active', () => {
    expect(classifyPin('Oil', { name: '100/01-02', Status: 'RecCertified' })).toBe('oil_well_reccertified')
    expect(classifyPin('Oil', { name: '100/01-02', Status: 'Active' })).toBe('oil_well_active')
    expect(classifyPin('Oil', { name: '100/01-02', Status: 'Inactive' })).toBe('oil_well')
  })
})
