import { describe, expect, it } from 'vitest'
import type { MultiPolygon } from 'geojson'
import { herdOnMap, labelPoint } from './herd-map'
import type { MobNow } from './eshepherd'

const square: MultiPolygon = {
  type: 'MultiPolygon',
  coordinates: [[[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]]],
}

const mob = (p: Partial<MobNow>): MobNow => ({
  mob: 'Cows',
  paddock_name: 'N-4',
  pasture_id: 'n',
  no_fence: false,
  since: '2026-09-17T14:30:00.000Z',
  days: 2,
  head_count: 290,
  previous: null,
  ...p,
})

describe('labelPoint', () => {
  it('sits in the middle of the ring', () => {
    expect(labelPoint(square)).toEqual([1, 1])
  })
})

describe('herdOnMap', () => {
  it('labels an occupied paddock with every mob on it, biggest first', () => {
    const { fc, occupied } = herdOnMap([{ id: 'n', geojson: square }], [
      mob({ mob: 'Bulls', head_count: 9 }),
      mob({}),
    ])
    expect(occupied).toEqual(['n'])
    expect(fc.features[0].properties?.text).toBe('290 head · Cows\n9 head · Bulls')
    expect(fc.features[0].properties?.head).toBe(299)
  })

  it('draws nothing for a mob with the fence off or off the map', () => {
    const { fc } = herdOnMap([{ id: 'n', geojson: square }], [
      mob({ no_fence: true }),
      mob({ pasture_id: null }),
    ])
    expect(fc.features).toEqual([])
  })
})
