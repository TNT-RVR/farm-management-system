import { createClient } from '@supabase/supabase-js'
import { hydrateSecrets } from '../shared/secrets.ts'
import { farmName } from '../../src/lib/farm-context.ts'

// Minimal RRULE expander (inlined to avoid cross-bundle imports; mirrors
// src/lib/recur.ts — keep in sync). Supports FREQ/INTERVAL/COUNT/UNTIL.
type Rule = { freq: string; interval: number; count: number | null; until: Date | null }
function parseRule(rrule: string | null): Rule | null {
  if (!rrule) return null
  const parts: Record<string, string> = {}
  for (const kv of rrule.replace(/^RRULE:/i, '').split(';')) {
    const [k, v] = kv.split('=')
    parts[k.toUpperCase()] = v
  }
  if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(parts.FREQ)) return null
  let until: Date | null = null
  if (parts.UNTIL) {
    const u = parts.UNTIL
    until = new Date(Date.UTC(+u.slice(0, 4), +u.slice(4, 6) - 1, +u.slice(6, 8), 23, 59, 59))
  }
  return {
    freq: parts.FREQ,
    interval: parts.INTERVAL ? Math.max(1, parseInt(parts.INTERVAL, 10)) : 1,
    count: parts.COUNT ? parseInt(parts.COUNT, 10) : null,
    until,
  }
}
function advance(d: Date, r: Rule): Date {
  const n = new Date(d)
  if (r.freq === 'DAILY') n.setDate(n.getDate() + r.interval)
  else if (r.freq === 'WEEKLY') n.setDate(n.getDate() + 7 * r.interval)
  else if (r.freq === 'MONTHLY') n.setMonth(n.getMonth() + r.interval)
  else n.setFullYear(n.getFullYear() + r.interval)
  return n
}
function expandOccurrences(start: Date, rrule: string | null, ws: Date, we: Date): Date[] {
  const rule = parseRule(rrule)
  if (!rule) return start >= ws && start <= we ? [start] : []
  const out: Date[] = []
  let cur = new Date(start)
  let emitted = 0
  for (let i = 0; i < 2000; i++) {
    if (rule.count !== null && emitted >= rule.count) break
    if (rule.until && cur > rule.until) break
    if (cur > we) break
    if (cur >= ws) out.push(new Date(cur))
    emitted++
    cur = advance(cur, rule)
  }
  return out
}

// Read-only iCal feed for Google Calendar subscription. Auth is the
// unguessable per-user calendar_feed_token (Google fetches without a session).
// Single farm → the feed returns all calendar events plus open tasks/checklist
// runs with due dates. Recurring events are expanded ±1 year.

const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

function icsEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
}

function dt(d: Date, allDay: boolean): string {
  if (allDay) {
    return `;VALUE=DATE:${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`
  }
  return `:${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}T${String(d.getUTCHours()).padStart(2, '0')}${String(d.getUTCMinutes()).padStart(2, '0')}00Z`
}

export default async (req: Request) => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  if (!url || !serviceKey) return new Response('Not configured', { status: 500 })
  const token = new URL(req.url).searchParams.get('token')
  if (!token) return new Response('Missing token', { status: 400 })

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } })
  const { data: user } = await admin
    .from('users')
    .select('id, active')
    .eq('calendar_feed_token', token)
    .single()
  if (!user || !user.active) return new Response('Invalid token', { status: 403 })

  const now = new Date()
  const windowStart = new Date(now.getFullYear() - 1, 0, 1)
  const windowEnd = new Date(now.getFullYear() + 1, 11, 31)

  const [{ data: events }, { data: tasks }, { data: runs }] = await Promise.all([
    admin.from('calendar_events').select('*'),
    admin.from('tasks').select('id, title, due_at, status').eq('status', 'open'),
    admin.from('checklist_runs').select('id, name, due_at, status').eq('status', 'open'),
  ])

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//${farmName()}//RVR Management//EN`,
    'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${farmName()}`,
  ]

  const push = (uid: string, start: Date, title: string, allDay: boolean) => {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTAMP${dt(now, false)}`,
      `DTSTART${dt(start, allDay)}`,
      `SUMMARY:${icsEscape(title)}`,
      'END:VEVENT',
    )
  }

  for (const e of events ?? []) {
    const occs = expandOccurrences(new Date(e.starts_at), e.rrule, windowStart, windowEnd)
    occs.forEach((occ, i) => push(`evt-${e.id}-${i}@rvr`, occ, e.title, e.all_day))
  }
  for (const t of tasks ?? []) {
    if (t.due_at) push(`task-${t.id}@rvr`, new Date(t.due_at), `☑ ${t.title}`, false)
  }
  for (const r of runs ?? []) {
    if (r.due_at) push(`run-${r.id}@rvr`, new Date(r.due_at), `✔ ${r.name}`, false)
  }

  lines.push('END:VCALENDAR')
  return new Response(lines.join('\r\n'), {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
