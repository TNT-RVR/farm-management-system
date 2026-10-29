import { describe, expect, it } from 'vitest'
import { rowChanged, sameInstant, sameValue } from '../../netlify/shared/row-diff'
import { farmClock, farmToday } from '../../netlify/shared/dates'

describe('row-diff', () => {
  it('ignores jsonb key order and undefined vs null', () => {
    expect(sameValue({ a: 1, b: { c: [1, { d: 2, e: 3 }] } }, { b: { c: [1, { e: 3, d: 2 }] }, a: 1 })).toBe(true)
    expect(sameValue({ a: undefined }, {})).toBe(true)
    expect(sameValue(undefined, null)).toBe(true)
    expect(sameValue({ a: 1 }, { a: 2 })).toBe(false)
  })

  it('compares timestamps as instants', () => {
    expect(sameInstant('2026-10-26T12:00:00Z', '2026-10-26T12:00:00+00:00')).toBe(true)
    expect(sameInstant('2026-10-26T12:00:00.000Z', '2026-10-26T06:00:00-06:00')).toBe(true)
    expect(sameInstant(null, undefined)).toBe(true)
    expect(sameInstant(null, '2026-10-26T12:00:00Z')).toBe(false)
  })

  it('flags a new row, a moved value, and nothing else', () => {
    const stored = { name: 'Pivot 1', raw: { b: 2, a: 1 }, seen: '2026-10-26T12:00:00+00:00', synced_at: 'old' }
    const next = { name: 'Pivot 1', raw: { a: 1, b: 2 }, seen: '2026-10-26T12:00:00Z', synced_at: 'new' }
    expect(rowChanged(next, undefined, ['name'])).toBe(true)
    expect(rowChanged(next, stored, ['name', 'raw'], ['seen'])).toBe(false)
    expect(rowChanged({ ...next, raw: { a: 1, b: 3 } }, stored, ['name', 'raw'], ['seen'])).toBe(true)
    expect(rowChanged({ ...next, seen: '2026-10-26T12:30:00Z' }, stored, ['name', 'raw'], ['seen'])).toBe(true)
  })
})

describe('farm dates', () => {
  it('reads the farm clock in Alberta time', () => {
    // 05:30 UTC on 1 Nov 2026 is 23:30 on 31 Oct in Edmonton (MDT, UTC-6).
    const at = new Date('2026-11-01T05:30:00Z')
    expect(farmToday(at)).toBe('2026-10-31')
    expect(farmClock(at)).toEqual({ hour: 23, minute: 30, month: 10, day: 31 })
    // Midnight is hour 0, not 24.
    expect(farmClock(new Date('2026-07-01T06:00:00Z')).hour).toBe(0)
  })
})
