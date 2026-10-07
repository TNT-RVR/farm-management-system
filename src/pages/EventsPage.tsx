import { useMemo, useState } from 'react'
import { CalendarDays, ExternalLink, MapPin, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { Modal } from '@/components/Modal'
import { PillTabs } from '@/components/PillTabs'
import { Select } from '@/components/Select'
import {
  bySeries,
  dateRange,
  daysUntil,
  EVENT_CATEGORIES,
  isUpcoming,
  nextDeadline,
  priceToday,
  type NextEdition,
  reachOf,
  scoreEvent,
  type EventStatus,
  type FarmEvent,
} from '@/lib/events'
import {
  useDeleteEvent,
  useEvents,
  usePullEvents,
  useSaveEvent,
  useUpdateEvent,
} from '@/lib/events-data'
import type { Database } from '@/lib/database.types'
import { hasManagerAccess, useAuth } from '@/lib/auth'
import { fmtMoney } from '@/lib/applied'
import { cn } from '@/lib/utils'
import { rowClick } from '@/components/RecordEditor'

const STATUSES: { key: EventStatus; label: string }[] = [
  { key: 'watching', label: 'Watching' },
  { key: 'interested', label: 'Interested' },
  { key: 'registered', label: 'Registered' },
  { key: 'attending', label: 'Going' },
  { key: 'attended', label: 'Been' },
  { key: 'skipped', label: 'Skipped' },
]

const STATUS_STYLE: Record<EventStatus, string> = {
  watching: 'bg-gray-100 text-gray-600',
  interested: 'bg-blue-100 text-blue-800',
  registered: 'bg-green-100 text-green-800',
  attending: 'bg-green-600 text-white',
  attended: 'bg-gray-200 text-gray-500',
  skipped: 'bg-gray-100 text-gray-400',
}

const REACH_LABEL = {
  local: 'Day trip',
  province: 'In Alberta',
  prairies: 'Prairies',
  canada: 'Elsewhere in Canada',
  international: 'International',
} as const

const monthLabel = (m: string) => {
  if (m === 'unscheduled') return 'Dates not confirmed'
  const [y, mo] = m.split('-')
  const d = new Date(Number(y), Number(mo) - 1, 1)
  return Number.isNaN(d.getTime()) ? m : d.toLocaleString('en-CA', { month: 'long', year: 'numeric' })
}

function EventCard({
  series,
  canEdit,
  onStatus,
  onDelete,
  onOpen,
}: {
  series: NextEdition
  canEdit: boolean
  onStatus: (s: EventStatus) => void
  onDelete: () => void
  /** Open the event to change it. */
  onOpen: () => void
}) {
  const e = series.event as FarmEvent
  const [showPast, setShowPast] = useState(false)
  const deadline = nextDeadline(e)
  const price = priceToday(e)
  const days = daysUntil(e.starts_on)
  // Only where the shown edition has already run: then the date on the card is
  // history, and what a person wants is when the next one lands.
  const projected = series.estimatedOn
  const earlier = series.editions.filter((x) => x.id !== e.id)

  // The status picker's list opens in a portal, so its clicks reach the card
  // without passing through the picker; those are not a click on the card.
  const open = rowClick(onOpen)
  return (
    <li
      onClick={
        canEdit
          ? (ev) => {
              if ((ev.target as HTMLElement).closest('[role="listbox"], [role="option"]')) return
              open(ev)
            }
          : undefined
      }
      className={cn('rounded-lg border border-gray-200 bg-white p-3', canEdit && 'cursor-pointer hover:border-gray-300')}
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h3 className="font-medium text-gray-900">{e.name}</h3>
        <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', STATUS_STYLE[e.status])}>
          {STATUSES.find((s) => s.key === e.status)?.label ?? e.status}
        </span>
      </div>

      <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-gray-600">
        <span className="inline-flex items-center gap-1">
          <CalendarDays className="h-3.5 w-3.5 text-gray-400" />
          {projected ? (
            <span title={`Worked out from the last edition, which ran ${dateRange(e)}`}>
              around {dateRange({ starts_on: projected, ends_on: null })}
              <span className="text-gray-400"> · expected, not confirmed</span>
            </span>
          ) : (
            <>
              {dateRange(e)}
              {days != null && days >= 0 && days <= 60 && (
                <span className="text-gray-400">· in {days} day{days === 1 ? '' : 's'}</span>
              )}
            </>
          )}
        </span>
        <span className="inline-flex items-center gap-1">
          <MapPin className="h-3.5 w-3.5 text-gray-400" />
          {[e.city, e.region].filter(Boolean).join(', ') || e.country}
          <span className="text-gray-400">· {REACH_LABEL[reachOf(e)]}</span>
        </span>
        <span>
          {price == null ? (
            <span className="text-gray-400">Price unknown</span>
          ) : (
            <>
              {fmtMoney(price)} {e.currency}
              {e.early_bird_cost != null && price === e.early_bird_cost && (
                <span className="text-green-700"> early bird</span>
              )}
            </>
          )}
        </span>
      </p>

      {e.why_go && <p className="mt-1.5 text-sm text-gray-700">{e.why_go}</p>}

      {e.categories.length > 0 && (
        <p className="mt-1.5 flex flex-wrap gap-1">
          {e.categories.map((c) => (
            <span key={c} className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600">
              {c}
            </span>
          ))}
        </p>
      )}

      {deadline && (
        <p
          className={cn(
            'mt-1.5 text-xs font-medium',
            deadline.daysLeft <= 14 ? 'text-amber-800' : 'text-gray-500',
          )}
        >
          {deadline.kind === 'early_bird' ? 'Early-bird price ends' : 'Registration closes'}{' '}
          {deadline.on} — {deadline.daysLeft} day{deadline.daysLeft === 1 ? '' : 's'} left
        </p>
      )}

      {e.travel_notes && <p className="mt-1 text-xs text-gray-500">{e.travel_notes}</p>}

      {earlier.length > 0 && (
        <div className="mt-1.5">
          <button
            type="button"
            onClick={() => setShowPast((v) => !v)}
            className="text-xs text-gray-400 underline hover:text-gray-600"
          >
            {showPast ? 'Hide' : `${earlier.length} earlier edition${earlier.length === 1 ? '' : 's'}`}
          </button>
          {showPast && (
            <ul className="mt-1 space-y-0.5 text-xs text-gray-500">
              {earlier.map((x) => (
                <li key={x.id}>
                  {dateRange(x)}
                  {x.city && ` · ${x.city}`}
                  {priceToday(x) != null && ` · ${fmtMoney(priceToday(x) as number)}`}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {e.url && (
          <a
            href={e.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50"
          >
            Event page <ExternalLink className="h-3 w-3" />
          </a>
        )}
        {canEdit && (
          <>
            <Select
              value={e.status}
              ariaLabel={`Status for ${e.name}`}
              className="w-36"
              onChange={(s) => onStatus(s as EventStatus)}
              options={STATUSES.map((s) => ({ value: s.key, label: s.label }))}
            />
            <button
              onClick={() => {
                if (confirm(`Remove ${e.name}?`)) onDelete()
              }}
              title="Remove this event"
              className="ml-auto text-gray-300 hover:text-red-600"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </>
        )}
      </div>
    </li>
  )
}

/**
 * Conferences and trade shows.
 *
 * Sorted by when they happen rather than by how well they fit, because the
 * decision is always "what is coming up that we should book" and a list ordered
 * by relevance buries next month's deadline under a better event in June.
 */
export function EventsPage() {
  const { profile } = useAuth()
  const canEdit = hasManagerAccess(profile?.role)
  const { data: events, isLoading } = useEvents()
  const save = useSaveEvent()
  const update = useUpdateEvent()
  const del = useDeleteEvent()
  const pull = usePullEvents()

  const [when, setWhen] = useState<'upcoming' | 'all'>('upcoming')
  const [category, setCategory] = useState('')
  const [reach, setReach] = useState('')
  const [status, setStatus] = useState('')
  const [adding, setAdding] = useState(false)
  // An event opened to change it (Sam, 7 Oct 2026). Any event, not only the
  // hand-added ones: the weekly search never overwrites a row it already has
  // (it upserts ignoring duplicates), so a correction stays.
  const [editingId, setEditingId] = useState<string | null>(null)
  const editing = (events ?? []).find((e) => e.id === editingId) ?? null

  // Folded to one entry per conference first, so the filters act on the edition
  // actually being shown rather than on every year of it.
  const series = useMemo(() => {
    return bySeries(events ?? []).filter((s) => {
      const e = s.event
      if (!e) return false
      // "Upcoming" keeps anything still to come, plus anything whose next date
      // could be projected — otherwise a conference disappears for the months
      // between one edition finishing and the next being announced.
      if (when === 'upcoming' && !isUpcoming(e) && !s.estimatedOn) return false
      if (category && !e.categories.includes(category)) return false
      if (reach && reachOf(e) !== reach) return false
      if (status && e.status !== status) return false
      return true
    })
  }, [events, when, category, reach, status])

  // Grouped by the month it actually happens, projected date included.
  const groups = useMemo(() => {
    const out = new Map<string, NextEdition[]>()
    for (const s of series) {
      const shown = s.estimatedOn ?? s.event?.starts_on ?? null
      const key = shown?.slice(0, 7) ?? 'unscheduled'
      const list = out.get(key) ?? []
      list.push(s)
      out.set(key, list)
    }
    return [...out.entries()]
      .sort((a, b) => (a[0] === 'unscheduled' ? 1 : b[0] === 'unscheduled' ? -1 : a[0].localeCompare(b[0])))
      .map(([month, list]) => ({ month, series: list }))
  }, [series])

  // What is already committed to, so the cost of the year is visible.
  const committed = (events ?? [])
    .filter((e) => (e.status === 'registered' || e.status === 'attending') && isUpcoming(e))
    .reduce((sum, e) => sum + (priceToday(e) ?? 0), 0)

  return (
    <div className="p-4 md:p-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-1.5 text-lg font-semibold text-gray-900">
            <CalendarDays className="h-5 w-5 text-brand-700" /> Conferences &amp; shows
          </h1>
          <p className="text-xs text-gray-500">
            Ag and pollination events worth the trip, mostly prairie, scored against what we grow.
            {committed > 0 && ` ${fmtMoney(committed)} committed so far.`}
          </p>
        </div>
        {canEdit && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => pull.mutate()}
              disabled={pull.isPending}
              title="Search the web now for events worth attending"
              className="flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              <RefreshCw className={cn('h-4 w-4', pull.isPending && 'animate-spin')} /> Look for
              events
            </button>
            <button
              onClick={() => setAdding(true)}
              className="flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              <Plus className="h-4 w-4" /> Add an event
            </button>
          </div>
        )}
      </div>

      {pull.isError && (
        <p className="mb-2 text-xs text-red-600">{(pull.error as Error).message}</p>
      )}
      {pull.isSuccess && (
        <p className="mb-2 text-xs text-brand-900">
          Searching in the background — it takes a minute or two, and new events appear here on
          their own.
        </p>
      )}

      <PillTabs
        tabs={[
          { key: 'upcoming', label: 'Upcoming' },
          { key: 'all', label: 'Everything' },
        ]}
        value={when}
        onChange={setWhen}
        className="mb-3"
      />

      <div className="mb-3 flex flex-wrap gap-2">
        <Select
          value={category}
          ariaLabel="Subject"
          className="w-44"
          onChange={setCategory}
          options={[
            { value: '', label: 'Any subject' },
            ...EVENT_CATEGORIES.map((c) => ({ value: c, label: c })),
          ]}
        />
        <Select
          value={reach}
          ariaLabel="How far"
          className="w-48"
          onChange={setReach}
          options={[
            { value: '', label: 'Anywhere' },
            ...Object.entries(REACH_LABEL).map(([value, label]) => ({ value, label })),
          ]}
        />
        <Select
          value={status}
          ariaLabel="Status"
          className="w-40"
          onChange={setStatus}
          options={[
            { value: '', label: 'Any status' },
            ...STATUSES.map((s) => ({ value: s.key, label: s.label })),
          ]}
        />
      </div>

      {isLoading ? (
        <p className="py-12 text-center text-sm text-gray-400">Loading…</p>
      ) : groups.length === 0 ? (
        <p className="rounded-lg border border-gray-200 bg-white px-3 py-10 text-center text-sm text-gray-500">
          {events?.length
            ? 'Nothing matches those filters.'
            : 'No events yet. Add one, or let the weekly search fill the list in.'}
        </p>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <section key={g.month}>
              <h2 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">
                {monthLabel(g.month)}
              </h2>
              <ul className="space-y-2">
                {g.series.map((s) => (
                  <EventCard
                    key={s.event?.id}
                    series={s}
                    canEdit={canEdit}
                    onStatus={(next) =>
                      s.event && update.mutate({ id: s.event.id, status: next })
                    }
                    onDelete={() => s.event && del.mutate(s.event.id)}
                    onOpen={() => s.event && setEditingId(s.event.id)}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {editing && (
        <AddEventDialog
          existing={editing}
          busy={update.isPending || del.isPending}
          error={(update.error ?? del.error) as Error | null}
          onClose={() => setEditingId(null)}
          onSave={(e) => update.mutate({ id: editing.id, ...e }, { onSuccess: () => setEditingId(null) })}
          onDelete={() => del.mutate(editing.id, { onSuccess: () => setEditingId(null) })}
        />
      )}

      {adding && (
        <AddEventDialog
          busy={save.isPending}
          error={save.error as Error | null}
          onClose={() => setAdding(false)}
          onSave={(e) => save.mutate(e, { onSuccess: () => setAdding(false) })}
        />
      )}
    </div>
  )
}

/** Add an event, or change one (`existing`: more of its fields, and Delete). */
function AddEventDialog({
  existing,
  busy,
  error,
  onClose,
  onSave,
  onDelete,
}: {
  existing?: FarmEvent
  busy: boolean
  error: Error | null
  onClose: () => void
  onSave: (e: Database['public']['Tables']['events']['Insert']) => void
  onDelete?: () => void
}) {
  const str = (v: string | number | null | undefined) => (v == null ? '' : String(v))
  const [name, setName] = useState(existing?.name ?? '')
  const [url, setUrl] = useState(str(existing?.url))
  const [startsOn, setStartsOn] = useState(str(existing?.starts_on))
  const [endsOn, setEndsOn] = useState(str(existing?.ends_on))
  const [city, setCity] = useState(str(existing?.city))
  const [region, setRegion] = useState(existing ? str(existing.region) : 'Alberta')
  const [country, setCountry] = useState(existing?.country ?? 'Canada')
  const [cost, setCost] = useState(str(existing?.cost))
  const [categories, setCategories] = useState<string[]>(existing?.categories ?? [])
  const [whyGo, setWhyGo] = useState(str(existing?.why_go))
  // Only when changing one: the search fills these, and a new event rarely has them.
  const [earlyCost, setEarlyCost] = useState(str(existing?.early_bird_cost))
  const [earlyBy, setEarlyBy] = useState(str(existing?.early_bird_deadline))
  const [registerBy, setRegisterBy] = useState(str(existing?.registration_deadline))
  const [travel, setTravel] = useState(str(existing?.travel_notes))

  const toggle = (c: string) =>
    setCategories((list) => (list.includes(c) ? list.filter((x) => x !== c) : [...list, c]))

  return (
    <Modal title={existing ? existing.name : 'Add an event'} onClose={onClose}>
      <div className="space-y-2.5 text-sm">
        <label className="block">
          <span className="text-xs text-gray-500">Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-md border border-gray-300 px-2 py-1.5"
          />
        </label>
        <label className="block">
          <span className="text-xs text-gray-500">Website</span>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://"
            className="w-full rounded-md border border-gray-300 px-2 py-1.5"
          />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="text-xs text-gray-500">Starts</span>
            <input
              type="date"
              value={startsOn}
              onChange={(e) => setStartsOn(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-2 py-1.5"
            />
          </label>
          <label className="block">
            <span className="text-xs text-gray-500">Ends</span>
            <input
              type="date"
              value={endsOn}
              onChange={(e) => setEndsOn(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-2 py-1.5"
            />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <label className="block">
            <span className="text-xs text-gray-500">City</span>
            <input
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-2 py-1.5"
            />
          </label>
          <label className="block">
            <span className="text-xs text-gray-500">Province / state</span>
            <input
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-2 py-1.5"
            />
          </label>
          <label className="block">
            <span className="text-xs text-gray-500">Country</span>
            <input
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-2 py-1.5"
            />
          </label>
        </div>
        <label className="block">
          <span className="text-xs text-gray-500">Registration cost</span>
          <input
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            value={cost}
            onChange={(e) => setCost(e.target.value)}
            className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-right tabular-nums"
          />
        </label>
        {existing && (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <label className="block">
                <span className="text-xs text-gray-500">Early-bird cost</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={earlyCost}
                  onChange={(e) => setEarlyCost(e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-right tabular-nums"
                />
              </label>
              <label className="block">
                <span className="text-xs text-gray-500">Early bird ends</span>
                <input type="date" value={earlyBy} onChange={(e) => setEarlyBy(e.target.value)} className="w-full rounded-md border border-gray-300 px-2 py-1.5" />
              </label>
              <label className="block">
                <span className="text-xs text-gray-500">Registration closes</span>
                <input type="date" value={registerBy} onChange={(e) => setRegisterBy(e.target.value)} className="w-full rounded-md border border-gray-300 px-2 py-1.5" />
              </label>
            </div>
            <label className="block">
              <span className="text-xs text-gray-500">Travel notes</span>
              <input value={travel} onChange={(e) => setTravel(e.target.value)} className="w-full rounded-md border border-gray-300 px-2 py-1.5" />
            </label>
          </>
        )}
        <div>
          <span className="text-xs text-gray-500">Subjects</span>
          <div className="mt-1 flex flex-wrap gap-1">
            {EVENT_CATEGORIES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => toggle(c)}
                className={cn(
                  'rounded-full px-2 py-0.5 text-xs',
                  categories.includes(c)
                    ? 'bg-brand-700 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
                )}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
        <label className="block">
          <span className="text-xs text-gray-500">Why go</span>
          <textarea
            value={whyGo}
            onChange={(e) => setWhyGo(e.target.value)}
            rows={2}
            className="w-full rounded-md border border-gray-300 px-2 py-1.5"
          />
        </label>

        {error && <p className="text-xs text-red-600">{error.message}</p>}

        <div className="flex justify-end gap-2 pt-1">
          {onDelete && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (confirm(`Remove ${name || 'this event'}?`)) onDelete()
              }}
              className="mr-auto flex items-center gap-1 rounded-md border border-red-200 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" /> Delete
            </button>
          )}
          <button onClick={onClose} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm">
            Cancel
          </button>
          <button
            disabled={!name.trim() || busy}
            onClick={() =>
              onSave({
                ...(existing
                  ? {
                      early_bird_cost: earlyCost.trim() === '' ? null : Number(earlyCost),
                      early_bird_deadline: earlyBy || null,
                      registration_deadline: registerBy || null,
                      travel_notes: travel.trim() || null,
                    }
                  : {}),
                name: name.trim(),
                url: url.trim() || null,
                starts_on: startsOn || null,
                ends_on: endsOn || null,
                city: city.trim() || null,
                region: region.trim() || null,
                country: country.trim() || 'Canada',
                cost: cost.trim() === '' ? null : Number(cost),
                categories,
                why_go: whyGo.trim() || null,
                // Scored on the way in so the list has something to show before
                // anyone has judged it by hand; a changed one is scored again
                // only when what the score reads (subjects, place) changed.
                relevance:
                  existing &&
                  existing.categories.join() === categories.join() &&
                  (existing.city ?? '') === city.trim() &&
                  (existing.region ?? '') === region.trim() &&
                  existing.country === (country.trim() || 'Canada')
                    ? existing.relevance
                    : scoreEvent({
                        categories,
                        city: city.trim(),
                        region: region.trim(),
                        country: country.trim() || 'Canada',
                      }),
                // A changed event keeps where it came from.
                ...(existing ? {} : { source: 'manual' }),
              })
            }
            className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? 'Saving…' : existing ? 'Save changes' : 'Add event'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
