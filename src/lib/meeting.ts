import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import { useAuth } from './auth'
import { expandOccurrences } from './recur'
import { MEETING_ALERT_KINDS } from './alert-guides'

/**
 * The Monday morning meeting.
 *
 * Nothing here is new information — it is the overdue tasks, this week's
 * calendar, the monthly checklist and the irrigation model, all of which live
 * on their own screens. The point is that running a meeting off five screens
 * means somebody scrolls while everybody waits, and the thing that gets skipped
 * is whichever screen was awkward to reach. One page, in the order the meeting
 * actually goes: what did not get done, what is coming, what the ground needs,
 * what we are going to do about it.
 */

/**
 * The Monday of the week containing `d`, as an ISO date.
 *
 * Local time, deliberately. Converting through UTC puts a Monday morning in
 * Alberta into Sunday for six months of the year, and the agenda would then
 * silently belong to the wrong week — the class of bug nobody notices until the
 * numbers have been wrong for a month.
 */
export function weekStart(d: Date = new Date()): string {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  // getDay: 0 = Sunday. Sunday belongs to the week that is ending, so it goes
  // back six days, not forward one.
  const back = (x.getDay() + 6) % 7
  x.setDate(x.getDate() - back)
  return toISO(x)
}

export const toISO = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** The seven days of the week starting at `mondayISO`. */
export function weekDays(mondayISO: string): Date[] {
  const [y, m, d] = mondayISO.split('-').map(Number)
  return Array.from({ length: 7 }, (_, i) => new Date(y, m - 1, d + i))
}

export function shiftWeek(mondayISO: string, by: number): string {
  const [y, m, d] = mondayISO.split('-').map(Number)
  return toISO(new Date(y, m - 1, d + by * 7))
}

/** Is this date inside [monday, monday+7)? */
export function inWeek(date: Date, mondayISO: string): boolean {
  const days = weekDays(mondayISO)
  const start = days[0]
  const end = new Date(days[6].getFullYear(), days[6].getMonth(), days[6].getDate() + 1)
  return date >= start && date < end
}

/** ECMWF — the model the rest of the app shows, for the week's weather. */
export const MEETING_WEATHER_MODEL = 'ecmwf_ifs025'

/* ── What goes on the agenda ─────────────────────────────────────────────
 *
 * The meeting page and the agenda on the Reports page pick their items with
 * these, so the downloaded agenda is the one that was on screen.
 */

type AgendaTask = { status: string; due_at: string | null; assignee_ids: string[] }

/**
 * Overdue as of the START of this week, not as of today. Looking back at last
 * week's agenda should show what was overdue when that meeting happened, not
 * what is overdue now — otherwise the record of the meeting rewrites itself.
 */
export function carriedOver<T extends AgendaTask>(tasks: T[], mondayISO: string): T[] {
  const start = weekDays(mondayISO)[0]
  return tasks.filter((t) => t.status === 'open' && t.due_at && new Date(t.due_at) < start).sort((a, b) => (a.due_at ?? '').localeCompare(b.due_at ?? ''))
}

export function dueInWeek<T extends AgendaTask>(tasks: T[], mondayISO: string): T[] {
  return tasks.filter((t) => t.status === 'open' && t.due_at && inWeek(new Date(t.due_at), mondayISO)).sort((a, b) => (a.due_at ?? '').localeCompare(b.due_at ?? ''))
}

/** Open work with nobody's name on it. The meeting is where these get one. */
export function unassignedTasks<T extends AgendaTask>(tasks: T[]): T[] {
  return tasks.filter((t) => t.status === 'open' && t.assignee_ids.length === 0).sort((a, b) => (a.due_at ?? '9999').localeCompare(b.due_at ?? '9999'))
}

/** Calendar events in the week, repeating ones expanded, in time order. */
export function weekEventsOf(events: { starts_at: string; rrule: string | null; title: string }[], mondayISO: string): { date: Date; title: string }[] {
  const days = weekDays(mondayISO)
  const start = days[0]
  const end = new Date(days[6].getFullYear(), days[6].getMonth(), days[6].getDate() + 1)
  const out: { date: Date; title: string }[] = []
  for (const e of events) for (const d of expandOccurrences(new Date(e.starts_at), e.rrule, start, end)) out.push({ date: d, title: e.title })
  return out.sort((a, b) => a.date.getTime() - b.date.getTime())
}

/**
 * The monthly checklist for the month the MEETING is in, which is not always
 * the month the week ends in: active jobs in season, not yet ticked off.
 */
export function monthlyOutstanding<T extends { id: string; active: boolean; start_month: number; end_month: number }, I extends { template_id: string; completed: boolean | null }>(
  templates: T[],
  instances: I[],
  mondayISO: string,
): { template: T; instance: I | null }[] {
  const month = weekDays(mondayISO)[0].getMonth() + 1
  const byTemplate = new Map(instances.map((i) => [i.template_id, i]))
  return templates
    .filter((t) => t.active)
    .filter((t) => (t.start_month <= t.end_month ? month >= t.start_month && month <= t.end_month : month >= t.start_month || month <= t.end_month))
    .map((t) => ({ template: t, instance: byTemplate.get(t.id) ?? null }))
    .filter((r) => !r.instance?.completed)
}

/**
 * Fields the model says will hit the trigger inside this week — the input to
 * the field-work discussion, not the answer to it. Fields finished for the
 * season are left out: the balance still crosses, but the pivot is shut off.
 */
export function waterThisWeek(
  crossings: Map<string, { date: string; recGross: number | null }>,
  doneWatering: Set<string>,
  fieldName: (id: string) => string,
  mondayISO: string,
): { fieldId: string; field: string; date: string; mm: number | null }[] {
  const out: { fieldId: string; field: string; date: string; mm: number | null }[] = []
  for (const [fieldId, c] of crossings) {
    if (doneWatering.has(fieldId)) continue
    const [y, m, d] = c.date.split('-').map(Number)
    if (!inWeek(new Date(y, m - 1, d), mondayISO)) continue
    out.push({ fieldId, field: fieldName(fieldId), date: c.date, mm: c.recGross })
  }
  return out.sort((a, b) => a.date.localeCompare(b.date))
}

export type MeetingNote = {
  id: string
  week_start: string
  plan: string | null
  updated_at: string
  updated_by: string | null
}

export function useMeetingNote(weekStartISO: string) {
  return useQuery({
    queryKey: ['meeting_notes', weekStartISO],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('meeting_notes')
        .select('*')
        .eq('week_start', weekStartISO)
        .maybeSingle()
      if (error) throw error
      return (data as MeetingNote | null) ?? null
    },
  })
}

export function useSaveMeetingNote(weekStartISO: string) {
  const qc = useQueryClient()
  const { profile } = useAuth()
  return useMutation({
    mutationFn: async (plan: string) => {
      const { error } = await supabase.from('meeting_notes').upsert(
        {
          week_start: weekStartISO,
          plan,
          updated_at: new Date().toISOString(),
          updated_by: profile?.id ?? null,
        },
        // The surrogate id is the primary key, so the conflict target has to be
        // the week — otherwise every save inserts a second row for the same
        // Monday and the agenda quietly starts reading whichever came back
        // first.
        { onConflict: 'week_start' },
      )
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['meeting_notes', weekStartISO] }),
  })
}

/* ------------------------------------------------------------------ alerts */

export type MeetingAlert = { kind: string; title: string; body: string | null; link: string | null; last_at: string; times: number }

/**
 * The week's alerts, farm-wide: from the Monday before this meeting to the end
 * of its week. Each alert once, however many people it went to (meeting_alerts).
 */
export function useMeetingAlerts(mondayISO: string) {
  return useQuery({
    queryKey: ['meeting_alerts', mondayISO],
    queryFn: async () => {
      const monday = new Date(`${mondayISO}T00:00:00`)
      const from = new Date(monday.getTime() - 7 * 86_400_000).toISOString()
      const to = new Date(monday.getTime() + 7 * 86_400_000).toISOString()
      const { data, error } = await supabase.rpc('meeting_alerts', { p_from: from, p_to: to, p_kinds: MEETING_ALERT_KINDS })
      if (error) throw error
      return ([...(data ?? [])] as MeetingAlert[]).sort((a, b) => b.last_at.localeCompare(a.last_at))
    },
  })
}

/** Alerts grouped by kind, so twelve grazing rules are one line with a count, not twelve. */
export function groupAlerts(alerts: MeetingAlert[]): { kind: string; latest: MeetingAlert; all: MeetingAlert[] }[] {
  const by = new Map<string, MeetingAlert[]>()
  for (const a of alerts) by.set(a.kind, [...(by.get(a.kind) ?? []), a])
  return [...by.entries()]
    .map(([kind, all]) => ({ kind, latest: all[0], all }))
    .sort((a, b) => b.latest.last_at.localeCompare(a.latest.last_at))
}
