import { lazy, Suspense, useMemo, useState } from 'react'
import { ConferencesSection } from '@/pages/meeting/ConferencesSection'
import { BriefingSection } from '@/pages/meeting/BriefingSection'
import { Link } from 'react-router-dom'
import { useTab } from '@/lib/useTab'
import {
  AlertTriangle,
  Plus,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Droplets,
  Printer,
  Umbrella,
} from 'lucide-react'
import { hasManagerAccess, useAuth } from '@/lib/auth'
import { useCropYear } from '@/lib/crop-year'
import { awayThisWeek, useTimeOff } from '@/lib/timeoff'
import { useFeature } from '@/lib/farm-setup'
import { useTaskMutations, useTasks, uploadTaskFiles } from '@/lib/tasks'
import { TaskForm, fromLocalDateInput, fromLocalInput } from '@/components/TaskForm'
import { useUsers } from '@/lib/queries'
import { useFields } from '@/lib/queries'
import { useCalendarEvents, useMonthlyInstances, useMonthlyTemplates } from '@/lib/calendar'
import { useRuns } from '@/lib/checklists'
import { useFieldSeasons, useForecastCrossings } from '@/lib/irrigation'
import {
  carriedOver,
  dueInWeek,
  MEETING_WEATHER_MODEL,
  monthlyOutstanding,
  shiftWeek,
  toISO,
  unassignedTasks,
  useMeetingNote,
  useMeetingAlerts,
  groupAlerts,
  useSaveMeetingNote,
  waterThisWeek,
  weekDays,
  weekEventsOf,
  weekStart,
} from '@/lib/meeting'
import { PillTabs } from '@/components/PillTabs'
import { useRanchWeather, wmo, type ForecastDay } from '@/lib/ranchWeather'
import { useWeatherSites } from '@/lib/weatherSites'
import { cn } from '@/lib/utils'
import { InfoPopover } from '@/components/InfoPopover'
import { alertGuide } from '@/lib/alert-guides'


/**
 * The Monday morning agenda.
 *
 * Assembled from screens that already exist — overdue tasks, the week's
 * calendar, the monthly checklist, the irrigation model. Running the meeting
 * off five screens means somebody scrolls while everybody waits, and what gets
 * skipped is whichever screen was awkward to reach.
 *
 * The order is the order the meeting goes in, which is not the order the app
 * stores things in: what did not get done, what is coming, what the ground
 * needs, what we are going to do. Carried-over work leads because it is the
 * only section that is a question rather than a list.
 *
 * Three tabs: the agenda is the whole run-sheet, This week is the same
 * week laid out as seven days, and What's new is what changed in the app last
 * week (its own page until 7 Oct 2026; /whats-new redirects here). There used to be five — Tasks, Conferences and
 * Irrigation were drill-downs — but Tasks repeated the agenda's Carried over
 * list, and the other two were short enough to be agenda sections that link to
 * their full pages. Old ?tab= links land on the agenda.
 */
const MEETING_TABS = ['agenda', 'calendar', 'whats-new'] as const
type MeetingTab = (typeof MEETING_TABS)[number]
const TAB_LABEL: Record<MeetingTab, string> = {
  agenda: 'Agenda',
  calendar: 'This week',
  'whats-new': "What's new",
}
/** Tabs folded into the agenda, so saved links and tiles still land. */
const OLD_TABS: Record<string, MeetingTab> = {
  tasks: 'agenda',
  conferences: 'agenda',
  irrigation: 'agenda',
}

/** Loaded only when its tab is opened. */
const WhatsNewView = lazy(() => import('@/pages/WhatsNewPage').then((m) => ({ default: m.WhatsNewView })))

export function MeetingPage() {
  const { profile } = useAuth()
  const isManager = hasManagerAccess(profile?.role)
  const { cropYear } = useCropYear()
  const [monday, setMonday] = useState(() => weekStart())
  // Opening tab from the URL, so a tile or a pasted link can land on the one
  // somebody means; remembered, so a refresh does too.
  const [tab, setTab] = useTab<MeetingTab>('meeting', MEETING_TABS, 'agenda', (t) => OLD_TABS[t])

  const { data: tasks } = useTasks()
  const { create: createTask } = useTaskMutations()
  const [showNewTask, setShowNewTask] = useState(false)
  const { data: events } = useCalendarEvents()
  const { data: users } = useUsers()
  const { data: fields } = useFields()
  const { data: runs } = useRuns(cropYear)
  const { data: monthlyTemplates } = useMonthlyTemplates()
  const { data: monthlyInstances } = useMonthlyInstances(cropYear)
  const { data: crossings } = useForecastCrossings()
  const { data: seasons } = useFieldSeasons(cropYear)
  const { data: note } = useMeetingNote(monday)
  const saveNote = useSaveMeetingNote(monday)

  const days = weekDays(monday)
  // Who is off this week, from the time-off calendar — said before the jobs are handed out.
  const { data: timeOff } = useTimeOff()
  const away = useMemo(() => awayThisWeek(timeOff ?? [], monday), [timeOff, monday])
  const timeOffOn = useFeature('time_off')
  const [draft, setDraft] = useState<string | null>(null)
  const plan = draft ?? note?.plan ?? ''

  const nameOf = (id: string | null) => (users ?? []).find((u) => u.id === id)?.full_name ?? null

  // What goes in each section: lib/meeting.ts picks them, so the agenda
  // downloaded from the Reports page is this one.
  const carried = useMemo(() => carriedOver(tasks ?? [], monday), [tasks, monday])
  const dueThisWeek = useMemo(() => dueInWeek(tasks ?? [], monday), [tasks, monday])
  const unassigned = useMemo(() => unassignedTasks(tasks ?? []), [tasks])
  const weekEvents = useMemo(() => weekEventsOf(events ?? [], monday), [events, monday])
  const monthly = useMemo(
    () => monthlyOutstanding(monthlyTemplates ?? [], monthlyInstances ?? [], monday),
    [monthlyTemplates, monthlyInstances, monday],
  )

  const openRuns = (runs ?? []).filter((r) => r.status === 'open')
  const { data: alerts } = useMeetingAlerts(monday)
  const alertGroups = useMemo(() => groupAlerts(alerts ?? []), [alerts])

  // Fields the model says will hit the trigger inside this week. This is the
  // input to the field-work discussion rather than the answer to it: it says
  // which ground will be asking for water, not who is moving what.
  const doneWatering = useMemo(
    () => new Set((seasons ?? []).filter((s) => s.irrigation_done_at).map((s) => s.field_id)),
    [seasons],
  )
  const water = useMemo(
    () =>
      waterThisWeek(
        crossings ?? new Map(),
        doneWatering,
        (id) => (fields ?? []).find((f) => f.id === id)?.name ?? 'Unknown field',
        monday,
      ),
    [crossings, fields, monday, doneWatering],
  )

  // Home Ranch, on the model the farm goes by. One station rather than three:
  // the meeting is deciding one week's work, and three columns of numbers to
  // read before the first task is a worse agenda, not a better one.
  const { main: homeRanch } = useWeatherSites()
  const { data: weather } = useRanchWeather(homeRanch?.lat, homeRanch?.lng, MEETING_WEATHER_MODEL)
  const forecast = useMemo(() => new Map((weather?.daily ?? []).map((f) => [f.date, f])), [weather])

  const dayLabel = (d: Date) =>
    d.toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' })

  const thisWeek = monday === weekStart()

  return (
    <div className="p-4 md:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 print:hidden">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setMonday(shiftWeek(monday, -1))}
            aria-label="Previous week"
            className="rounded-md border border-gray-300 p-1.5 text-gray-600 hover:bg-gray-50"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            onClick={() => setMonday(shiftWeek(monday, 1))}
            aria-label="Next week"
            className="rounded-md border border-gray-300 p-1.5 text-gray-600 hover:bg-gray-50"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          {!thisWeek && (
            <button
              onClick={() => setMonday(weekStart())}
              className="ml-1 rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              This week
            </button>
          )}
        </div>
        <button
          onClick={() => window.print()}
          className="flex items-center gap-1.5 rounded-md border border-gray-300 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
        >
          <Printer className="h-3.5 w-3.5" /> Print
        </button>
      </div>

      <h1 className="text-lg font-semibold text-gray-900">Monday meeting</h1>
      <p className="mb-4 text-xs text-gray-500">
        Week of {dayLabel(days[0])} – {dayLabel(days[6])}
        {!thisWeek && ' · not this week'}
      </p>

      <PillTabs
        tabs={MEETING_TABS.map((t) => ({ key: t, label: TAB_LABEL[t] }))}
        value={tab}
        onChange={setTab}
        className="mb-4 print:hidden"
      />

      {/* The agenda prints whichever tab is open — a printed agenda missing
          its parts is worse than no printout, and nobody finds out until they
          are standing in front of everybody. The week grid is the exception: it
          is the same events the agenda already lists, laid out differently. */}

      {/* AGENDA — the whole run-sheet, in the order the meeting goes. */}
      <div className={cn('space-y-4', tab !== 'agenda' && 'hidden print:block print:space-y-4')}>
        {/* 0. One thing worth knowing, and what moved in the industry.
            Deliberately at the TOP: it is the part people arrive for, and a
            section that lives under the job list gets read out only in a week
            where the job list was short. */}
        <BriefingSection weekOf={monday} />

        {/* Alerts the farm raised since last Monday — river, pivots, bins,
            grazing, frost, the winterizing freeze — each kind once, however
            many people it went to. The high-river "pull pumps" job is a task,
            so it is under Unassigned below. */}
        <Section
          icon={AlertTriangle}
          title="Alerts"
          count={alertGroups.length}
          tone="warn"
          hint="Everything the app raised in the last week that asks for action, for the whole farm. Several alerts of one kind are one line; the newest is shown."
          empty="No alerts in the last week."
          more={{ to: '/notifications', label: 'All alerts' }}
        >
          {alertGroups.map((g) => (
            <Row
              key={g.kind}
              to={g.latest.link || '/notifications'}
              title={g.all.length > 1 ? `${alertGuide(g.kind).name}: ${g.latest.title} (+${g.all.length - 1} more)` : g.latest.title}
              meta={[new Date(g.latest.last_at).toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' })]}
              alert
            />
          ))}
        </Section>

        {/* Who is away, before the jobs are handed out: it is the one fact
            that changes who every line below can go to. From the time-off
            calendar, so it goes when the farm has switched that off. */}
        {timeOffOn && (
          <Section
            icon={Umbrella}
            title="Away this week"
            count={away.length}
            tone={away.length ? 'warn' : 'ok'}
            empty="Everyone is here this week."
            hint="Approved time off from the time-off calendar, read daily. The calendar has the rest of the year."
          >
            <ul className="divide-y divide-gray-100">
              {away.map((a, i) => (
                <li
                  key={`${a.who}-${i}`}
                  className="flex flex-wrap items-baseline gap-x-2 py-1.5 text-sm"
                >
                  <span className="font-medium text-gray-900">{a.who}</span>
                  <span className="text-gray-700">{a.when}</span>
                  {a.hours != null && a.hours < 8 && (
                    <span className="text-xs text-gray-500">{a.hours} h</span>
                  )}
                  {!/^paid time off$/i.test(a.kind) && (
                    <span className="text-xs text-gray-500">{a.kind.toLowerCase()}</span>
                  )}
                  {a.reason && <span className="text-xs text-gray-400">· {a.reason}</span>}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* 1. What did not get done. First because it is the only section that
            is a question rather than a list. Once — it used to be here and
            again on a Tasks tab. */}
        <Section
          icon={AlertTriangle}
          title="Carried over"
          count={carried.length}
          tone={carried.length ? 'warn' : 'ok'}
          empty="Nothing was left over. Good week."
          hint="Open tasks that were already past due when this week began."
        >
          {carried.map((t) => (
            <Row
              key={t.id}
              to={`/tasks/${t.id}`}
              title={t.title}
              meta={[
                t.due_at
                  ? `due ${new Date(t.due_at).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}`
                  : null,
                t.assignee_ids.map(nameOf).filter(Boolean).join(', ') || '—',
              ]}
              alert
            />
          ))}
        </Section>

        <Section
          icon={CheckSquare}
          title="Due this week"
          count={dueThisWeek.length}
          empty="Nothing due."
        >
          {dueThisWeek.map((t) => (
            <Row
              key={t.id}
              to={`/tasks/${t.id}`}
              title={t.title}
              meta={[
                t.due_at
                  ? new Date(t.due_at).toLocaleDateString('en-CA', { weekday: 'short' })
                  : null,
                t.assignee_ids.map(nameOf).filter(Boolean).join(', ') || '—',
              ]}
            />
          ))}
        </Section>

        <Section
          icon={CheckSquare}
          title="Unassigned"
          count={unassigned.length}
          tone={unassigned.length ? 'warn' : 'ok'}
          empty="Everything open has a name on it."
          hint="Open work nobody has picked up. The meeting is where these get a name."
        >
          {unassigned.map((t) => (
            <Row
              key={t.id}
              to={`/tasks/${t.id}`}
              title={t.title}
              meta={[
                t.due_at
                  ? `due ${new Date(t.due_at).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}`
                  : 'no date',
              ]}
            />
          ))}
        </Section>

        <Section
          icon={ClipboardCheck}
          title={`${days[0].toLocaleDateString('en-CA', { month: 'long' })} checklist`}
          count={monthly.length + openRuns.length}
          empty="Nothing outstanding for the month."
          hint="Monthly jobs not yet ticked off, and any checklist run still open."
        >
          {monthly.map((m) => (
            <Row
              key={m.template.id}
              to="/monthly"
              title={m.template.title}
              meta={[nameOf(m.template.default_assignee)]}
            />
          ))}
          {openRuns.map((r) => (
            <Row
              key={r.id}
              to={`/checklists/runs/${r.id}`}
              title={r.name}
              meta={['run in progress']}
            />
          ))}
        </Section>

        {/* What the ground is asking for. Only when a field reaches its
            trigger this week — the full picture is on the irrigation page. */}
        {water.length > 0 && (
          <Section
            icon={Droplets}
            title="Water this week"
            count={water.length}
            empty=""
            hint="Where the moisture model says the balance hits the irrigate trigger, if nothing is applied. Fields marked finished for the season are left out."
            more={{ to: '/irrigation', label: 'Irrigation' }}
          >
            {water.map((w, i) => (
              <Row
                key={i}
                to="/irrigation"
                title={w.field}
                meta={[
                  new Date(w.date + 'T00:00:00').toLocaleDateString('en-CA', {
                    weekday: 'short',
                    month: 'short',
                    day: 'numeric',
                  }),
                  w.mm != null ? `${Math.round(w.mm)} mm` : null,
                ]}
              />
            ))}
            {doneWatering.size > 0 && (
              <li className="py-1.5 text-xs text-gray-500">
                Finished for the season:{' '}
                {[...doneWatering]
                  .map((id) => (fields ?? []).find((f) => f.id === id)?.name ?? 'Unknown field')
                  .sort()
                  .join(', ')}{' '}
                <Link to="/fields" className="text-brand-700 hover:underline print:hidden">
                  change on the field list
                </Link>
              </li>
            )}
          </Section>
        )}

        {/* Conferences: shows itself only when something is on or a deadline
            is coming; the full list is the Events page. */}
        <ConferencesSection />

        {/* A meeting is where jobs get handed out, so this is where they have
            to be writable. Sending somebody to the Tasks page to type what was
            just agreed means half of it never gets typed. Hidden from the
            printed run-sheet, which is a record of the meeting rather than a
            thing you fill in. */}
        <div className="print:hidden">
          {showNewTask ? (
            <div className="rounded-lg border border-gray-200 bg-white p-3">
              <TaskForm
                submitLabel="Add task"
                pending={createTask.isPending}
                error={createTask.isError ? (createTask.error as Error).message : null}
                onCancel={() => setShowNewTask(false)}
                onSubmit={(v) =>
                  createTask.mutate(
                    {
                      title: v.title,
                      description_md: v.description || null,
                      field_id: v.field_id || null,
                      equipment_id: v.equipment_id || null,
                      assignees: v.assignees,
                      subtasks: v.subtasks,
                      due_at: fromLocalDateInput(v.due_at),
                      reminder_at: fromLocalInput(v.reminder_at),
                    },
                    {
                      onSuccess: (taskId) => {
                        if (v.attachments.length) void uploadTaskFiles(taskId, v.attachments)
                        setShowNewTask(false)
                      },
                    },
                  )
                }
              />
            </div>
          ) : (
            <button
              onClick={() => setShowNewTask(true)}
              className="flex items-center gap-1.5 rounded-md bg-brand-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-800"
            >
              <Plus className="h-3.5 w-3.5" /> Add a task from this meeting
            </button>
          )}
        </div>

        {/* What we are going to do about it. The only part the app cannot
            assemble, and the reason the meeting happens. */}
        <section className="rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-gray-800">
            The plan
            <InfoPopover title="The plan">
              <p>
                Field work, who is on what, anything agreed. Saved against this week, so last Monday
                is a lookup rather than a memory.
              </p>
            </InfoPopover>
          </h2>
          {isManager ? (
            <>
              <textarea
                value={plan}
                onChange={(e) => setDraft(e.target.value)}
                rows={8}
                placeholder={
                  'Seeding / spraying / harvest — what, which fields, who\nMachinery moves\nAnything waiting on somebody'
                }
                className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
              <div className="mt-2 flex items-center gap-2 print:hidden">
                <button
                  onClick={() => saveNote.mutate(plan, { onSuccess: () => setDraft(null) })}
                  disabled={saveNote.isPending || draft === null}
                  className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-40"
                >
                  {saveNote.isPending ? 'Saving…' : 'Save'}
                </button>
                {note?.updated_at && draft === null && (
                  <span className="text-[11px] text-gray-400">
                    Saved {new Date(note.updated_at).toLocaleString('en-CA')}
                    {note.updated_by && nameOf(note.updated_by)
                      ? ` by ${nameOf(note.updated_by)}`
                      : ''}
                  </span>
                )}
                {saveNote.isError && (
                  <span className="text-[11px] text-red-700">
                    {(saveNote.error as Error).message}
                  </span>
                )}
              </div>
            </>
          ) : plan ? (
            <p className="mt-2 whitespace-pre-wrap text-sm text-gray-800">{plan}</p>
          ) : (
            <p className="mt-2 text-sm text-gray-400">Nothing written down for this week yet.</p>
          )}
        </section>
      </div>

      {/* THIS WEEK — the week as a week. Seven boxes show the one thing a list
          cannot: which day is empty, which is why it is worth its own tab
          rather than being the same events sorted by date. Calendar events and
          task due dates; today is outlined. */}
      <div className={cn(tab !== 'calendar' && 'hidden')}>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-7">
          {days.map((d) => {
            const iso = toISO(d)
            const dayEvents = weekEvents.filter((e) => toISO(e.date) === iso)
            const dayTasks = dueThisWeek.filter(
              (t) => t.due_at && toISO(new Date(t.due_at)) === iso,
            )
            const isToday = iso === toISO(new Date())
            return (
              <div
                key={iso}
                className={cn(
                  'rounded-lg border bg-white p-2',
                  isToday ? 'border-brand-600 ring-1 ring-brand-600/20' : 'border-gray-200',
                )}
              >
                <p
                  className={cn(
                    'text-[11px] font-semibold uppercase tracking-wide',
                    isToday ? 'text-brand-800' : 'text-gray-500',
                  )}
                >
                  {d.toLocaleDateString('en-CA', { weekday: 'short' })}{' '}
                  <span className="font-normal text-gray-400">{d.getDate()}</span>
                </p>
                <DayWeather day={forecast.get(iso)} />
                <ul className="mt-1.5 space-y-1">
                  {dayEvents.map((e, i) => (
                    <li
                      key={`e${i}`}
                      className="rounded bg-brand-50 px-1.5 py-1 text-[11px] leading-snug text-brand-900"
                    >
                      {e.title}
                    </li>
                  ))}
                  {dayTasks.map((t) => (
                    <li key={t.id}>
                      <Link
                        to={`/tasks/${t.id}`}
                        className="block rounded bg-gray-100 px-1.5 py-1 text-[11px] leading-snug text-gray-700 hover:bg-gray-200"
                      >
                        ☑ {t.title}
                      </Link>
                    </li>
                  ))}
                  {dayEvents.length === 0 && dayTasks.length === 0 && (
                    <li className="px-1.5 py-1 text-[11px] text-gray-300">—</li>
                  )}
                </ul>
              </div>
            )
          })}
        </div>
      </div>

      {/* WHAT'S NEW — what changed in the app last week, read out at the meeting. */}
      {tab === 'whats-new' && (
        <Suspense fallback={<p className="text-sm text-gray-500">Loading…</p>}>
          <WhatsNewView />
        </Suspense>
      )}
    </div>
  )
}

function Section({
  icon: Icon,
  title,
  count,
  tone = 'plain',
  hint,
  empty,
  more,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  count: number
  tone?: 'plain' | 'warn' | 'ok'
  /** What the section is, behind ⓘ beside the title. */
  hint?: string
  empty: string
  /** The page that has the whole picture. */
  more?: { to: string; label: string }
  children: React.ReactNode
}) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4 break-inside-avoid">
      <div className="flex items-center gap-1.5">
        <Icon
          className={cn(
            'h-4 w-4',
            tone === 'warn' && count > 0 ? 'text-amber-600' : 'text-gray-400',
          )}
        />
        <h2 className="text-sm font-semibold text-gray-800">{title}</h2>
        <span
          className={cn(
            'rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums',
            tone === 'warn' && count > 0
              ? 'bg-amber-100 text-amber-900'
              : 'bg-gray-100 text-gray-600',
          )}
        >
          {count}
        </span>
        {hint && (
          <InfoPopover title={title} className="print:hidden">
            <p>{hint}</p>
          </InfoPopover>
        )}
        {more && (
          <Link
            to={more.to}
            className="ml-auto text-xs text-brand-700 hover:underline print:hidden"
          >
            {more.label} →
          </Link>
        )}
      </div>
      {count === 0 ? (
        <p className="mt-2 text-sm text-gray-400">{empty}</p>
      ) : (
        <ul className="mt-2 divide-y divide-gray-100">{children}</ul>
      )}
    </section>
  )
}

function Row({
  to,
  title,
  meta,
  alert,
}: {
  to: string
  title: string
  meta: (string | null)[]
  alert?: boolean
}) {
  const shown = meta.filter(Boolean)
  return (
    <li>
      <Link to={to} className="flex items-center gap-2 py-1.5 text-sm hover:text-brand-700">
        {alert && <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600" />}
        <span className="min-w-0 flex-1 truncate">{title}</span>
        {shown.length > 0 && (
          <span className="shrink-0 text-xs text-gray-400">{shown.join(' · ')}</span>
        )}
      </Link>
    </li>
  )
}

/**
 * One day's forecast, above whatever is happening that day.
 *
 * High and low, the chance of rain and how much. Kept to one line because it is
 * context for the day's work rather than the subject — the question in the room
 * is "can we spray Wednesday", and that is answered by a number and an icon,
 * not by a panel.
 *
 * The forecast runs seven days out, so looking at next week's agenda or back at
 * last week's shows nothing rather than a stale guess.
 */
function DayWeather({ day }: { day: ForecastDay | undefined }) {
  if (!day) return null
  const Icon = wmo(day.code).icon
  const wet = (day.pop ?? 0) >= 40 || (day.precip ?? 0) >= 1
  return (
    <div
      className={cn(
        'mt-1 flex items-center gap-1.5 rounded px-1.5 py-1 text-[11px]',
        wet ? 'bg-sky-50 text-sky-900' : 'bg-gray-50 text-gray-600',
      )}
      title={wmo(day.code).label}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="font-semibold tabular-nums">
        {day.hi == null ? '—' : Math.round(day.hi)}°
        <span className="font-normal text-gray-400">
          /{day.lo == null ? '—' : Math.round(day.lo)}°
        </span>
      </span>
      {(day.pop ?? 0) > 0 && (
        <span className="ml-auto tabular-nums">
          {Math.round(day.pop ?? 0)}%
          {(day.precip ?? 0) > 0 && (
            <span className="ml-0.5 text-[10px]">{(day.precip ?? 0).toFixed(1)}mm</span>
          )}
        </span>
      )}
    </div>
  )
}
