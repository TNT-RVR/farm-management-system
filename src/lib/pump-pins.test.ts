import { describe, expect, it } from 'vitest'
import { featureNotes, mapLinkForPin, pinsByPump, placePumpIds, pumpsByFeature, type PumpPin } from './pump-pins'

describe('featureNotes', () => {
  it('reads the My Map html object, not "[object Object]"', () => {
    const props = { description: { '@type': 'html', value: 'Description: Drain in fall<br>Type: Pump<br>GPM Max: <br>Brand: Acme' } }
    expect(featureNotes(props)).toBe('Description: Drain in fall\nType: Pump\nBrand: Acme')
  })
  it('reads a plain string', () => {
    expect(featureNotes({ description: 'Open the valve' })).toBe('Open the valve')
  })
  it('is empty when there is nothing', () => {
    expect(featureNotes({})).toBe('')
    expect(featureNotes(null)).toBe('')
    expect(featureNotes({ description: { '@type': 'html', value: 'GPM Max: <br>Length: ' } })).toBe('')
  })
})

const pins: PumpPin[] = [
  { id: 'f1', layer_id: 'L', label: 'Pin A', pump_ids: ['p1'] },
  { id: 'f2', layer_id: 'L', label: 'Pins A and B', pump_ids: ['p1', 'p2'] },
]

describe('pin lookups', () => {
  it('finds every pin of a pump', () => {
    expect(pinsByPump(pins).get('p1')?.map((p) => p.id)).toEqual(['f1', 'f2'])
    expect(pinsByPump(pins).get('p2')?.map((p) => p.id)).toEqual(['f2'])
    expect(pinsByPump(undefined).size).toBe(0)
  })
  it('links to the map with the layer', () => {
    expect(mapLinkForPin(pins[0])).toBe('/map?pin=f1&pinLayer=L')
  })
})

describe('placePumpIds', () => {
  const byFeature = pumpsByFeature(pins)
  it('follows the pin a place was made from', () => {
    expect(placePumpIds({ feature_id: 'f2', source: 'mymap' }, byFeature)).toEqual(['p1', 'p2'])
  })
  it('reads a place made from the pump list', () => {
    expect(placePumpIds({ feature_id: null, source: 'pump:p9' }, byFeature)).toEqual(['p9'])
  })
  it('is empty for an ordinary place', () => {
    expect(placePumpIds({ feature_id: 'nope', source: 'drawn' }, byFeature)).toEqual([])
    expect(placePumpIds(undefined, byFeature)).toEqual([])
  })
})
