import { describe, expect, it } from 'vitest'
import { anchorOf, placeStatus } from './checklist-map'

describe('placeStatus', () => {
  it('is done only when every job at the place is ticked', () => {
    expect(placeStatus([{ checked: true }, { checked: true }])).toBe('done')
    expect(placeStatus([{ checked: true }, { checked: false }])).toBe('partial')
    expect(placeStatus([{ checked: false }])).toBe('todo')
    expect(placeStatus([])).toBe('todo')
  })
})

describe('anchorOf', () => {
  it('uses a pin as it is and a pipeline by its middle point', () => {
    expect(anchorOf({ type: 'Point', coordinates: [-108.7, 52.3] })).toEqual([-108.7, 52.3])
    expect(anchorOf({ type: 'LineString', coordinates: [[0, 0], [1, 1], [2, 2]] })).toEqual([1, 1])
  })
})
