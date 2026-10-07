import { useTasks } from '@/lib/tasks'
import { useFields, useUsers } from '@/lib/queries'
import { useCalendarEvents, useMonthlyInstances, useMonthlyTemplates } from '@/lib/calendar'
import { useRuns } from '@/lib/checklists'
import { useFieldSeasons, useForecastCrossings } from '@/lib/irrigation'
import { carriedOver, dueInWeek, groupAlerts, MEETING_WEATHER_MODEL, useMeetingAlerts, monthlyOutstanding, toISO, unassignedTasks, useMeetingNote, waterThisWeek, weekDays, weekEventsOf, weekStart } from '@/lib/meeting'
import { awayThisWeek, useTimeOff } from '@/lib/timeoff'
import { useFeature } from '@/lib/farm-setup'
import { useWeeklyFact } from '@/lib/meeting-fact'
import { TOPIC_LABEL } from '@/lib/farm-facts'
import { useAgNews } from '@/lib/ag-news'
import { useEvents } from '@/lib/events-data'
import { dateRange, meetingItems, priceToday } from '@/lib/events'
import { fmtMoney } from '@/lib/applied'
import { useRanchWeather, wmo } from '@/lib/ranchWeather'
import { useWeatherSites } from '@/lib/weatherSites'
import { meetingAgenda, type AgendaTask } from '@/lib/reports/meeting'
import type { HookRun } from '@/pages/reports/gatherers'
import { FAR_DAYS, NEAR_DAYS } from './ConferencesSection'

/**
 * The Monday meeting agenda for the Reports page: the same hooks the meeting
 * page reads, the same picks (lib/meeting.ts), laid out by
 * lib/reports/meeting.ts. The week is the one holding the picked day.
 */
export const useMeetingRun: HookRun = (p, ctx) => {
  const picked = p.week || ctx.today
  const [y, m, d] = picked.split('-').map(Number)
  const monday = weekStart(new Date(y, m - 1, d))

  const tasks = useTasks()
  const users = useUsers()
  const fields = useFields()
  const events = useCalendarEvents()
  // The crop year the app is set to, as on the meeting page.
  const runs = useRuns(ctx.cropYear)
  const templates = useMonthlyTemplates()
  const instances = useMonthlyInstances(ctx.cropYear)
  const crossings = useForecastCrossings()
  const seasons = useFieldSeasons(ctx.cropYear)
  const note = useMeetingNote(monday)
  const alerts = useMeetingAlerts(monday)
  const timeOff = useTimeOff()
  const timeOffOn = useFeature('time_off')
  const fact = useWeeklyFact(monday)
  const news = useAgNews()
  const conferences = useEvents()
  const { main: site } = useWeatherSites()
  const weather = useRanchWeather(site?.lat, site?.lng, MEETING_WEATHER_MODEL)

  const qs = [tasks, users, fields, events, runs, templates, instances, crossings, seasons, note, timeOff, news, conferences, alerts]
  // A feed that failed (the weather, the news) leaves its section out
  // rather than stopping the agenda; the farm's own records must all be in.
  const core = [tasks, users, fields, events, runs, templates, instances, note]
  return {
    ready: qs.every((q) => !q.isLoading) && !weather.isLoading && fact.state !== 'loading',
    error: (core.find((q) => q.error)?.error as Error | undefined) ?? null,
    build: () => {
      const nameOf = (id: string | null) => (users.data ?? []).find((u) => u.id === id)?.full_name ?? null
      const lite = (t: { title: string; due_at: string | null; assignee_ids: string[] }): AgendaTask => ({ title: t.title, due_at: t.due_at, who: t.assignee_ids.map(nameOf).filter((x): x is string => !!x) })
      const fieldName = (id: string) => (fields.data ?? []).find((f) => f.id === id)?.name ?? 'Unknown field'
      const done = new Set((seasons.data ?? []).filter((s) => s.irrigation_done_at).map((s) => s.field_id))
      const { soon, later } = meetingItems(conferences.data ?? [], NEAR_DAYS, FAR_DAYS)
      const week = new Set(weekDays(monday).map(toISO))
      const monthName = weekDays(monday)[0].toLocaleDateString('en-CA', { month: 'long' })
      const saved = note.data?.updated_at ? `Saved ${new Date(note.data.updated_at).toLocaleString('en-CA')}${nameOf(note.data.updated_by) ? ` by ${nameOf(note.data.updated_by)}` : ''}.` : null
      return meetingAgenda({
        monday,
        fact: fact.state === 'fact' ? { title: fact.fact.title, topic: TOPIC_LABEL[fact.fact.topic], body: fact.fact.body, soWhat: fact.fact.soWhat } : null,
        factNote: fact.state === 'exhausted' ? `Every fact suited to ${monthName} has been read out already. More are being written.` : undefined,
        news: (news.data ?? []).map((n) => ({ title: n.title, source: n.source, published_at: n.published_at, summary: n.summary })),
        alerts: alerts.data ? groupAlerts(alerts.data).map((g) => ({ kind: g.kind, title: g.latest.title, at: g.latest.last_at, more: g.all.length - 1 })) : undefined,
        away: timeOffOn ? awayThisWeek(timeOff.data ?? [], monday) : null,
        carried: carriedOver(tasks.data ?? [], monday).map(lite),
        due: dueInWeek(tasks.data ?? [], monday).map(lite),
        unassigned: unassignedTasks(tasks.data ?? []).map(lite),
        monthly: monthlyOutstanding(templates.data ?? [], instances.data ?? [], monday).map((x) => ({ title: x.template.title, who: nameOf(x.template.default_assignee) })),
        runs: (runs.data ?? []).filter((r) => r.status === 'open').map((r) => ({ name: r.name })),
        water: waterThisWeek(crossings.data ?? new Map(), done, fieldName, monday),
        doneWatering: [...done].map(fieldName).sort(),
        conferences: {
          soon: soon.map((i) => {
            const price = priceToday(i.event)
            const deadline = i.deadline ? `${i.deadline.kind === 'early_bird' ? 'Early-bird price ends' : 'Registration closes'} ${i.deadline.on} (${i.deadline.daysLeft} days)` : null
            return {
              name: i.event.name,
              when: i.projected ? `around ${dateRange({ starts_on: i.on, ends_on: null })}` : dateRange(i.event),
              where: [i.event.city, i.event.region].filter(Boolean).join(', ') || i.event.country || '',
              note: [deadline, price != null ? fmtMoney(price) : null].filter(Boolean).join(' · ') || null,
            }
          }),
          later: later.map((i) => `${i.event.name} (${i.projected ? `around ${dateRange({ starts_on: i.on, ends_on: null })}` : dateRange(i.event)})`),
        },
        events: weekEventsOf(events.data ?? [], monday),
        // The forecast runs seven days out: another week has none, and says nothing rather than guess.
        weather: site
          ? {
              site: site.name,
              days: (weather.data?.daily ?? []).filter((f) => week.has(f.date)).map((f) => ({ date: f.date, label: wmo(f.code).label, hi: f.hi, lo: f.lo, pop: f.pop, precip: f.precip })),
            }
          : null,
        plan: note.data?.plan ?? '',
        planSaved: saved,
      })
    },
  }
}
