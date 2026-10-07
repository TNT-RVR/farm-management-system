import { DateField } from '@/components/DateField'
import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  ExternalLink,
  Link2,
  Plus,
  RefreshCw,
  X,
} from 'lucide-react'
import { HelpNote } from '@/components/HelpNote'
import { Select } from '@/components/Select'
import { hasManagerAccess, useAuth } from '@/lib/auth'
import { useCropYear } from '@/lib/crop-year'
import { useFields } from '@/lib/queries'
import { useTasks } from '@/lib/tasks'
import { useRuns } from '@/lib/checklists'
import { useEquipment } from '@/lib/equipment'
import { warrantyStatus } from '@/lib/warranty'
import { daysOff, timeOffLabel, useSyncTimeOff, useTimeOff } from '@/lib/timeoff'
import { useFeature } from '@/lib/farm-setup'
import {
  EVENT_KINDS,
  feedUrlFor,
  googleSubscribeUrl,
  useCalendarEvents,
  useEventMutations,
  useFeedToken,
  useRegenerateFeedToken,
  type CalendarEventRow,
  type EventKind,
} from '@/lib/calendar'
import { expandOccurrences } from '@/lib/recur'
import { cn } from '@/lib/utils'

const KIND_COLORS: Record<EventKind, string> = {
  general: 'bg-gray-200 text-gray-800',
  field_work: 'bg-green-200 text-green-900',
  meeting: 'bg-sky-200 text-sky-900',
  maintenance: 'bg-amber-200 text-amber-900',
  delivery: 'bg-purple-200 text-purple-900',
  other: 'bg-gray-200 text-gray-800',
}

const RECURRENCE_OPTS: { label: string; rrule: string | null }[] = [
  { label: 'Does not repeat', rrule: null },
  { label: 'Daily', rrule: 'FREQ=DAILY' },
  { label: 'Weekly', rrule: 'FREQ=WEEKLY' },
  { label: 'Every 2 weeks', rrule: 'FREQ=WEEKLY;INTERVAL=2' },
  { label: 'Monthly', rrule: 'FREQ=MONTHLY' },
  { label: 'Yearly', rrule: 'FREQ=YEARLY' },
]

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function startOfDay(d: Date): Date {
  const n = new Date(d)
  n.setHours(0, 0, 0, 0)
  return n
}

type DayItem = {
  key: string
  label: string
  color: string
  onClick?: () => void
}

function EventDialog({
  initialDate,
  editing,
  onClose,
}: {
  initialDate: Date
  editing: CalendarEventRow | null
  onClose: () => void
}) {
  const { data: fields } = useFields()
  const { create, update, remove } = useEventMutations()
  const [form, setForm] = useState(() => {
    const base = editing ? new Date(editing.starts_at) : initialDate
    return {
      title: editing?.title ?? '',
      kind: (editing?.kind ?? 'general') as EventKind,
      all_day: editing?.all_day ?? true,
      date: ymd(base),
      time:
        editing && !editing.all_day
          ? new Date(editing.starts_at).toTimeString().slice(0, 5)
          : '09:00',
      rrule: editing?.rrule ?? null,
      field_id: editing?.field_id ?? '',
      notes_md: editing?.notes_md ?? '',
    }
  })

  const save = () => {
    const starts = form.all_day
      ? new Date(`${form.date}T00:00:00`)
      : new Date(`${form.date}T${form.time}:00`)
    const payload = {
      title: form.title,
      kind: form.kind,
      all_day: form.all_day,
      starts_at: starts.toISOString(),
      rrule: form.rrule,
      field_id: form.field_id || null,
      notes_md: form.notes_md || null,
    }
    if (editing) update.mutate({ id: editing.id, patch: payload }, { onSuccess: onClose })
    else create.mutate(payload, { onSuccess: onClose })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-4 sm:items-center">
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">
            {editing ? 'Edit event' : 'New event'}
          </h2>
          <button onClick={onClose} className="rounded-md p-1 text-gray-400 hover:bg-gray-100">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-3 space-y-3">
          <input
            autoFocus
            placeholder="Title"
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs text-gray-500">
              Date
              <DateField
                value={form.date}
                onChange={(v) => setForm((f) => ({ ...f, date: v }))}
                className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900"
              />
            </label>
            <label className="text-xs text-gray-500">
              {form.all_day ? 'All day' : 'Time'}
              {form.all_day ? (
                <div className="mt-1 flex items-center gap-2 py-1.5">
                  <input
                    type="checkbox"
                    checked={form.all_day}
                    onChange={(e) => setForm((f) => ({ ...f, all_day: e.target.checked }))}
                  />
                  <span className="text-sm text-gray-700">All day</span>
                </div>
              ) : (
                <div className="mt-1 flex items-center gap-2">
                  <input
                    type="time"
                    value={form.time}
                    onChange={(e) => setForm((f) => ({ ...f, time: e.target.value }))}
                    className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900"
                  />
                  <button
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, all_day: true }))}
                    className="text-xs text-gray-400 hover:text-gray-600"
                  >
                    all day
                  </button>
                </div>
              )}
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs text-gray-500">
              Kind
              <Select
                value={form.kind}
                ariaLabel="Kind"
                className="mt-1"
                onChange={(v) => setForm((f) => ({ ...f, kind: v as EventKind }))}
                options={EVENT_KINDS.map((k) => ({ value: k, label: k.replace('_', ' ') }))}
              />
            </label>
            <label className="text-xs text-gray-500">
              Repeats
              <Select
                value={form.rrule ?? ''}
                ariaLabel="Repeats"
                className="mt-1"
                onChange={(v) => setForm((f) => ({ ...f, rrule: v || null }))}
                options={RECURRENCE_OPTS.map((o) => ({ value: o.rrule ?? '', label: o.label }))}
              />
            </label>
          </div>
          <label className="block text-xs text-gray-500">
            Field (optional)
            <Select
              value={form.field_id}
              ariaLabel="Field"
              className="mt-1"
              onChange={(v) => setForm((f) => ({ ...f, field_id: v }))}
              options={[
                { value: '', label: '—' },
                ...(fields ?? []).map((fl) => ({ value: fl.id, label: fl.name })),
              ]}
            />
          </label>
        </div>

        <div className="mt-4 flex items-center justify-between">
          {editing ? (
            <button
              onClick={() => remove.mutate(editing.id, { onSuccess: onClose })}
              className="rounded-md border border-red-200 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50"
            >
              Delete
            </button>
          ) : (
            <span />
          )}
          <button
            onClick={save}
            disabled={!form.title || create.isPending || update.isPending}
            className="rounded-md bg-brand-700 px-4 py-1.5 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
          >
            {editing ? 'Save' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Subscribe the farm calendar into a personal Google/Apple/Outlook calendar.
 *
 * Each user has their own feed token, so the link is per-person and can be
 * revoked without affecting anyone else. This used to exist twice — a short
 * copy here and a fuller one in Settings — and the short one lacked the Google
 * button and the way to revoke a leaked link. This is now the only copy;
 * Settings links to it with ?subscribe=1.
 */
function CalendarSubscribe({ token }: { token: string }) {
  const regenerate = useRegenerateFeedToken()
  const [copied, setCopied] = useState(false)
  const url = feedUrlFor(token)

  return (
    <div className="mb-3 rounded-lg border border-gray-200 bg-white p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <a
          href={googleSubscribeUrl(url)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-md bg-brand-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-800"
        >
          Add to Google Calendar <ExternalLink className="h-3.5 w-3.5" />
        </a>
        <HelpNote
          title="Calendar sync"
          summary="Or subscribe to this address in Apple Calendar or Outlook. Private to you — don’t share."
        >
          <p>
            Add the farm calendar — events, task due dates and checklist runs — to the calendar you
            already use. It stays in sync; you don&apos;t re-add it. In Google Calendar by hand:
            Other calendars → From URL.
          </p>
          <p>
            Google refreshes subscribed calendars on its own schedule — usually within a day, not
            immediately. Something added this morning may not appear on your phone until tomorrow.
            The Calendar page in this app is always current.
          </p>
          <p>
            This address is private to you and needs no password — treat it like one. If you&apos;ve
            shared it by mistake, issue a new one; the old link stops working immediately and you
            re-add the calendar.
          </p>
        </HelpNote>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <input
          readOnly
          value={url}
          onFocus={(e) => e.target.select()}
          className="min-w-0 flex-1 rounded-md border border-gray-200 bg-gray-50 px-2 py-1 font-mono text-xs"
        />
        <button
          onClick={() => {
            void navigator.clipboard?.writeText(url)
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
          }}
          className="shrink-0 rounded-md border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button
          onClick={() => {
            if (
              window.confirm(
                'Issue a new calendar address? The current one stops working, and you will need to re-add the calendar anywhere you have subscribed.',
              )
            ) {
              regenerate.mutate()
            }
          }}
          disabled={regenerate.isPending}
          className="flex shrink-0 items-center gap-1.5 rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', regenerate.isPending && 'animate-spin')} />
          New address
        </button>
      </div>
      {regenerate.isError && (
        <p className="mt-1 text-[11px] text-red-600">{(regenerate.error as Error).message}</p>
      )}
    </div>
  )
}

export function CalendarPage() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { cropYear } = useCropYear()
  const [cursor, setCursor] = useState(() => startOfDay(new Date()))
  const [kindFilter, setKindFilter] = useState<EventKind | 'all'>('all')
  // Who is away, from the time-off calendar. Its own switch rather than a kind, because it is
  // read alongside everything else, not instead of it.
  const { data: timeOff } = useTimeOff()
  const syncTimeOff = useSyncTimeOff()
  const [awayTicked, setShowAway] = useState(
    () => localStorage.getItem('calendar_showAway') !== '0',
  )
  // A farm without a time-off calendar has nothing to show, so the layer and its box go.
  const timeOffOn = useFeature('time_off')
  const showAway = timeOffOn && awayTicked
  const [dialog, setDialog] = useState<{ date: Date; editing: CalendarEventRow | null } | null>(
    null,
  )
  // ?subscribe=1 opens the subscribe panel — Settings links here for it.
  const [search] = useSearchParams()
  const [showFeed, setShowFeed] = useState(() => search.get('subscribe') === '1')

  const { data: events } = useCalendarEvents()
  const { data: tasks } = useTasks()
  const { data: runs } = useRuns(cropYear)
  const { data: fields } = useFields()
  const { data: feedToken } = useFeedToken()
  const { data: equipment } = useEquipment()

  const fieldName = (id: string | null) => fields?.find((f) => f.id === id)?.name

  // Build the 6-week grid starting on the Sunday on/before the 1st.
  const gridStart = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
    const d = new Date(first)
    d.setDate(1 - first.getDay())
    return d
  }, [cursor])
  const days = useMemo(
    () =>
      Array.from(
        { length: 42 },
        (_, i) => new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i),
      ),
    [gridStart],
  )
  const gridEnd = days[41]

  // Bucket all items by yyyy-mm-dd.
  const byDay = useMemo(() => {
    const map = new Map<string, DayItem[]>()
    const add = (d: Date, item: DayItem) => {
      const k = ymd(d)
      const list = map.get(k) ?? []
      list.push(item)
      map.set(k, list)
    }
    ;(events ?? [])
      .filter((e) => (kindFilter === 'all' ? true : e.kind === kindFilter))
      .forEach((e) => {
        expandOccurrences(new Date(e.starts_at), e.rrule, gridStart, gridEnd).forEach((occ) =>
          add(occ, {
            key: `${e.id}-${ymd(occ)}`,
            label: e.title + (fieldName(e.field_id) ? ` · ${fieldName(e.field_id)}` : ''),
            color: KIND_COLORS[e.kind],
            onClick: () => setDialog({ date: occ, editing: e }),
          }),
        )
      })
    if (showAway) {
      for (const t of timeOff ?? []) {
        for (const day of daysOff(t)) {
          const on = new Date(`${day}T00:00:00`)
          if (on < gridStart || on > gridEnd) continue
          add(on, {
            key: `away-${t.uid}-${day}`,
            label: `⛱ ${timeOffLabel(t)}`,
            color: 'bg-rose-100 text-rose-900',
          })
        }
      }
    }
    if (kindFilter === 'all') {
      ;(tasks ?? [])
        .filter((t) => t.due_at && t.status === 'open' && !t.parent_task_id)
        .forEach((t) =>
          add(new Date(t.due_at!), {
            key: `task-${t.id}`,
            label: `☑ ${t.title}`,
            color: 'bg-white text-gray-700 ring-1 ring-gray-300',
            onClick: () => navigate(`/tasks/${t.id}`),
          }),
        )
      ;(runs ?? [])
        .filter((r) => r.due_at && r.status === 'open')
        .forEach((r) =>
          add(new Date(r.due_at!), {
            key: `run-${r.id}`,
            label: `✔ ${r.name}`,
            color: 'bg-white text-gray-700 ring-1 ring-gray-300',
            onClick: () => navigate(`/checklists/runs/${r.id}`),
          }),
        )
      // The day a warranty runs out, on the calendar rather than only on the
      // machine — because nobody opens the equipment list to find out that
      // something expires next month. Nothing recurs and nothing is expanded:
      // a warranty ends once.
      ;(equipment ?? [])
        .filter((e) => e.warranty_expires_on)
        .forEach((e) => {
          const on = new Date(`${e.warranty_expires_on}T00:00:00`)
          if (on < gridStart || on > gridEnd) return
          const w = warrantyStatus(e, gridStart)
          add(on, {
            key: `warranty-${e.id}`,
            // Named for the machine, because "warranty expires" on its own
            // sends you looking for which one.
            label: `⚠ ${e.name ?? 'Machine'} warranty ends`,
            color:
              w.state === 'expired'
                ? 'bg-gray-100 text-gray-500 ring-1 ring-gray-300'
                : 'bg-amber-100 text-amber-900',
            onClick: () => navigate(`/equipment/${e.id}`),
          })
        })
    }
    return map
  }, [
    events,
    tasks,
    runs,
    equipment,
    timeOff,
    showAway,
    kindFilter,
    gridStart,
    gridEnd,
    fields,
    navigate,
  ])

  const monthLabel = cursor.toLocaleDateString('en-CA', { month: 'long', year: 'numeric' })
  const today = ymd(new Date())

  return (
    <div className="p-4 md:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
            className="rounded-md border border-gray-200 p-1.5 hover:bg-gray-50"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <h1 className="min-w-40 text-center text-lg font-semibold text-gray-900">{monthLabel}</h1>
          <button
            onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
            className="rounded-md border border-gray-200 p-1.5 hover:bg-gray-50"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <button
            onClick={() => setCursor(startOfDay(new Date()))}
            className="rounded-md border border-gray-200 px-2.5 py-1.5 text-xs font-medium hover:bg-gray-50"
          >
            Today
          </button>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={kindFilter}
            ariaLabel="Filter"
            className="w-36"
            onChange={(v) => setKindFilter(v as EventKind | 'all')}
            options={[
              { value: 'all', label: 'All items' },
              ...EVENT_KINDS.map((k) => ({ value: k, label: k.replace('_', ' ') })),
            ]}
          />
          {timeOffOn && (
            <label
              className="flex items-center gap-1.5 text-xs text-gray-700"
              title="Approved time off from the time-off calendar, read daily"
            >
              <input
                type="checkbox"
                checked={showAway}
                onChange={(e) => {
                  setShowAway(e.target.checked)
                  localStorage.setItem('calendar_showAway', e.target.checked ? '1' : '0')
                }}
                className="h-3.5 w-3.5"
              />
              Time off
              {hasManagerAccess(profile?.role) && (
                <button
                  onClick={() => syncTimeOff.mutate()}
                  disabled={syncTimeOff.isPending}
                  title="Read the calendar now rather than at the daily run"
                  className="rounded border border-gray-200 px-1.5 py-0.5 text-[11px] text-gray-500 hover:bg-gray-50 disabled:opacity-50"
                >
                  {syncTimeOff.isPending ? 'reading…' : 'refresh'}
                </button>
              )}
            </label>
          )}
          <button
            onClick={() => setShowFeed((s) => !s)}
            className="flex items-center gap-1.5 rounded-md border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            <Link2 className="h-3.5 w-3.5" /> Subscribe
          </button>
          <button
            onClick={() => setDialog({ date: startOfDay(new Date()), editing: null })}
            className="flex items-center gap-1.5 rounded-md bg-brand-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-800"
          >
            <Plus className="h-3.5 w-3.5" /> Event
          </button>
        </div>
      </div>

      {showFeed && feedToken && <CalendarSubscribe token={feedToken} />}

      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-gray-200 bg-gray-200 text-xs">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
          <div key={d} className="bg-gray-50 px-2 py-1.5 text-center font-medium text-gray-500">
            {d}
          </div>
        ))}
        {days.map((d) => {
          const inMonth = d.getMonth() === cursor.getMonth()
          const items = byDay.get(ymd(d)) ?? []
          const isToday = ymd(d) === today
          return (
            <div
              key={ymd(d)}
              className={cn('min-h-20 bg-white p-1', !inMonth && 'bg-gray-50 text-gray-400')}
            >
              <div className="flex items-center justify-between">
                <button
                  onClick={() => setDialog({ date: startOfDay(d), editing: null })}
                  className={cn(
                    'flex h-5 w-5 items-center justify-center rounded-full text-xs hover:bg-brand-100',
                    isToday && 'bg-brand-700 font-semibold text-white hover:bg-brand-800',
                  )}
                >
                  {d.getDate()}
                </button>
              </div>
              <div className="mt-0.5 space-y-0.5">
                {items.slice(0, 4).map((it) => (
                  <button
                    key={it.key}
                    onClick={it.onClick}
                    title={it.label}
                    className={cn(
                      'block w-full truncate rounded px-1 py-0.5 text-left text-[11px] leading-tight',
                      it.color,
                    )}
                  >
                    {it.label}
                  </button>
                ))}
                {items.length > 4 && (
                  <span className="px-1 text-[10px] text-gray-400">+{items.length - 4} more</span>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <div className="mt-3 flex flex-wrap gap-3 text-xs text-gray-500">
        <span className="flex items-center gap-1">
          <CheckSquare className="h-3.5 w-3.5" /> tasks due
        </span>
        <span className="flex items-center gap-1">
          <ClipboardCheck className="h-3.5 w-3.5" /> checklist runs due
        </span>
        <span className="text-gray-400">
          {hasManagerAccess(profile?.role)
            ? 'You can edit any event.'
            : 'You can edit events you created.'}
        </span>
      </div>

      {dialog && (
        <EventDialog
          initialDate={dialog.date}
          editing={dialog.editing}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  )
}
