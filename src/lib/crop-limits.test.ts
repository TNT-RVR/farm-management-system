import { describe, expect, it } from 'vitest'
import { groupMaxFor, maxAcresFor, priorityFor, type LimitRow } from './crop-limits'
import type { CropInfo } from './rotation-engine'

const crop = (id: string, name: string, key: CropInfo['key']): CropInfo => ({ id, name, key, minReturn: 3, margin: 100 })
const crops = [
  crop('p1', 'Potato-Red', 'potato'),
  crop('p2', 'Potato-Chipper', 'potato'),
  crop('c1', 'Grain Corn', 'corn'),
  crop('b1', 'Beans-Pinto', 'dry_bean'),
  crop('w1', 'Durum Wheat', 'durum'),
]

describe('acre caps', () => {
  it('reads a crop’s own cap, the year’s row first', () => {
    const rows: LimitRow[] = [
      { crop_id: 'w1', crop_group: null, crop_year: null, max_acres: 300 },
      { crop_id: 'w1', crop_group: null, crop_year: 2027, max_acres: 120 },
    ]
    expect(maxAcresFor(rows, 'w1', 2027)).toBe(120)
    expect(maxAcresFor(rows, 'w1', 2028)).toBe(300)
    expect(maxAcresFor(rows, 'p1', 2027)).toBeNull()
  })

  it('treats a row with no cap as no limit, never as none', () => {
    // The regression of 13 Nov 2026: a rank-only row read as Number(null) = 0
    // capped corn at zero acres and took it out of every plan.
    const rows: LimitRow[] = [{ crop_id: null, crop_group: 'corn', crop_year: null, max_acres: null, priority: 4 }]
    expect(groupMaxFor(rows, 2027).has('corn')).toBe(false)
    expect(maxAcresFor([{ crop_id: 'c1', crop_group: null, crop_year: null, max_acres: null, priority: 4 }], 'c1', 2027)).toBeNull()
  })

  it('does not let a rank-only row hide the cap on the row below it', () => {
    const rows: LimitRow[] = [
      { crop_id: null, crop_group: 'canola', crop_year: null, max_acres: 780 },
      { crop_id: null, crop_group: 'canola', crop_year: 2027, max_acres: null, priority: 1 },
    ]
    expect(groupMaxFor(rows, 2027).get('canola')).toBe(780)
  })

  it('reads group caps, the year’s row first', () => {
    const rows: LimitRow[] = [
      { crop_id: null, crop_group: 'dry_bean', crop_year: null, max_acres: 650 },
      { crop_id: null, crop_group: 'dry_bean', crop_year: 2027, max_acres: 400 },
      { crop_id: null, crop_group: 'canola', crop_year: null, max_acres: 780 },
    ]
    expect(groupMaxFor(rows, 2027).get('dry_bean')).toBe(400)
    expect(groupMaxFor(rows, 2028).get('dry_bean')).toBe(650)
    expect(groupMaxFor(rows, 2028).get('canola')).toBe(780)
  })
})

describe('the running order', () => {
  const rows: LimitRow[] = [
    { crop_id: null, crop_group: 'canola', crop_year: null, max_acres: 780, priority: 1 },
    { crop_id: null, crop_group: 'potato', crop_year: null, max_acres: null, priority: 2 },
    { crop_id: null, crop_group: 'dry_bean', crop_year: null, max_acres: 650, priority: 3 },
    { crop_id: null, crop_group: 'corn', crop_year: null, max_acres: null, priority: 4 },
  ]

  it('ranks every crop in a group by its group’s rank', () => {
    expect(priorityFor(rows, crops, 2027)).toEqual(['p1', 'p2', 'b1', 'c1'])
  })

  it('leaves an unranked crop out', () => {
    expect(priorityFor(rows, crops, 2027)).not.toContain('w1')
    expect(priorityFor([], crops, 2027)).toEqual([])
  })

  it('lets a crop’s own rank beat its group’s', () => {
    const own = [...rows, { crop_id: 'p2', crop_group: null, crop_year: null, max_acres: null, priority: 9 }]
    expect(priorityFor(own, crops, 2027)).toEqual(['p1', 'b1', 'c1', 'p2'])
  })

  it('lets a year’s own rank beat the every-year one', () => {
    const y = [...rows, { crop_id: null, crop_group: 'corn', crop_year: 2027, max_acres: null, priority: 0 }]
    expect(priorityFor(y, crops, 2027)[0]).toBe('c1')
    expect(priorityFor(y, crops, 2028)[0]).toBe('p1')
  })
})
