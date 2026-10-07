/**
 * Minimal iCal RRULE expander — dependency-free, shared by the calendar UI and
 * the iCal feed function (so it must not import anything). Supports the common
 * cases: FREQ=DAILY|WEEKLY|MONTHLY|YEARLY, INTERVAL, COUNT, UNTIL. Enough for a
 * farm calendar (weekly meeting, biweekly check, monthly/annual events); not a
 * full RFC 5545 implementation (no BYDAY/BYMONTH sets).
 */
export type ParsedRule = {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'
  interval: number
  count: number | null
  until: Date | null
}

export function parseRRule(rrule: string | null | undefined): ParsedRule | null {
  if (!rrule) return null
  const body = rrule.replace(/^RRULE:/i, '')
  const parts = Object.fromEntries(
    body.split(';').map((kv) => {
      const [k, v] = kv.split('=')
      return [k.toUpperCase(), v]
    }),
  )
  const freq = parts.FREQ as ParsedRule['freq']
  if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq)) return null
  let until: Date | null = null
  if (parts.UNTIL) {
    // YYYYMMDD or YYYYMMDDTHHMMSSZ
    const u = parts.UNTIL
    const y = +u.slice(0, 4)
    const mo = +u.slice(4, 6) - 1
    const d = +u.slice(6, 8)
    until = new Date(Date.UTC(y, mo, d, 23, 59, 59))
  }
  return {
    freq,
    interval: parts.INTERVAL ? Math.max(1, parseInt(parts.INTERVAL, 10)) : 1,
    count: parts.COUNT ? parseInt(parts.COUNT, 10) : null,
    until,
  }
}

function advance(d: Date, rule: ParsedRule): Date {
  const n = new Date(d)
  switch (rule.freq) {
    case 'DAILY':
      n.setDate(n.getDate() + rule.interval)
      break
    case 'WEEKLY':
      n.setDate(n.getDate() + 7 * rule.interval)
      break
    case 'MONTHLY':
      n.setMonth(n.getMonth() + rule.interval)
      break
    case 'YEARLY':
      n.setFullYear(n.getFullYear() + rule.interval)
      break
  }
  return n
}

/**
 * Occurrence start times for an event within [windowStart, windowEnd].
 * Non-recurring events return their single start if it falls in the window.
 */
export function expandOccurrences(
  start: Date,
  rrule: string | null | undefined,
  windowStart: Date,
  windowEnd: Date,
): Date[] {
  const rule = parseRRule(rrule)
  if (!rule) {
    return start >= windowStart && start <= windowEnd ? [start] : []
  }
  const out: Date[] = []
  let cur = new Date(start)
  let emitted = 0
  // Safety bound so a bad rule can't loop forever.
  for (let i = 0; i < 2000; i++) {
    if (rule.count !== null && emitted >= rule.count) break
    if (rule.until && cur > rule.until) break
    if (cur > windowEnd) break
    if (cur >= windowStart) out.push(new Date(cur))
    emitted++
    cur = advance(cur, rule)
  }
  return out
}
