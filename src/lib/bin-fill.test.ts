import { describe, expect, it } from 'vitest'
import { currentFill, fieldsLeaving, type FillMove } from './bin-fill'

const load = (id: string, field: string, day: string, bushels: number, created: string): FillMove => ({
  movement_type: 'harvest_in',
  bushels,
  moved_at: day,
  created_at: created,
  field_id: field,
  ticket_number: `load:${id}`,
})

describe('currentFill', () => {
  it('bin #21, 20 Oct 2026: Moreau moved out, only Lindgren is in it', () => {
    const moves: FillMove[] = [
      load('s1', 'moreau', '2026-09-21', 1565.72, '2026-09-23T23:13'),
      load('s2', 'moreau', '2026-09-22', 1789.27, '2026-09-23T23:13'),
      load('s3', 'moreau', '2026-09-23', 1750.03, '2026-09-23T23:13'),
      load('s4', 'moreau', '2026-09-24', 391.54, '2026-09-25T04:17'),
      { movement_type: 'transfer_out', bushels: 5496.56, moved_at: '2026-10-14', created_at: '2026-10-14T21:25', field_id: null, ticket_number: null },
      load('g1', 'lindgren', '2026-10-14', 1433.45, '2026-10-14T21:27'),
      // Dated before the move-out, typed after it: still Lindgren's grain in the bin.
      load('g2', 'lindgren', '2026-10-09', 954.6, '2026-10-14T21:28'),
      load('g3', 'lindgren', '2026-10-16', 798.07, '2026-10-17T14:37'),
    ]
    const fill = currentFill(moves)
    expect(new Set(fill.map((l) => l.fieldId))).toEqual(new Set(['lindgren']))
    expect(fill.map((l) => l.loadId).sort()).toEqual(['g1', 'g2', 'g3'])
  })
  it('a part move-out leaves the rest of the oldest load', () => {
    const fill = currentFill([
      load('a', 'f1', '2026-09-01', 1000, '1'),
      load('b', 'f2', '2026-09-02', 500, '2'),
      { movement_type: 'delivery_out', bushels: 600, moved_at: '2026-09-03', field_id: null, ticket_number: null },
    ])
    expect(fill).toEqual([
      { loadId: 'a', fieldId: 'f1', bushels: 400 },
      { loadId: 'b', fieldId: 'f2', bushels: 500 },
    ])
  })
  it('an emptied bin starts afresh; a negative adjustment takes grain out', () => {
    expect(currentFill([load('a', 'f1', '2026-09-01', 100, '1'), { movement_type: 'adjustment', bushels: -100, moved_at: '2026-09-02', field_id: null, ticket_number: null }])).toEqual([])
  })
})

describe('fieldsLeaving', () => {
  const lots = [
    { loadId: 's1', fieldId: 'moreau', bushels: 1565.72 },
    { loadId: 's2', fieldId: 'moreau', bushels: 1789.27 },
    { loadId: 'g1', fieldId: 'lindgren', bushels: 954.6 },
  ]
  it('a move takes the oldest grain: one field when that is all it reaches', () => {
    expect(fieldsLeaving(lots, 1000)).toEqual(['moreau'])
    expect(fieldsLeaving(lots, 3354.99)).toEqual(['moreau'])
  })
  it('a move that reaches further names both, most bushels first', () => {
    expect(fieldsLeaving(lots, 4000)).toEqual(['moreau', 'lindgren'])
    expect(fieldsLeaving(lots, 99999)).toEqual(['moreau', 'lindgren'])
  })
  it('nothing moved, no fields', () => {
    expect(fieldsLeaving(lots, 0)).toEqual([])
    expect(fieldsLeaving([], 100)).toEqual([])
  })
})
