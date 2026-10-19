import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TIMING,
  digestDue,
  digestNotification,
  hmMinutes,
  inQuietHours,
  lastOccurrence,
  localClock,
  planHeld,
  quietSummary,
  zonedInstant,
  type HeldNotification,
  type HeldRow,
  type NotificationTiming,
} from './notification-schedule'
import { kindLabel } from './notification-format'

// Made-up people and notifications. Edmonton is UTC−6 in summer (MDT) and
// UTC−7 in winter (MST). The clock-change cases use 2025's changes (forward
// 9 March, back 2 November): they are history, so they hold under any
// time-zone database. Newer databases (tz 2026c) keep Alberta on daylight
// time from November 2026, which made 2026 dates read differently on Node 22
// than on Node 24 (19 Oct 2026).
const TZ = 'America/Edmonton'
const at = (iso: string) => new Date(iso)
const quiet: NotificationTiming = { quiet_on: true, quiet_start: '22:00', quiet_end: '06:00', digest_at: '07:00' }

describe('the farm clock', () => {
  it('reads wall time in the farm zone', () => {
    expect(localClock(at('2026-10-16T05:30:00Z'), TZ)).toMatchObject({ y: 2026, m: 10, d: 15, minutes: 23 * 60 + 30 })
    expect(localClock(at('2026-01-10T05:30:00Z'), TZ)).toMatchObject({ d: 9, minutes: 22 * 60 + 30 })
    expect(hmMinutes('22:15:00')).toBe(22 * 60 + 15)
    expect(hmMinutes('06:00')).toBe(360)
  })

  it('finds the instant for a wall time, either side of a clock change', () => {
    expect(zonedInstant(2025, 3, 8, 7 * 60, TZ).toISOString()).toBe('2025-03-08T14:00:00.000Z')
    expect(zonedInstant(2025, 3, 9, 7 * 60, TZ).toISOString()).toBe('2025-03-09T13:00:00.000Z')
    expect(zonedInstant(2025, 11, 2, 7 * 60, TZ).toISOString()).toBe('2025-11-02T14:00:00.000Z')
    // 2:30 never happens on 9 March: it comes out at 3:30 MDT.
    expect(zonedInstant(2025, 3, 9, 150, TZ).toISOString()).toBe('2025-03-09T09:30:00.000Z')
    // 1:30 happens twice on 2 November: the first one (MDT).
    expect(zonedInstant(2025, 11, 2, 90, TZ).toISOString()).toBe('2025-11-02T07:30:00.000Z')
  })
})

describe('quiet hours', () => {
  it('crosses midnight', () => {
    expect(inQuietHours(at('2026-10-16T03:59:00Z'), TZ, quiet)).toBe(false) // 21:59
    expect(inQuietHours(at('2026-10-16T04:00:00Z'), TZ, quiet)).toBe(true) // 22:00
    expect(inQuietHours(at('2026-10-16T05:30:00Z'), TZ, quiet)).toBe(true) // 23:30
    expect(inQuietHours(at('2026-10-16T09:00:00Z'), TZ, quiet)).toBe(true) // 03:00
    expect(inQuietHours(at('2026-10-16T11:59:00Z'), TZ, quiet)).toBe(true) // 05:59
    expect(inQuietHours(at('2026-10-16T12:00:00Z'), TZ, quiet)).toBe(false) // 06:00
    expect(inQuietHours(at('2026-10-16T18:00:00Z'), TZ, quiet)).toBe(false) // noon
  })

  it('works for a window inside one day, and is nothing when off or empty', () => {
    const nap = { quiet_on: true, quiet_start: '13:00', quiet_end: '14:30' }
    expect(inQuietHours(at('2026-10-16T19:15:00Z'), TZ, nap)).toBe(true) // 13:15
    expect(inQuietHours(at('2026-10-16T20:30:00Z'), TZ, nap)).toBe(false) // 14:30
    expect(inQuietHours(at('2026-10-16T09:00:00Z'), TZ, { ...quiet, quiet_on: false })).toBe(false)
    expect(inQuietHours(at('2026-10-16T09:00:00Z'), TZ, { ...quiet, quiet_end: '22:00' })).toBe(false)
    expect(inQuietHours(at('2026-10-16T09:00:00Z'), TZ, DEFAULT_TIMING)).toBe(false)
  })

  it('follows the wall clock through the spring change', () => {
    // 9 March: 05:30 MDT is 11:30 UTC, still quiet; 06:30 MDT is 12:30 UTC, over.
    expect(inQuietHours(at('2025-03-09T11:30:00Z'), TZ, quiet)).toBe(true)
    expect(inQuietHours(at('2025-03-09T12:30:00Z'), TZ, quiet)).toBe(false)
    // The same UTC instant a day earlier (MST) was 05:30 and 04:30: both quiet.
    expect(inQuietHours(at('2025-03-08T12:30:00Z'), TZ, quiet)).toBe(true)
  })

  it('follows the wall clock through the fall change', () => {
    // 2 November: 05:30 MST is 12:30 UTC, still quiet; 06:30 MST is 13:30 UTC, over.
    expect(inQuietHours(at('2025-11-02T12:30:00Z'), TZ, quiet)).toBe(true)
    expect(inQuietHours(at('2025-11-02T13:30:00Z'), TZ, quiet)).toBe(false)
    // A day earlier (MDT) 12:30 UTC was 06:30: over.
    expect(inQuietHours(at('2025-11-01T12:30:00Z'), TZ, quiet)).toBe(false)
  })
})

describe('the digest time', () => {
  it('finds the last 7 am, today or yesterday', () => {
    expect(lastOccurrence(at('2026-10-16T13:30:00Z'), TZ, '07:00').toISOString()).toBe('2026-10-16T13:00:00.000Z')
    expect(lastOccurrence(at('2026-10-16T13:00:00Z'), TZ, '07:00').toISOString()).toBe('2026-10-16T13:00:00.000Z')
    expect(lastOccurrence(at('2026-10-16T12:59:00Z'), TZ, '07:00').toISOString()).toBe('2026-10-15T13:00:00.000Z')
  })

  it('stays at 7 am on the farm clock across both changes', () => {
    // 9 March 06:30 MDT: the last 7 am was 8 March, MST.
    expect(lastOccurrence(at('2025-03-09T12:30:00Z'), TZ, '07:00').toISOString()).toBe('2025-03-08T14:00:00.000Z')
    expect(lastOccurrence(at('2025-03-09T13:30:00Z'), TZ, '07:00').toISOString()).toBe('2025-03-09T13:00:00.000Z')
    // 3 November 06:00 MST: the last 7 am was 2 November, already MST.
    expect(lastOccurrence(at('2025-11-03T13:00:00Z'), TZ, '07:00').toISOString()).toBe('2025-11-02T14:00:00.000Z')
    // 2 November 06:30 MST: the last 7 am was 1 November, MDT.
    expect(lastOccurrence(at('2025-11-02T13:30:00Z'), TZ, '07:00').toISOString()).toBe('2025-11-01T13:00:00.000Z')
  })

  it('is due once a digest time passes after the item was held', () => {
    const held = at('2026-10-16T12:50:00Z') // 06:50
    expect(digestDue(held, at('2026-10-16T12:55:00Z'), TZ, '07:00')).toBe(false)
    expect(digestDue(held, at('2026-10-16T13:00:00Z'), TZ, '07:00')).toBe(true)
    expect(digestDue(held, at('2026-10-16T13:15:00Z'), TZ, '07:00')).toBe(true)
    const late = at('2026-10-16T13:05:00Z') // 07:05: tomorrow's digest
    expect(digestDue(late, at('2026-10-16T13:15:00Z'), TZ, '07:00')).toBe(false)
    expect(digestDue(late, at('2026-10-17T13:00:00Z'), TZ, '07:00')).toBe(true)
  })
})

const note = (id: string, kind: string, title: string, read = false): HeldNotification => ({
  id,
  kind,
  title,
  body: `${title} body`,
  link: `/somewhere/${id}`,
  read_at: read ? '2026-10-16T11:00:00Z' : null,
})
const held = (id: string, reason: 'quiet' | 'digest', createdAt: string, n: HeldNotification | null): HeldRow => ({
  id: `q-${id}`,
  user_id: 'u-1',
  reason,
  created_at: createdAt,
  notification: n,
})

describe('sorting held pushes', () => {
  const rows: HeldRow[] = [
    held('a', 'quiet', '2026-10-16T05:00:00Z', note('a', 'task_assigned', 'Fix the gate')),
    held('b', 'quiet', '2026-10-16T04:30:00Z', note('b', 'pasture_move', 'Move the heifers')),
    held('c', 'quiet', '2026-10-16T06:00:00Z', note('c', 'task_reminder', 'Order twine', true)),
    held('d', 'digest', '2026-10-15T20:00:00Z', note('d', 'grant_new', 'New water grant')),
    held('e', 'digest', '2026-10-16T02:00:00Z', note('e', 'ab_input_prices', 'September input prices')),
    held('f', 'digest', '2026-10-16T13:10:00Z', note('f', 'grant_new', 'Another grant')),
    held('g', 'quiet', '2026-10-16T05:10:00Z', null),
  ]

  it('holds everything while quiet hours last, except what is gone', () => {
    const p = planHeld(rows, at('2026-10-16T09:00:00Z'), TZ, quiet) // 03:00
    expect(p.pushSend).toEqual([])
    expect(p.digestSend).toEqual([])
    expect(p.gone.map((r) => r.id)).toEqual(['q-g'])
    expect(p.waiting).toHaveLength(6)
  })

  it('sends the unread quiet ones, oldest first, and drops the read one when quiet hours end', () => {
    const p = planHeld(rows, at('2026-10-16T12:15:00Z'), TZ, quiet) // 06:15
    expect(p.pushSend.map((r) => r.id)).toEqual(['q-b', 'q-a'])
    expect(p.read.map((r) => r.id)).toEqual(['q-c'])
    expect(p.digestSend).toEqual([]) // digest is at 7
  })

  it('gathers the digest after its time, leaving what came in since for tomorrow', () => {
    const p = planHeld(rows, at('2026-10-16T13:15:00Z'), TZ, quiet) // 07:15
    expect(p.digestSend.map((r) => r.id)).toEqual(['q-d', 'q-e'])
    expect(p.waiting.map((r) => r.id)).toEqual(['q-f'])
  })

  it('releases quiet ones on the next run once quiet hours are switched off', () => {
    const p = planHeld(rows, at('2026-10-16T09:00:00Z'), TZ, { ...quiet, quiet_on: false })
    expect(p.pushSend.map((r) => r.id)).toEqual(['q-b', 'q-a'])
  })

  it('never holds an urgent kind, whatever the queue says', () => {
    const urgent = [
      held('u1', 'quiet', '2026-10-16T05:00:00Z', note('u1', 'fieldnet_fault', 'Pivot 4 stopped')),
      held('u2', 'digest', '2026-10-16T05:00:00Z', note('u2', 'winterizing_freeze', 'Hard freeze Saturday')),
      held('u3', 'quiet', '2026-10-16T05:00:00Z', note('u3', 'crop_weather', 'Frost forecast')),
      held('u4', 'digest', '2026-10-16T05:00:00Z', note('u4', 'grazing_conflict', 'Cows on a sprayed field')),
    ]
    const p = planHeld(urgent, at('2026-10-16T09:00:00Z'), TZ, quiet) // 03:00, deep in quiet hours
    expect(p.pushSend.map((r) => r.id).sort()).toEqual(['q-u1', 'q-u2', 'q-u3', 'q-u4'])
    expect(p.waiting).toEqual([])
    expect(p.digestSend).toEqual([])
  })
})

describe('what the pushes say', () => {
  it('reads one held item as itself', () => {
    expect(quietSummary([note('a', 'task_assigned', 'Fix the gate')])).toEqual({
      title: 'Fix the gate',
      body: 'Fix the gate body',
      link: '/notifications/a',
    })
    expect(quietSummary([])).toBeNull()
  })

  it('sums up several held items', () => {
    const s = quietSummary([note('a', 'task_assigned', 'Fix the gate'), note('b', 'pasture_move', 'Move the heifers'), note('c', 'lease', 'Rent due')])!
    expect(s.title).toBe('3 notifications overnight')
    expect(s.body).toBe('Fix the gate · Move the heifers · Rent due')
    expect(s.link).toBe('/notifications')
  })

  it('groups the digest by kind, in the order kinds first arrived', () => {
    const d = digestNotification(
      [note('1', 'grant_new', 'Water grant'), note('2', 'ab_input_prices', 'September prices'), note('3', 'grant_new', 'Fencing grant')],
      kindLabel,
    )!
    expect(d.title).toBe('Daily digest: 3 notifications')
    expect(d.body.split('\n')).toEqual(['• New grant: Water grant', '• New grant: Fencing grant', '• AB input prices: September prices'])
    expect(d.details.items.map((i) => i.id)).toEqual(['1', '3', '2'])
    expect(d.details.items[0]).toMatchObject({ link: '/somewhere/1', label: 'New grant' })
    expect(d.link).toBeNull()
  })

  it('keeps a long digest to ten lines, and lists every item in its details', () => {
    const many = Array.from({ length: 12 }, (_, i) => note(String(i), 'fert_buy_window', `Urea moved ${i}`))
    const d = digestNotification(many, kindLabel)!
    const lines = d.body.split('\n')
    expect(lines).toHaveLength(11)
    expect(lines[10]).toBe('…and 2 more')
    expect(d.details.items).toHaveLength(12)
    expect(digestNotification([note('x', 'grant_new', 'One')], kindLabel)!.title).toBe('Daily digest: 1 notification')
    expect(digestNotification([], kindLabel)).toBeNull()
  })
})
