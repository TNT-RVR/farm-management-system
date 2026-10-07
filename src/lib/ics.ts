/**
 * Enough of iCalendar to read a time-off feed.
 *
 * A typical HR feed is all-day VEVENTs: a UID, a SUMMARY like "Douglas Olsen Paid
 * Time Off leave for 8.00 hours", a DESCRIPTION carrying the reason, and
 * DTSTART/DTEND as dates with the end exclusive. Lines longer than 75 bytes
 * are folded onto continuation lines beginning with a space, and that is the
 * one thing a naive line split gets wrong.
 */
export type IcsEvent = {
  uid: string
  summary: string
  description: string
  /** YYYY-MM-DD, or an ISO instant for timed events. */
  start: string
  /** Exclusive for all-day events, as the standard has it. */
  end: string | null
  allDay: boolean
}

function unfold(text: string): string[] {
  const out: string[] = []
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    if ((raw.startsWith(' ') || raw.startsWith('\t')) && out.length) out[out.length - 1] += raw.slice(1)
    else out.push(raw)
  }
  return out
}

const unescape = (v: string) => v.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1')

function dateOf(value: string, params: string): { value: string; allDay: boolean } {
  const v = value.trim()
  if (/VALUE=DATE\b/i.test(params) || /^\d{8}$/.test(v)) {
    return { value: `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`, allDay: true }
  }
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z?)$/.exec(v)
  if (!m) return { value: v, allDay: false }
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] ?? '00'}${m[7] ? 'Z' : ''}`
  return { value: m[7] ? new Date(iso).toISOString() : new Date(iso).toISOString(), allDay: false }
}

export function parseIcs(text: string): IcsEvent[] {
  const events: IcsEvent[] = []
  let cur: Partial<IcsEvent> | null = null
  for (const line of unfold(text)) {
    if (line === 'BEGIN:VEVENT') {
      cur = {}
      continue
    }
    if (line === 'END:VEVENT') {
      if (cur?.uid && cur.start) {
        events.push({
          uid: cur.uid,
          summary: cur.summary ?? '',
          description: cur.description ?? '',
          start: cur.start,
          end: cur.end ?? null,
          allDay: cur.allDay ?? true,
        })
      }
      cur = null
      continue
    }
    if (!cur) continue
    const colon = line.indexOf(':')
    if (colon < 0) continue
    const head = line.slice(0, colon)
    const value = line.slice(colon + 1)
    const [name, ...params] = head.split(';')
    const p = params.join(';')
    switch (name.toUpperCase()) {
      case 'UID':
        cur.uid = value.trim()
        break
      case 'SUMMARY':
        cur.summary = unescape(value).trim()
        break
      case 'DESCRIPTION':
        cur.description = unescape(value).trim()
        break
      case 'DTSTART': {
        const d = dateOf(value, p)
        cur.start = d.value
        cur.allDay = d.allDay
        break
      }
      case 'DTEND':
        cur.end = dateOf(value, p).value
        break
      default:
        break
    }
  }
  return events
}

/** What a time-off summary says: who, what sort of leave, how long. */
export type TimeOffRead = { who: string; kind: string; hours: number | null; reason: string | null }

const LEAVE_KINDS = [
  'Paid Time Off',
  'Unpaid Time Off',
  'Time Off',
  'Sick Leave',
  'Sick',
  'Vacation',
  'Bereavement',
  'Personal Day',
  'Personal',
  'Parental',
  'Jury Duty',
]

export function readTimeOff(summary: string, description: string): TimeOffRead {
  // "Douglas Olsen Paid Time Off leave for 8.00 hours"
  // "Douglas Olsen Paid Time Off leave"
  const reason = description.replace(/^Reason:\s*/i, '').trim() || null
  const m = /^(.*?)\s+leave(?:\s+for\s+([\d.]+)\s+hours?)?\s*$/i.exec(summary.trim())
  if (!m) return { who: summary.trim(), kind: 'Time off', hours: null, reason }
  const head = m[1].trim()
  const hours = m[2] ? Number(m[2]) : null
  // The kind is the tail of the head, from a known list; what is left is who.
  // Longest first: "Unpaid Time Off" ends with "paid Time Off" and would
  // otherwise read as paid leave for somebody called "Luke Hansen Un".
  const kind = [...LEAVE_KINDS]
    .sort((a, b) => b.length - a.length)
    .find((k) => head.toLowerCase().endsWith(k.toLowerCase()))
  if (!kind) return { who: head, kind: 'Time off', hours, reason }
  return { who: head.slice(0, head.length - kind.length).trim() || head, kind, hours, reason }
}
