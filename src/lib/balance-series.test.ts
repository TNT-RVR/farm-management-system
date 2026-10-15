import { describe, expect, it } from 'vitest'
import { cropColour } from './crop-colour'
import type { WaterBalanceRow } from '@/lib/irrigation'
import { groupBalanceByZone, ZONE_COLORS } from './balance-series'

const row = (date: string, zone_id: string | null, dr_mm = 10) =>
  ({ field_id: 'F', zone_id, date, dr_mm }) as unknown as WaterBalanceRow

const CROPS = [
  { id: 'c-carrot', name: 'Carrots', color: '#f97316' },
  { id: 'c-spinach', name: 'Spinach', color: '#16a34a' },
  { id: 'c-nocolour', name: 'Barley', color: null },
]
const ZONES = [
  { id: 'z1', crop_id: 'c-carrot' },
  { id: 'z2', crop_id: 'c-spinach' },
  { id: 'z3', crop_id: 'c-nocolour' },
]

describe('groupBalanceByZone', () => {
  it('returns nothing for no rows', () => {
    expect(groupBalanceByZone([], ZONES, CROPS)).toEqual([])
  })

  it('gives an unzoned field exactly one series', () => {
    const rows = [row('2026-05-01', null), row('2026-05-02', null)]
    const out = groupBalanceByZone(rows, ZONES, CROPS)
    expect(out).toHaveLength(1)
    expect(out[0].key).toBe('field')
    expect(out[0].label).toBe('Available Soil Moisture')
    expect(out[0].rows).toHaveLength(2)
  })

  it('splits a two-crop field into one series per zone', () => {
    // The case that matters: repeated dates, one row per zone per day.
    const rows = [
      row('2026-05-01', 'z1'),
      row('2026-05-02', 'z1'),
      row('2026-05-01', 'z2'),
      row('2026-05-02', 'z2'),
    ]
    const out = groupBalanceByZone(rows, ZONES, CROPS)
    expect(out).toHaveLength(2)
    expect(out.map((s) => s.label)).toEqual(['Carrots', 'Spinach'])
    expect(out.map((s) => s.color)).toEqual(['#f97316', '#16a34a'])
    // No row may be lost or duplicated across the split.
    expect(out.flatMap((s) => s.rows)).toHaveLength(rows.length)
    for (const s of out) {
      expect(new Set(s.rows.map((r) => r.zone_id)).size).toBe(1)
    }
  })

  it('keeps every date within a zone rather than collapsing repeats', () => {
    const rows = [
      row('2026-05-01', 'z1'),
      row('2026-05-01', 'z2'),
      row('2026-05-02', 'z1'),
      row('2026-05-02', 'z2'),
      row('2026-05-03', 'z1'),
      row('2026-05-03', 'z2'),
    ]
    const out = groupBalanceByZone(rows, ZONES, CROPS)
    for (const s of out) {
      expect(s.rows.map((r) => r.date)).toEqual(['2026-05-01', '2026-05-02', '2026-05-03'])
    }
  })

  it('gives an uncoloured crop a stable colour of its own', () => {
    const rows = [row('2026-05-01', 'z1'), row('2026-05-01', 'z3')]
    const out = groupBalanceByZone(rows, ZONES, CROPS)
    expect(out[1].label).toBe('Barley')
    // Barley is the same colour here as on the bin map and the rotation grid,
    // which is the point of a shared crop colour.
    expect(out[1].color).toBe(cropColour({ id: 'c-nocolour' }))
  })

  it('falls back to a chart colour only where there is no crop at all', () => {
    const rows = [row('2026-05-01', '')]
    const out = groupBalanceByZone(rows, [], [])
    expect(ZONE_COLORS).toContain(out[0].color)
  })

  it('still draws a zone whose crop or zone record is missing', () => {
    // An unlabelled line is recoverable; a silently dropped one is not.
    const rows = [row('2026-05-01', 'z1'), row('2026-05-01', 'ghost')]
    const out = groupBalanceByZone(rows, ZONES, CROPS)
    expect(out).toHaveLength(2)
    expect(out[1].label).toBe('Zone')
    expect(out[1].rows).toHaveLength(1)
  })

  it('labels a whole-field remainder alongside zones', () => {
    // Mid-season zoning can leave whole-field rows from before the split.
    const rows = [row('2026-05-01', null), row('2026-05-02', 'z1')]
    const out = groupBalanceByZone(rows, ZONES, CROPS)
    expect(out.map((s) => s.label)).toEqual(['Rest of field', 'Carrots'])
  })
})
