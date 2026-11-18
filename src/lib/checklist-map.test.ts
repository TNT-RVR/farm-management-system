import { describe, expect, it } from 'vitest'
import { anchorOf, placeStatus } from './checklist-map'

describe('placeStatus', () => {
  it('is done only when every job at the place is ticked', () => {
    expect(placeStatus([{ checked: true }, { checked: true }])).toBe('done')
    expect(placeStatus([{ checked: true }, { checked: false }])).toBe('partial')
    expect(placeStatus([{ checked: false }])).toBe('todo')
    expect(placeStatus([])).toBe('todo')
  })

  it('counts a place with no jobs as done once it has a note', () => {
    expect(placeStatus([], 'Drained, valve left open')).toBe('done')
    expect(placeStatus([], '  ')).toBe('todo')
    expect(placeStatus([], null)).toBe('todo')
    // With jobs, a note does not stand in for ticking them.
    expect(placeStatus([{ checked: false }], 'Looked at it')).toBe('todo')
  })
})

describe('anchorOf', () => {
  it('uses a pin as it is and a pipeline by its middle point', () => {
    expect(anchorOf({ type: 'Point', coordinates: [-113.5, 52.3] })).toEqual([-113.5, 52.3])
    expect(anchorOf({ type: 'LineString', coordinates: [[0, 0], [1, 1], [2, 2]] })).toEqual([1, 1])
  })
})
