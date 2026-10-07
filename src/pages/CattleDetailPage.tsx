import { DateField } from '@/components/DateField'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Pencil, Plus, Trash2 } from 'lucide-react'
import { Select } from '@/components/Select'
import { RecordEditModal, type EditField } from '@/components/RecordEditor'
import { useRanches } from '@/lib/ranches'
import { hasManagerAccess, useAuth } from '@/lib/auth'
import { useUsers } from '@/lib/queries'
import {
  ageFromBirth,
  CATTLE_EVENT_TYPES,
  CATTLE_SEXES,
  CATTLE_STATUSES,
  useCattle,
  useCattleEventMutations,
  useCattleEvents,
  useCattleGroups,
  useCattleMutations,
  type CattleEventRow,
  type CattleEventType,
  type CattleSex,
  type CattleStatus,
} from '@/lib/cattle'

/** The fields a logged event is corrected through (managers; Sam, 7 Oct 2026). */
const EVENT_FIELDS: EditField[] = [
  { key: 'event_type', label: 'Event', kind: 'select', required: true, options: CATTLE_EVENT_TYPES.map((t) => ({ value: t, label: t.replace('_', ' ') })) },
  { key: 'event_date', label: 'Date', kind: 'date', required: true },
  { key: 'weight_lb', label: 'Weight (lb)', kind: 'number' },
  { key: 'product', label: 'Product', kind: 'text' },
  { key: 'dose', label: 'Dose', kind: 'text' },
  { key: 'location', label: 'Moved to', kind: 'text' },
  { key: 'notes', label: 'Notes', kind: 'textarea' },
]

export function CattleDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { profile } = useAuth()
  const isManager = hasManagerAccess(profile?.role)
  const { data: cattle } = useCattle()
  const { data: groups } = useCattleGroups()
  const { data: ranches } = useRanches()
  const { data: users } = useUsers()
  const { data: events } = useCattleEvents(id)
  const { update, remove } = useCattleMutations()
  const evMut = useCattleEventMutations()
  const [editEvent, setEditEvent] = useState<CattleEventRow | null>(null)

  const animal = cattle?.find((c) => c.id === id)
  const [ev, setEv] = useState({
    event_type: 'vaccination' as (typeof CATTLE_EVENT_TYPES)[number],
    event_date: new Date().toISOString().slice(0, 10),
    weight_lb: '',
    product: '',
    notes: '',
  })

  if (!animal) {
    return <div className="p-6 text-sm text-gray-500">{cattle ? 'Not found.' : 'Loading…'}</div>
  }

  const field = <K extends keyof typeof animal>(key: K, value: (typeof animal)[K]) => {
    if (!isManager) return
    update.mutate({ id: animal.id, patch: { [key]: value } })
  }
  const userName = (uid: string | null) => users?.find((u) => u.id === uid)?.full_name ?? 'system'

  return (
    <div className="mx-auto max-w-2xl p-4 md:p-6">
      {/* Back to the Herd page, where the animals are listed now. */}
      <Link to="/herd" className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800">
        <ArrowLeft className="h-4 w-4" /> Herd
      </Link>

      <div className="mt-3 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-bold text-gray-900">
          {animal.tag ? `#${animal.tag}` : 'Untagged'} {animal.name ? `· ${animal.name}` : ''}
        </h1>
        <span className="text-sm text-gray-500">
          {animal.sex ?? '—'} · {ageFromBirth(animal.birth_date)}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <label className="text-xs text-gray-500">
          Tag
          <input
            disabled={!isManager}
            defaultValue={animal.tag ?? ''}
            onBlur={(e) => e.target.value !== (animal.tag ?? '') && field('tag', e.target.value || null)}
            className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900"
          />
        </label>
        <label className="text-xs text-gray-500">
          Name
          <input
            disabled={!isManager}
            defaultValue={animal.name ?? ''}
            onBlur={(e) => e.target.value !== (animal.name ?? '') && field('name', e.target.value || null)}
            className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900"
          />
        </label>
        <label className="text-xs text-gray-500">
          Sex
          <Select
            disabled={!isManager}
            value={animal.sex ?? ''}
            ariaLabel="Sex"
            className="mt-1"
            onChange={(v) => field('sex', (v || null) as CattleSex | null)}
            options={[{ value: '', label: '—' }, ...CATTLE_SEXES.map((s) => ({ value: s, label: s }))]}
          />
        </label>
        <label className="text-xs text-gray-500">
          Breed
          <input
            disabled={!isManager}
            defaultValue={animal.breed ?? ''}
            onBlur={(e) => e.target.value !== (animal.breed ?? '') && field('breed', e.target.value || null)}
            className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900"
          />
        </label>
        <label className="text-xs text-gray-500">
          Birth date
          {/* DateField commits on selection rather than on blur — there is no
              blur to wait for when the value comes from a calendar tap. */}
          <DateField
            value={animal.birth_date ?? ''}
            onChange={(v) => v !== (animal.birth_date ?? '') && field('birth_date', v || null)}
            className="mt-1"
            ariaLabel="Birth date"
          />
        </label>
        <label className="text-xs text-gray-500">
          Group
          <Select
            disabled={!isManager}
            value={animal.group_id ?? ''}
            ariaLabel="Group"
            className="mt-1"
            placeholder="No group"
            onChange={(v) => field('group_id', v || null)}
            options={[
              { value: '', label: 'No group' },
              ...(groups ?? [])
                .filter((g) => !animal.ranch_id || !g.ranch_id || g.ranch_id === animal.ranch_id)
                .map((g) => ({ value: g.id, label: g.name })),
            ]}
          />
        </label>
        <label className="text-xs text-gray-500">
          Status
          <Select
            disabled={!isManager}
            value={animal.status}
            ariaLabel="Status"
            className="mt-1"
            onChange={(v) => field('status', v as CattleStatus)}
            options={CATTLE_STATUSES.map((s) => ({ value: s, label: s }))}
          />
        </label>
        <label className="text-xs text-gray-500">
          Ranch
          <Select
            disabled={!isManager}
            value={animal.ranch_id ?? ''}
            ariaLabel="Ranch"
            className="mt-1"
            onChange={(v) => field('ranch_id', v || null)}
            options={[{ value: '', label: '—' }, ...(ranches ?? []).map((r) => ({ value: r.id, label: r.name }))]}
          />
        </label>
        <label className="text-xs text-gray-500">
          Bought / arrived
          <DateField
            value={animal.acquired_date ?? ''}
            onChange={(v) => v !== (animal.acquired_date ?? '') && field('acquired_date', v || null)}
            className="mt-1"
            ariaLabel="Bought or arrived"
          />
        </label>
        <label className="text-xs text-gray-500">
          Dam tag
          <input
            disabled={!isManager}
            defaultValue={animal.dam_tag ?? ''}
            onBlur={(e) => e.target.value !== (animal.dam_tag ?? '') && field('dam_tag', e.target.value || null)}
            className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900"
          />
        </label>
        <label className="text-xs text-gray-500">
          Sire tag
          <input
            disabled={!isManager}
            defaultValue={animal.sire_tag ?? ''}
            onBlur={(e) => e.target.value !== (animal.sire_tag ?? '') && field('sire_tag', e.target.value || null)}
            className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900"
          />
        </label>
        <label className="col-span-2 text-xs text-gray-500 sm:col-span-3">
          Notes
          <textarea
            disabled={!isManager}
            rows={2}
            defaultValue={animal.notes_md ?? ''}
            onBlur={(e) => e.target.value !== (animal.notes_md ?? '') && field('notes_md', e.target.value || null)}
            className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900"
          />
        </label>
      </div>

      <div className="mt-4 rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-gray-700">Event history</h3>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            evMut.create.mutate(
              {
                cattle_id: animal.id,
                event_type: ev.event_type,
                event_date: ev.event_date,
                weight_lb: ev.weight_lb ? Number(ev.weight_lb) : null,
                product: ev.product || null,
                notes: ev.notes || null,
              },
              { onSuccess: () => setEv((x) => ({ ...x, weight_lb: '', product: '', notes: '' })) },
            )
          }}
          className="mt-2 flex flex-wrap items-center gap-2 border-b border-gray-100 pb-3"
        >
          <Select
            value={ev.event_type}
            size="sm"
            ariaLabel="Event type"
            onChange={(v) => setEv((x) => ({ ...x, event_type: v as typeof ev.event_type }))}
            options={CATTLE_EVENT_TYPES.map((t) => ({ value: t, label: t.replace('_', ' ') }))}
          />
          <DateField value={ev.event_date} onChange={(v) => setEv((x) => ({ ...x, event_date: v }))} className="rounded-md border border-gray-300 px-2 py-1 text-sm" />
          {ev.event_type === 'weight' && (
            <input
              type="number"
              placeholder="lb"
              value={ev.weight_lb}
              onChange={(e) => setEv((x) => ({ ...x, weight_lb: e.target.value }))}
              className="w-20 rounded-md border border-gray-300 px-2 py-1 text-sm"
            />
          )}
          {(ev.event_type === 'vaccination' || ev.event_type === 'treatment') && (
            <input
              placeholder="Product"
              value={ev.product}
              onChange={(e) => setEv((x) => ({ ...x, product: e.target.value }))}
              className="w-32 rounded-md border border-gray-300 px-2 py-1 text-sm"
            />
          )}
          <input
            placeholder="Notes"
            value={ev.notes}
            onChange={(e) => setEv((x) => ({ ...x, notes: e.target.value }))}
            className="min-w-0 flex-1 rounded-md border border-gray-300 px-2 py-1 text-sm"
          />
          <button
            type="submit"
            className="flex items-center gap-1 rounded-md bg-brand-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-brand-800"
          >
            <Plus className="h-3.5 w-3.5" /> Log
          </button>
        </form>
        <ul className="mt-2 divide-y divide-gray-100">
          {events?.map((e) => (
            <li key={e.id} className="flex items-baseline gap-2 py-1.5 text-sm">
              <span className="w-20 shrink-0 text-xs text-gray-400">{e.event_date}</span>
              <span className="flex-1">
                <span className="font-medium">{e.event_type.replace('_', ' ')}</span>
                {e.weight_lb ? <span className="text-gray-500"> · {e.weight_lb} lb</span> : ''}
                {e.product ? <span className="text-gray-500"> · {e.product}</span> : ''}
                {e.location ? <span className="text-gray-500"> → {e.location}</span> : ''}
                {e.notes ? <span className="text-gray-500"> · {e.notes}</span> : ''}
              </span>
              <span className="shrink-0 text-xs text-gray-400">{userName(e.created_by)}</span>
              {isManager && (
                <button
                  onClick={() => setEditEvent(e)}
                  className="shrink-0 rounded-md p-1 text-gray-300 hover:bg-gray-100 hover:text-gray-700"
                  aria-label="Edit event"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              )}
              {(isManager || e.created_by === profile?.id) && (
                <button
                  onClick={() => {
                    if (window.confirm(`Delete this ${e.event_type.replace('_', ' ')} on ${e.event_date}?`)) evMut.remove.mutate(e.id)
                  }}
                  className="shrink-0 rounded-md p-1 text-gray-300 hover:bg-red-50 hover:text-red-600"
                  aria-label="Delete event"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))}
          {events?.length === 0 && <li className="py-2 text-sm text-gray-400">No events yet.</li>}
        </ul>
      </div>

      {editEvent && (
        <RecordEditModal
          title="Edit event"
          fields={EVENT_FIELDS}
          row={editEvent}
          saving={evMut.update.isPending}
          error={evMut.update.error ? (evMut.update.error as Error).message : null}
          onClose={() => setEditEvent(null)}
          onDelete={() => evMut.remove.mutateAsync(editEvent.id)}
          deleteConfirm="Delete this event from the animal's history?"
          onSave={(patch) =>
            evMut.update.mutateAsync({
              id: editEvent.id,
              patch: {
                event_type: patch.event_type as CattleEventType,
                event_date: patch.event_date as string,
                weight_lb: patch.weight_lb as number | null,
                product: patch.product as string | null,
                dose: patch.dose as string | null,
                location: patch.location as string | null,
                notes: patch.notes as string | null,
              },
            })
          }
        />
      )}

      {isManager && (
        <button
          onClick={() => {
            if (confirm('Delete this animal and its event history?'))
              remove.mutate(animal.id, { onSuccess: () => navigate('/herd') })
          }}
          className="mt-4 flex items-center gap-1.5 rounded-md border border-red-200 bg-white px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50"
        >
          <Trash2 className="h-4 w-4" /> Delete animal
        </button>
      )}
    </div>
  )
}
