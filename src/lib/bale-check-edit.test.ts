import { describe, expect, it } from 'vitest'
import { diffReadings } from './bale-check-edit'
import type { BaleReading } from './bale-checks'

const r = (id: string | undefined, temp: number): BaleReading => ({
  id,
  feed_type_id: null,
  feed_name: 'Hay',
  bale_form: 'round',
  stack: null,
  bale_label: null,
  temp_c: temp,
  moisture_pct: null,
  probe_depth_in: null,
  notes: null,
  sort_order: 9,
})

describe('diffReadings', () => {
  it('updates kept readings, inserts new ones, removes dropped ones, renumbering the order', () => {
    const d = diffReadings([r('a', 30), r('b', 40)], [r('b', 45), r(undefined, 20)])
    expect(d.update.map((x) => [x.id, x.temp_c, x.sort_order])).toEqual([['b', 45, 0]])
    expect(d.insert.map((x) => [x.id, x.temp_c, x.sort_order])).toEqual([[undefined, 20, 1]])
    expect(d.remove).toEqual(['a'])
  })
  it('treats an id not on the check as new', () => {
    const d = diffReadings([], [r('zzz', 30)])
    expect(d.update).toEqual([])
    expect(d.insert).toHaveLength(1)
  })
})
