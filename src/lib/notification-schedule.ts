/**
 * When a held push goes out: quiet hours and the daily digest, on the farm's
 * wall clock. Pure, so the notification-digests job and the tests share one
 * copy. The database decides what to hold (fn_push_hold); this decides when
 * it is due, from the person's settings at the moment the job runs.
 */
import { isUrgent } from './notification-kinds'

export type NotificationTiming = {
  quiet_on: boolean
  /** "22:00" or "22:00:00" (Postgres time). */
  quiet_start: string
  quiet_end: string
  digest_at: string
}

/**
 * No settings row: quiet hours off (with the suggested 22:00–06:00 ready for
 * when they are turned on), digest at 7 in the morning. Same as the table's defaults.
 */
export const DEFAULT_TIMING: NotificationTiming = { quiet_on: false, quiet_start: '22:00', quiet_end: '06:00', digest_at: '07:00' }

const MINUTE = 60_000
const DAY_MIN = 24 * 60

/** Minutes after midnight for "HH:MM" or "HH:MM:SS". */
export function hmMinutes(hm: string): number {
  const [h, m] = hm.split(':').map(Number)
  return ((h || 0) * 60 + (m || 0)) % DAY_MIN
}

/** "22:00:00" → "22:00", for a time input. */
export const hmShort = (hm: string): string => hm.slice(0, 5)

/** The wall clock in `tz` at an instant: its date and minutes after midnight. */
export function localClock(at: Date, tz: string): { y: number; m: number; d: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0)
  return { y: get('year'), m: get('month'), d: get('day'), minutes: (get('hour') % 24) * 60 + get('minute') }
}

/** How far `tz` is ahead of UTC at an instant, in minutes (Edmonton: −360 summer, −420 winter). */
function offsetMinutes(at: Date, tz: string): number {
  const c = localClock(at, tz)
  const asUtc = Date.UTC(c.y, c.m - 1, c.d) + c.minutes * MINUTE
  return Math.round((asUtc - Math.floor(at.getTime() / MINUTE) * MINUTE) / MINUTE)
}

/**
 * The instant the wall clock in `tz` reads `minutes` on a given local date.
 * A time skipped by the spring change (2:30 on that night) comes out an hour
 * later; a time that happens twice in the fall is the first one.
 */
export function zonedInstant(y: number, m: number, d: number, minutes: number, tz: string): Date {
  const guess = Date.UTC(y, m - 1, d) + minutes * MINUTE
  const first = guess - offsetMinutes(new Date(guess), tz) * MINUTE
  const second = guess - offsetMinutes(new Date(first), tz) * MINUTE
  // Two candidates differ only around a change; the earlier one that reads right wins.
  const fits = (t: number) => localClock(new Date(t), tz).minutes === minutes
  if (fits(Math.min(first, second))) return new Date(Math.min(first, second))
  if (fits(Math.max(first, second))) return new Date(Math.max(first, second))
  return new Date(Math.max(first, second))
}

/** Is `at` inside the quiet window? The window may cross midnight; start = end is no window. */
export function inQuietHours(at: Date, tz: string, t: Pick<NotificationTiming, 'quiet_on' | 'quiet_start' | 'quiet_end'>): boolean {
  if (!t.quiet_on) return false
  const start = hmMinutes(t.quiet_start)
  const end = hmMinutes(t.quiet_end)
  if (start === end) return false
  const now = localClock(at, tz).minutes
  return start < end ? now >= start && now < end : now >= start || now < end
}

/** The most recent instant at or before `at` when the wall clock in `tz` read `hm`. */
export function lastOccurrence(at: Date, tz: string, hm: string): Date {
  const minutes = hmMinutes(hm)
  const c = localClock(at, tz)
  const today = zonedInstant(c.y, c.m, c.d, minutes, tz)
  if (today.getTime() <= at.getTime()) return today
  // Yesterday's local date: step back from noon today, clear of any change.
  const noon = zonedInstant(c.y, c.m, c.d, 12 * 60, tz)
  const y = localClock(new Date(noon.getTime() - DAY_MIN * MINUTE), tz)
  return zonedInstant(y.y, y.m, y.d, minutes, tz)
}

/** A digest item is due once a digest time has passed since it was held. */
export function digestDue(heldAt: Date, now: Date, tz: string, digestAt: string): boolean {
  return lastOccurrence(now, tz, digestAt).getTime() > heldAt.getTime()
}

// ── One person's held pushes, sorted into what to do ───────────────────────

export type HeldNotification = { id: string; kind: string; title: string; body: string | null; link: string | null; read_at: string | null }
export type HeldRow = {
  id: string
  user_id: string
  reason: 'quiet' | 'digest'
  created_at: string
  /** Null once the notification is deleted (the row cascades away, but a read can race it). */
  notification: HeldNotification | null
}

export type HeldPlan = {
  /** Quiet hours are over (or the kind is urgent): these go out now as one push. */
  pushSend: HeldRow[]
  /** The digest time has passed: these become the digest. */
  digestSend: HeldRow[]
  /** Read in the app before they were due: closed without a push. */
  read: HeldRow[]
  /** The notification was deleted: closed. */
  gone: HeldRow[]
  /** Not due yet. */
  waiting: HeldRow[]
}

/**
 * Sort one person's held pushes. Quiet ones are due when quiet hours are not
 * in force right now (over, or switched off since); digest ones once a digest
 * time has passed since they were held. Due and already read is dropped. An
 * urgent kind is never held (the database checks first); one found here
 * anyway goes out now.
 */
export function planHeld(rows: readonly HeldRow[], now: Date, tz: string, timing: NotificationTiming): HeldPlan {
  const plan: HeldPlan = { pushSend: [], digestSend: [], read: [], gone: [], waiting: [] }
  const quietNow = inQuietHours(now, tz, timing)
  for (const r of rows) {
    const n = r.notification
    if (!n) {
      plan.gone.push(r)
      continue
    }
    const urgent = isUrgent(n.kind)
    const due = urgent || (r.reason === 'quiet' ? !quietNow : digestDue(new Date(r.created_at), now, tz, timing.digest_at))
    if (!due) plan.waiting.push(r)
    else if (n.read_at) plan.read.push(r)
    else (urgent || r.reason === 'quiet' ? plan.pushSend : plan.digestSend).push(r)
  }
  const byTime = (a: HeldRow, b: HeldRow) => a.created_at.localeCompare(b.created_at)
  plan.pushSend.sort(byTime)
  plan.digestSend.sort(byTime)
  return plan
}

export type PushText = { title: string; body: string; link: string }

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s)

/**
 * The one push for what quiet hours held. A single item reads as itself and
 * opens its own page; several read "3 notifications overnight: …" and open the list.
 */
export function quietSummary(items: readonly HeldNotification[]): PushText | null {
  if (!items.length) return null
  if (items.length === 1) {
    const n = items[0]
    return { title: n.title, body: n.body ?? '', link: `/notifications/${n.id}` }
  }
  return {
    title: `${items.length} notifications overnight`,
    body: clip(items.map((n) => n.title).join(' · '), 240),
    link: '/notifications',
  }
}

export type DigestItem = { id: string; kind: string; label: string; title: string; link: string | null }
/** No link of its own: tapping it opens its page, which lists the items. */
export type DigestNotification = { title: string; body: string; link: null; details: { items: DigestItem[] } }

const DIGEST_LINES = 10

/**
 * The morning digest: one notification listing every unread digest item,
 * grouped by kind in the order they first arrived. Each item keeps its own
 * link in `details.items` (the notification's page lists them).
 */
export function digestNotification(items: readonly HeldNotification[], labelFor: (kind: string, title: string) => string): DigestNotification | null {
  if (!items.length) return null
  const list: DigestItem[] = items.map((n) => ({ id: n.id, kind: n.kind, label: labelFor(n.kind, n.title), title: n.title, link: n.link }))
  const groups = new Map<string, DigestItem[]>()
  for (const it of list) groups.set(it.label, [...(groups.get(it.label) ?? []), it])
  const ordered = [...groups.values()].flat()
  const lines = ordered.slice(0, DIGEST_LINES).map((it) => `• ${it.label}: ${clip(it.title, 90)}`)
  if (ordered.length > DIGEST_LINES) lines.push(`…and ${ordered.length - DIGEST_LINES} more`)
  return {
    title: `Daily digest: ${list.length} notification${list.length === 1 ? '' : 's'}`,
    body: lines.join('\n'),
    link: null,
    details: { items: ordered },
  }
}
