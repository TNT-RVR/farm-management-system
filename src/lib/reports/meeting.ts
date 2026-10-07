import type { AwayThisWeek } from '@/lib/timeoff'
import { weekDays } from '@/lib/meeting'
import type { Cell, ReportData, ReportGroup } from './framework'

/**
 * The Monday meeting agenda as a file: the meeting page's agenda, section
 * for section in the order the meeting goes (MeetingPage.tsx), plus the
 * week's calendar and weather that its This week tab shows. Every section is
 * the same four columns — what, when, who, and a note — so the CSV is one
 * list of agenda items with the section first, and the PDF a table a section.
 *
 * The hook that reads it all is pages/meeting/meeting-report.ts; this is the
 * part that lays it out, kept pure so it can be tested.
 */

export type AgendaTask = { title: string; due_at: string | null; who: string[] }

export type AgendaInput = {
  monday: string
  fact: { title: string; topic: string; body: string; soWhat: string } | null
  /** Said instead of a fact when there is none ("Every fact suited to October has been read out."). */
  factNote?: string
  news: { title: string; source: string; published_at: string | null; summary: string | null }[]
  /** The week's alerts, one line per kind (lib/meeting.ts groupAlerts). Left out when unknown. */
  alerts?: { kind: string; title: string; at: string; more: number }[]
  /** Null when the farm has staff time off switched off: the section is not on the agenda. */
  away: AwayThisWeek[] | null
  carried: AgendaTask[]
  due: AgendaTask[]
  unassigned: AgendaTask[]
  monthly: { title: string; who: string | null }[]
  runs: { name: string }[]
  water: { field: string; date: string; mm: number | null }[]
  doneWatering: string[]
  conferences: { soon: { name: string; when: string; where: string; note: string | null }[]; later: string[] }
  events: { date: Date; title: string }[]
  weather: { site: string; days: { date: string; label: string; hi: number | null; lo: number | null; pop: number | null; precip: number | null }[] } | null
  plan: string
  planSaved?: string | null
}

const local = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d)
}
const md = (d: Date) => d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })
const wd = (d: Date) => d.toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' })
const due = (iso: string | null) => (iso ? new Date(iso) : null)

export const AGENDA_COLUMNS = [{ label: 'Item' }, { label: 'When' }, { label: 'Who' }, { label: 'Notes' }]

/** The week's dates as the page heads it: "Mon, Oct 6 – Sun, Oct 12". */
export function weekLabel(monday: string): string {
  const days = weekDays(monday)
  return `${wd(days[0])} – ${wd(days[6])}`
}

export function agendaGroups(a: AgendaInput): ReportGroup[] {
  const names = (who: string[]) => who.join(', ') || '—'
  const groups: ReportGroup[] = []

  groups.push({
    title: 'Worth knowing',
    rows: a.fact ? [[a.fact.title, null, null, `${a.fact.topic}. ${a.fact.body} So: ${a.fact.soWhat}`]] : [],
    empty: a.factNote ?? 'Nothing in the library yet.',
  })
  groups.push({
    title: 'This week in the industry',
    rows: a.news.map((n): Cell[] => [n.title, n.published_at ? md(new Date(n.published_at)) : null, n.source, n.summary]),
    empty: 'Nothing pulled yet. The feeds are read early Monday.',
  })
  if (a.alerts)
    groups.push({
      title: 'Alerts',
      note: 'Raised in the last week, farm-wide. The high-river "pull pumps" job is under Unassigned.',
      rows: a.alerts.map((x): Cell[] => [x.title, md(new Date(x.at)), null, x.more ? `+${x.more} more like it` : null]),
      empty: 'No alerts in the last week.',
    })
  if (a.away)
    groups.push({
      title: 'Away this week',
      rows: a.away.map((x): Cell[] => [x.who, x.when, null, [x.hours != null && x.hours < 8 ? `${x.hours} h` : null, /^paid time off$/i.test(x.kind) ? null : x.kind.toLowerCase(), x.reason].filter(Boolean).join(' · ') || null]),
      empty: 'Everyone is here this week.',
    })
  groups.push({
    title: 'Carried over',
    note: 'Open tasks that were already past due when this week began.',
    rows: a.carried.map((t): Cell[] => [t.title, t.due_at ? `due ${md(due(t.due_at)!)}` : null, names(t.who), null]),
    empty: 'Nothing was left over. Good week.',
  })
  groups.push({
    title: 'Due this week',
    rows: a.due.map((t): Cell[] => [t.title, t.due_at ? wd(due(t.due_at)!) : null, names(t.who), null]),
    empty: 'Nothing due.',
  })
  groups.push({
    title: 'Unassigned',
    note: 'Open work nobody has picked up. The meeting is where these get a name.',
    rows: a.unassigned.map((t): Cell[] => [t.title, t.due_at ? `due ${md(due(t.due_at)!)}` : 'no date', null, null]),
    empty: 'Everything open has a name on it.',
  })
  const month = weekDays(a.monday)[0].toLocaleDateString('en-CA', { month: 'long' })
  groups.push({
    title: `${month} checklist`,
    rows: [...a.monthly.map((m): Cell[] => [m.title, null, m.who, 'monthly job']), ...a.runs.map((r): Cell[] => [r.name, null, null, 'run in progress'])],
    empty: 'Nothing outstanding for the month.',
  })
  // Water and conferences are on the agenda only when there is something to
  // raise, as on the page.
  if (a.water.length)
    groups.push({
      title: 'Water this week',
      note: `Where the moisture model says the balance hits the irrigate trigger, if nothing is applied.${a.doneWatering.length ? ` Finished for the season: ${a.doneWatering.join(', ')}.` : ''}`,
      rows: a.water.map((w): Cell[] => [w.field, wd(local(w.date)), null, w.mm != null ? `${Math.round(w.mm)} mm to apply` : null]),
    })
  if (a.conferences.soon.length || a.conferences.later.length)
    groups.push({
      title: 'Conferences',
      note: a.conferences.later.length ? `Next six months: ${a.conferences.later.join(' · ')}` : undefined,
      rows: a.conferences.soon.map((c): Cell[] => [c.name, c.when, c.where, c.note]),
      empty: 'Nothing in the next month.',
    })
  groups.push({
    title: 'On the calendar',
    rows: a.events.map((e): Cell[] => [e.title, wd(e.date), null, null]),
    empty: 'Nothing on the calendar this week.',
  })
  if (a.weather?.days.length)
    groups.push({
      title: `Weather at ${a.weather.site}`,
      rows: a.weather.days.map((d): Cell[] => [
        d.label,
        wd(local(d.date)),
        null,
        [d.hi == null ? null : `${Math.round(d.hi)}° / ${d.lo == null ? '—' : Math.round(d.lo)}°`, d.pop ? `${Math.round(d.pop)}% rain` : null, d.precip ? `${d.precip.toFixed(1)} mm` : null].filter(Boolean).join(', ') || null,
      ]),
    })
  // The part the app cannot assemble: what was agreed. A line a row, as written.
  const plan = a.plan.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  groups.push({ title: 'The plan', note: a.planSaved ?? undefined, rows: plan.map((l): Cell[] => [l, null, null, null]), empty: 'Nothing written down for this week yet.' })
  return groups
}

export function meetingAgenda(a: AgendaInput): ReportData {
  const groups = agendaGroups(a)
  return {
    title: 'Monday meeting',
    subtitle: `Week of ${weekLabel(a.monday)}`,
    meta: [
      ...(a.alerts ? ([['Alerts', a.alerts.length]] as [string, Cell][]) : []),
      ['Carried over', a.carried.length],
      ['Due this week', a.due.length],
      ['Unassigned', a.unassigned.length],
      ...(a.away ? ([['Away', a.away.length]] as [string, Cell][]) : []),
      ['Water this week', a.water.length],
    ],
    columns: AGENDA_COLUMNS,
    groups,
    groupLabel: 'Section',
    filename: `Monday meeting ${a.monday}`,
  }
}
