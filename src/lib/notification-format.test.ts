import { describe, expect, it } from 'vitest'
import { GUIDED_KINDS } from './alert-guides'
import {
  filterValueFor,
  formatWhen,
  KIND_DESCRIPTIONS, KIND_LABELS,
  kindGroupLabel,
  kindLabel,
  kindsForFilter,
  linkTarget,
} from './notification-format'
import { patchReadState, unreadDelta } from './notifications'

describe('kind labels', () => {
  it('maps known kinds to short labels', () => {
    expect(kindLabel('integration_alert')).toBe('Data feed problem')
    expect(kindLabel('task_reminder')).toBe('Task due')
    expect(kindLabel('app_notice')).toBe('App problem update')
    expect(kindLabel('winterizing_freeze')).toBe('Freeze: winterize')
  })

  it('splits crop weather into frost and heat by the title', () => {
    expect(kindLabel('crop_weather', 'Frost tonight on the north quarter')).toBe('Frost warning')
    expect(kindLabel('crop_weather', 'Heat stress coming Thursday')).toBe('Heat warning')
    expect(kindLabel('crop_weather', 'Something else')).toBe('Frost or heat')
    expect(kindLabel('crop_weather')).toBe('Frost or heat')
  })

  it('reads an unknown kind as itself, capitalised', () => {
    expect(kindLabel('made_up_kind')).toBe('Made up kind')
    expect(kindGroupLabel('')).toBe('Notification')
  })

  it('labels every kind that has a written guide', () => {
    for (const k of GUIDED_KINDS) expect(KIND_LABELS[k], k).toBeTruthy()
  })

  it('explains every labelled kind in one line', () => {
    const shared = new Set<string>()
    for (const [kind, label] of Object.entries(KIND_LABELS)) {
      if (shared.has(label)) continue
      shared.add(label)
      expect(KIND_DESCRIPTIONS[kind], kind).toBeTruthy()
    }
  })

  it('keeps labels short enough for the grey line', () => {
    for (const label of Object.values(KIND_LABELS)) expect(label.length, label).toBeLessThanOrEqual(20)
  })

  it('filters by label across the kinds that share it', () => {
    expect(kindsForFilter('Water allotment').sort()).toEqual(['smrid_allotment', 'water_allotment'])
    expect(kindsForFilter('some_raw_kind')).toEqual(['some_raw_kind'])
    expect(filterValueFor('fert_buy_window')).toBe('Fertilizer prices')
    expect(filterValueFor('some_raw_kind')).toBe('some_raw_kind')
  })
})

describe('formatWhen', () => {
  const now = new Date(2030, 5, 15, 12, 0, 0)
  const ago = (ms: number) => new Date(now.getTime() - ms)
  const MIN = 60_000
  const HOUR = 60 * MIN
  const DAY = 24 * HOUR

  it('is relative within a week', () => {
    expect(formatWhen(ago(20_000), now)).toBe('Just now')
    expect(formatWhen(ago(5 * MIN), now)).toBe('5m ago')
    expect(formatWhen(ago(3 * HOUR), now)).toBe('3h ago')
    expect(formatWhen(ago(DAY + HOUR), now)).toBe('Yesterday')
    expect(formatWhen(ago(4 * DAY), now)).toBe('4d ago')
    expect(formatWhen(ago(6 * DAY + 23 * HOUR), now)).toBe('6d ago')
  })

  it('is a date after a week, with the year only when it differs', () => {
    expect(formatWhen(new Date(2030, 4, 2, 9, 0), now)).toBe('May 2')
    expect(formatWhen(new Date(2029, 11, 24, 9, 0), now)).toBe('Dec 24, 2029')
  })

  it('treats a time in the future (clock skew) as just now, and junk as blank', () => {
    expect(formatWhen(new Date(now.getTime() + 5 * MIN), now)).toBe('Just now')
    expect(formatWhen('not a date', now)).toBe('')
  })

  it('accepts an ISO string', () => {
    expect(formatWhen(ago(2 * HOUR).toISOString(), now)).toBe('2h ago')
  })
})

describe('linkTarget', () => {
  const origin = 'https://app.example.test'
  it('routes in-app paths and same-origin URLs through the router', () => {
    expect(linkTarget('/tasks?id=1', origin)).toEqual({ type: 'internal', to: '/tasks?id=1' })
    expect(linkTarget('https://app.example.test/fields/abc#map', origin)).toEqual({ type: 'internal', to: '/fields/abc#map' })
  })
  it('opens outside addresses in a new tab', () => {
    expect(linkTarget('https://example.org/page', origin)).toEqual({ type: 'external', href: 'https://example.org/page' })
  })
  it('has no target for empty, protocol-relative or other schemes', () => {
    expect(linkTarget(null, origin)).toBeNull()
    expect(linkTarget('  ', origin)).toBeNull()
    expect(linkTarget('//evil.example', origin)).toBeNull()
    expect(linkTarget('javascript:alert(1)', origin)).toBeNull()
  })
})

describe('optimistic read state', () => {
  const rows = [
    { id: 'a', read_at: null },
    { id: 'b', read_at: '2030-01-01T00:00:00Z' },
    { id: 'c', read_at: null },
  ]
  const feed = { pages: [rows.slice(0, 2), rows.slice(2)], pageParams: [0, 2] }

  it('sets read state on the chosen rows, in a list and in the paged feed', () => {
    const t = '2030-02-02T00:00:00Z'
    expect(patchReadState(rows, new Set(['a']), t).map((r) => r.read_at)).toEqual([t, rows[1].read_at, null])
    expect(patchReadState(feed, new Set(['b']), null).pages.flat().map((r) => r.read_at)).toEqual([null, null, null])
  })

  it('mark all read leaves rows already read with their own time', () => {
    const t = '2030-02-02T00:00:00Z'
    expect(patchReadState(rows, null, t).map((r) => r.read_at)).toEqual([t, rows[1].read_at, t])
  })

  it('passes the unread count through untouched', () => {
    expect(patchReadState(7, new Set(['a']), null)).toBe(7)
  })

  it('moves the unread count by the rows that actually flip, counted once', () => {
    expect(unreadDelta([rows, feed], new Set(['a', 'b']), true)).toBe(-1)
    expect(unreadDelta([rows, feed], new Set(['b']), false)).toBe(1)
    expect(unreadDelta([rows, 3], new Set(['zz']), true)).toBe(0)
  })
})
