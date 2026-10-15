/**
 * The sittings inside a Deere field operation.
 *
 * A field operation's start and end are the first and last logged point, and
 * Deere rolls every visit with the same product into one operation. The
 * per-point export has a timestamp on each point, roughly one a second while
 * the machine is working, so the sittings fall out of the gaps: a gap of half
 * an hour or more is a new session (the sprayer went to fill, or went home),
 * and inside a session any gap under five minutes is time on the field.
 */
export type OpSession = {
  /** ISO, first point. */
  start: string
  /** ISO, last point. */
  end: string
  /** Minutes the machine was logging, gaps under `idleMin` included. */
  minutes: number
  points: number
}

export const SESSION_GAP_MIN = 30
export const IDLE_GAP_MIN = 5

export function sessionsFromTimes(
  isoTimes: string[],
  opts: { gapMin?: number; idleMin?: number } = {},
): OpSession[] {
  const gapMs = (opts.gapMin ?? SESSION_GAP_MIN) * 60_000
  const idleMs = (opts.idleMin ?? IDLE_GAP_MIN) * 60_000
  const ts = isoTimes
    .map((t) => Date.parse(t))
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b)
  const out: OpSession[] = []
  let start = -1
  let prev = -1
  let working = 0
  let points = 0
  const close = () => {
    if (start < 0) return
    out.push({
      start: new Date(start).toISOString(),
      end: new Date(prev).toISOString(),
      minutes: Math.round(working / 60_000),
      points,
    })
  }
  for (const t of ts) {
    if (start < 0) {
      start = t
      prev = t
      working = 0
      points = 1
      continue
    }
    const gap = t - prev
    if (gap >= gapMs) {
      close()
      start = t
      working = 0
      points = 1
    } else {
      if (gap < idleMs) working += gap
      points++
    }
    prev = t
  }
  close()
  return out
}

export const workMinutes = (sessions: OpSession[]): number =>
  sessions.reduce((s, x) => s + x.minutes, 0)

export function fmtMinutes(min: number): string {
  const m = Math.round(min)
  const h = Math.floor(m / 60)
  return h > 0 ? `${h}h ${m % 60}m` : `${m}m`
}

const day = (iso: string) =>
  new Date(iso).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })
const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' })

/** "Sep 11 · 7:33–9:20 p.m. · 1h 47m", one per sitting, merged by day. */
export function describeSessions(sessions: OpSession[]): { day: string; when: string; minutes: number }[] {
  const byDay = new Map<string, { day: string; first: string; last: string; minutes: number }>()
  // A handful of points on another day is the machine being switched on in
  // the yard with the job still open, not a day's work.
  for (const s of sessions.filter((x) => x.minutes >= 1)) {
    const d = day(s.start)
    const cur = byDay.get(d)
    if (cur) {
      cur.last = s.end
      cur.minutes += s.minutes
    } else byDay.set(d, { day: d, first: s.start, last: s.end, minutes: s.minutes })
  }
  return [...byDay.values()].map((d) => ({
    day: d.day,
    when: `${clock(d.first)}–${clock(d.last)}`,
    minutes: d.minutes,
  }))
}
