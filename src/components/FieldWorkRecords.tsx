import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, Clock, CloudOff, CopyCheck, PenLine, Plus, Tractor, Trash2, User, Wheat, Wind } from 'lucide-react'
import { SettingsButton } from '@/components/SettingsButton'
import { ConfirmDialog, Modal } from '@/components/Modal'
import { Select } from '@/components/Select'
import { DeleteButton, DetailList, EditButton, rowClick } from '@/components/RecordEditor'
import { FieldWorkForm } from '@/components/FieldWorkForm'
import { FieldFinishedForm } from '@/components/FieldFinishedForm'
import { useFinishSettings } from '@/lib/combine-finish-data'
import { settingsLine } from '@/lib/combine-setting-text'
import { hasManagerAccess, useAuth } from '@/lib/auth'
import { useEquipment } from '@/lib/equipment'
import { useCrops, useUsers } from '@/lib/queries'
import {
  discardQueued,
  useDeleteFieldWork,
  useDeleteWorkType,
  useFieldWorkPhotoUrls,
  useFieldWorkTypes,
  useNotDuplicate,
  useSaveWorkType,
  type OutboxItem,
} from '@/lib/field-work-data'
import { useFeedLotFedFrom, useFieldFeedLots, type FeedInventoryRow } from '@/lib/feed-inventory'
import { baleTypeLabel, ordinal } from '@/lib/baling'
import { usePartnerAccess } from '@/lib/partner-view'
import {
  fmtHours,
  machineHours,
  weatherLine,
  workHours,
  workTypeLabel,
  type DeerePassLite,
  type FieldWorkRecord,
  type WorkKind,
  type WorkWeather,
} from '@/lib/field-work'

const when = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleString('en-CA', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })
    : null
const timeOnly = (iso: string) => new Date(iso).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' })
const sameDay = (a: string, b: string) => new Date(a).toDateString() === new Date(b).toDateString()

/** "14 Oct 2026, 2:00 p.m. to 6:30 p.m." */
function workWhen(r: Pick<FieldWorkRecord, 'started_at' | 'finished_at'>): string {
  if (r.started_at && r.finished_at) {
    return `${when(r.started_at)} to ${sameDay(r.started_at, r.finished_at) ? timeOnly(r.finished_at) : when(r.finished_at)}`
  }
  return when(r.finished_at ?? r.started_at) ?? 'No date'
}

function useNames() {
  const { data: equipment } = useEquipment(false)
  const { data: users } = useUsers()
  const { data: crops } = useCrops()
  return useMemo(
    () => ({
      machine: (id: string) => {
        const e = equipment?.find((m) => m.id === id)
        return e ? (e.name ?? ([e.make, e.model].filter(Boolean).join(' ') || 'machine')) : 'a machine'
      },
      user: (id: string | null) => (id ? (users?.find((u) => u.id === id)?.full_name ?? 'someone') : 'someone'),
      crop: (id: string | null) => (id ? (crops?.find((c) => c.id === id)?.name ?? null) : null),
    }),
    [equipment, users, crops],
  )
}

/** "2 balers · 5 h (10 machine-hours)" */
function effortLine(r: FieldWorkRecord): string | null {
  const { hours } = workHours(r)
  const n = r.machines_at_once ?? 1
  const h = fmtHours(hours)
  if (n > 1) {
    const mh = fmtHours(machineHours(hours, n))
    return `${n} machines at once${h ? ` · ${h}` : ''}${mh && hours ? ` (${mh} of machine time)` : ''}`
  }
  return h
}

/** Where a baling record's bales went: the feed supply entry, on Feed records. */
const feedLotLink = (lot: FeedInventoryRow) => `/feed?tab=records&ranch=${lot.ranch_id}&lot=${lot.id}`

const baleWords = (n: number, unit: string) => {
  const word = baleTypeLabel(unit)
  return `${n.toLocaleString('en-CA')} ${word === 'bale' ? 'bale' : `${word} bale`}${n === 1 ? '' : 's'}`
}

/** "Added to feed supply: 420 round bales", linking to the entry. */
function FeedLotLine({ lot }: { lot: FeedInventoryRow }) {
  return (
    <Link to={feedLotLink(lot)} className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline">
      <Wheat className="h-3.5 w-3.5" /> Added to feed supply: {baleWords(Number(lot.quantity), lot.unit)}
    </Link>
  )
}

const KIND_LABEL: Record<WorkKind, string> = {
  seeding: 'seeding',
  harvest: 'harvest',
  tillage: 'tillage',
  application: 'application',
}

/** One hand-entered job in the field's work list. Opens to its detail. */
export function HandWorkCard({
  rec,
  fieldAcres,
  duplicates,
}: {
  rec: FieldWorkRecord
  fieldAcres: number | null
  /** Deere passes that look like the same job. */
  duplicates: DeerePassLite[]
}) {
  const { profile } = useAuth()
  const names = useNames()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const canEdit = hasManagerAccess(profile?.role) || (!!profile && rec.created_by === profile.id)
  const notDup = useNotDuplicate()
  const { data: lots } = useFieldFeedLots(rec.field_id)
  const lot = lots?.[rec.id] ?? null
  const wx = weatherLine(rec.weather as unknown as WorkWeather | null)
  const effort = effortLine(rec)
  const crop = names.crop(rec.crop_id)
  const people = [...rec.operator_ids.map((id) => names.user(id)), ...(rec.other_people ? [rec.other_people] : [])]
  // A finish is the end of the same harvest Deere logged, not a second job.
  const dups = rec.field_finished ? [] : duplicates

  return (
    <li className="cursor-pointer rounded-lg border border-gray-200 bg-white p-4 hover:border-gray-300" onClick={rowClick(() => setOpen(true))}>
      <div className="flex flex-wrap items-center gap-2">
        {rec.field_finished ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-800">
            <CheckCircle2 className="h-3.5 w-3.5" /> {workTypeLabel(rec)}
          </span>
        ) : (
          <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-800">{workTypeLabel(rec)}</span>
        )}
        <span className="text-sm font-medium text-gray-900">{workWhen(rec)}</span>
        {effort && (
          <span className="flex items-center gap-1 text-xs text-gray-600">
            <Clock className="h-3.5 w-3.5" /> {effort}
          </span>
        )}
        {crop && <span className="ml-auto text-xs text-gray-500">{crop.toLowerCase()}</span>}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600">
        {rec.acres != null && <span>{Number(rec.acres).toLocaleString('en-CA', { maximumFractionDigits: 1 })} ac</span>}
        {rec.amount != null && (
          <span>
            {Number(rec.amount).toLocaleString('en-CA', { maximumFractionDigits: 2 })} {rec.amount_unit ?? ''}
          </span>
        )}
        {rec.machine_ids.length > 0 && (
          <span className="flex items-center gap-1">
            <Tractor className="h-3.5 w-3.5" /> {rec.machine_ids.map(names.machine).join(', ')}
          </span>
        )}
        {people.length > 0 && (
          <span className="flex items-center gap-1">
            <User className="h-3.5 w-3.5" /> {people.join(', ')}
          </span>
        )}
      </div>
      {lot && (
        <p className="mt-1.5">
          <FeedLotLine lot={lot} />
        </p>
      )}
      {wx && (
        <p className="mt-1.5 flex items-center gap-1 text-xs text-gray-500" title={rec.weather_source ?? undefined}>
          <Wind className="h-3.5 w-3.5" /> {wx}
        </p>
      )}
      {dups.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900">
          <CopyCheck className="h-3.5 w-3.5" />
          <span>
            Deere also has a {KIND_LABEL[rec.counts_as!] ?? 'pass'} on this field at this time ({dups.map((d) => when(d.started_at)).join(', ')}). The same job?
          </span>
          {canEdit &&
            dups.map((d) => (
              <button
                key={d.id}
                type="button"
                disabled={notDup.isPending}
                onClick={() => notDup.mutate({ rec, opId: d.id })}
                className="rounded border border-amber-300 bg-white px-2 py-0.5 text-amber-900 hover:bg-amber-100"
              >
                Different job{dups.length > 1 ? ` (${when(d.started_at)})` : ''}
              </button>
            ))}
        </div>
      )}
      <p className="mt-2 flex items-center gap-1 border-t border-gray-100 pt-2 text-[11px] text-gray-500">
        <PenLine className="h-3 w-3" /> Entered by hand by {names.user(rec.created_by)}
      </p>

      {open && !editing && (
        <HandWorkDetail
          rec={rec}
          lot={lot}
          canEdit={canEdit}
          onClose={() => setOpen(false)}
          onEdit={() => setEditing(true)}
        />
      )}
      {editing && rec.field_finished && (
        <FieldFinishedForm
          record={rec}
          onClose={() => {
            setEditing(false)
            setOpen(false)
          }}
        />
      )}
      {editing && !rec.field_finished && (
        <FieldWorkForm
          fieldId={rec.field_id}
          fieldAcres={fieldAcres}
          record={rec}
          onClose={() => {
            setEditing(false)
            setOpen(false)
          }}
        />
      )}
    </li>
  )
}

function HandWorkDetail({
  rec,
  lot,
  canEdit,
  onClose,
  onEdit,
}: {
  rec: FieldWorkRecord
  /** The feed supply entry this record's bales made, if any. */
  lot: FeedInventoryRow | null
  canEdit: boolean
  onClose: () => void
  onEdit: () => void
}) {
  const names = useNames()
  const del = useDeleteFieldWork()
  const [asking, setAsking] = useState(false)
  const [removeFeed, setRemoveFeed] = useState(true)
  const { data: fedFrom, isLoading: checkingFed } = useFeedLotFedFrom(asking && lot ? lot.id : null)
  const { data: urls } = useFieldWorkPhotoUrls(rec.photo_paths)
  const took = workHours(rec)
  const wx = rec.weather as unknown as WorkWeather | null
  const { data: ran } = useFinishSettings(rec.field_finished ? rec.id : null)
  return (
    <Modal title={workTypeLabel(rec)} onClose={onClose}>
      <DetailList
        rows={[
          ['When', workWhen(rec)],
          ['Time it took', fmtHours(took.hours) ? `${fmtHours(took.hours)}${took.from === 'times' ? ' (start to finish)' : ''}` : null],
          ['Machines at once', rec.machines_at_once && rec.machines_at_once > 1 ? String(rec.machines_at_once) : null],
          ['Crop', names.crop(rec.crop_id)],
          ['Acres', rec.acres != null ? Number(rec.acres).toLocaleString('en-CA', { maximumFractionDigits: 1 }) : null],
          ['Amount', rec.amount != null ? `${Number(rec.amount).toLocaleString('en-CA')} ${rec.amount_unit ?? ''}` : null],
          ['Bale size', rec.bale_type ? baleTypeLabel(rec.bale_type) : null],
          ['Cut', rec.hay_cut ? `${ordinal(rec.hay_cut)} cut` : null],
          ['Feed supply', lot ? <FeedLotLine lot={lot} /> : null],
          ['Stacked at', rec.feed_storage],
          ['Machines', rec.machine_ids.map(names.machine).join(', ')],
          ['Who', [...rec.operator_ids.map((id) => names.user(id)), ...(rec.other_people ? [rec.other_people] : [])].join(', ')],
          ...(rec.field_finished
            ? (ran ?? []).map((r): [string, string | null] => [
                `Settings${(ran?.length ?? 0) > 1 && r.equipment_id ? ` (${names.machine(r.equipment_id)})` : ''}`,
                settingsLine(r) || null,
              ])
            : []),
          ['Weather', weatherLine(wx) ? `${weatherLine(wx)}${wx && wx.hours > 1 ? ` (average of ${wx.hours} hours)` : ''}` : 'Not yet — filled in when there is signal'],
          ['Weather from', rec.weather_source],
          ['Notes', rec.notes],
          ['Entered', `by ${names.user(rec.created_by)}, ${when(rec.entered_at)}`],
        ]}
      />
      {(urls?.length ?? 0) > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {urls!.map((u) => (
            <a key={u} href={u} target="_blank" rel="noopener noreferrer">
              <img src={u} alt="" className="h-24 w-24 rounded object-cover" />
            </a>
          ))}
        </div>
      )}
      {del.isError && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{(del.error as Error).message}</p>}
      {canEdit && (
        <div className="mt-4 flex items-center justify-between gap-2">
          {lot ? (
            <button
              type="button"
              disabled={del.isPending}
              onClick={() => setAsking(true)}
              className="flex items-center gap-1 rounded-md border border-red-200 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </button>
          ) : (
            <DeleteButton
              confirm="Delete this work record? It goes from the field's work list and its photos with it."
              disabled={del.isPending}
              onDelete={() => del.mutate({ rec }, { onSuccess: onClose })}
            />
          )}
          <EditButton onClick={onEdit} />
        </div>
      )}
      {asking && lot && (
        <ConfirmDialog
          title="Delete"
          busy={del.isPending || checkingFed}
          error={del.error ? (del.error as Error).message : null}
          onClose={() => setAsking(false)}
          onConfirm={() => del.mutate({ rec, removeFeed: !fedFrom && removeFeed }, { onSuccess: onClose })}
          message={
            <>
              <p>Delete this work record? It goes from the field&apos;s work list and its photos with it.</p>
              {checkingFed ? (
                <p className="mt-2 text-xs text-gray-400">Checking the feed sheets…</p>
              ) : fedFrom ? (
                <p className="mt-2 rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
                  Its {baleWords(Number(lot.quantity), lot.unit)} stay in the feed supply: the feed sheets have fed this feed since they were put up. They are only unlinked from this record.
                </p>
              ) : (
                <label className="mt-2 flex items-center gap-2 text-sm text-gray-700">
                  <input type="checkbox" checked={removeFeed} onChange={(e) => setRemoveFeed(e.target.checked)} />
                  Also take its {baleWords(Number(lot.quantity), lot.unit)} off the feed supply
                </label>
              )}
            </>
          }
        />
      )}
    </Modal>
  )
}

/** A record saved with no signal, still on this phone. */
export function QueuedWorkCard({ item }: { item: OutboxItem }) {
  const r = item.row
  return (
    <li className="rounded-lg border border-dashed border-amber-300 bg-amber-50/50 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-800">
          {workTypeLabel({ work_type: r.work_type, work_type_other: r.work_type_other ?? null })}
        </span>
        <span className="text-sm font-medium text-gray-900">{workWhen({ started_at: r.started_at ?? null, finished_at: r.finished_at ?? null })}</span>
        <span className="ml-auto flex items-center gap-1 text-xs font-medium text-amber-800">
          <CloudOff className="h-3.5 w-3.5" /> Waiting for signal
        </span>
      </div>
      {r.feed_type_id && r.amount != null && Number(r.amount) > 0 && (
        <p className="mt-1.5 flex items-center gap-1 text-xs text-gray-600">
          <Wheat className="h-3.5 w-3.5" /> {baleWords(Number(r.amount), r.bale_type ?? 'round')} go into the feed supply when this is sent
        </p>
      )}
      {item.lastError && (
        <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-red-700">
          Not saved: {item.lastError}
          <button type="button" onClick={() => void discardQueued(r.id!)} className="rounded border border-red-200 px-2 py-0.5 hover:bg-red-50">
            Discard
          </button>
        </p>
      )}
    </li>
  )
}

/** The Record work button, and the managers' list of extra work types beside it. */
export function RecordWorkBar({ fieldId, fieldAcres, onSaved }: { fieldId: string; fieldAcres: number | null; onSaved?: (r: { queued: boolean }) => void }) {
  // A crop-share partner records only on a field listed for him (lib/partner-view.ts).
  const access = usePartnerAccess()
  const { profile } = useAuth()
  const [adding, setAdding] = useState(false)
  const [types, setTypes] = useState(false)
  const [finishing, setFinishing] = useState(false)
  if (!access.canRecordOn(fieldId)) return null
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => setAdding(true)}
        className="flex items-center gap-1.5 rounded-md bg-brand-700 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-800"
      >
        <Plus className="h-4 w-4" /> Record work
      </button>
      <button
        type="button"
        onClick={() => setFinishing(true)}
        className="flex items-center gap-1.5 rounded-md border border-brand-600 px-3 py-2 text-sm font-semibold text-brand-800 hover:bg-brand-50"
      >
        <CheckCircle2 className="h-4 w-4" /> Field finished
      </button>
      {hasManagerAccess(profile?.role) && (
        <SettingsButton label="Work types" onClick={() => setTypes(true)} />
      )}
      {adding && <FieldWorkForm fieldId={fieldId} fieldAcres={fieldAcres} onClose={() => setAdding(false)} onSaved={onSaved} />}
      {types && <WorkTypesEditor onClose={() => setTypes(false)} />}
      {finishing && <FieldFinishedForm fieldId={fieldId} onClose={() => setFinishing(false)} onSaved={onSaved} />}
    </div>
  )
}

const COUNTS_AS: { value: string; label: string }[] = [
  { value: '', label: 'Nothing in Deere' },
  { value: 'seeding', label: 'Deere seeding' },
  { value: 'harvest', label: 'Deere harvest' },
  { value: 'tillage', label: 'Deere tillage' },
  { value: 'application', label: 'Deere application' },
]

/** Managers add work types to the built-in list. Removing one keeps old records' names. */
function WorkTypesEditor({ onClose }: { onClose: () => void }) {
  const { data } = useFieldWorkTypes()
  const add = useSaveWorkType()
  const remove = useDeleteWorkType()
  const [label, setLabel] = useState('')
  const [countsAs, setCountsAs] = useState('')
  const active = (data ?? []).filter((t) => t.active)
  const err = (add.error ?? remove.error) as Error | null
  return (
    <Modal title="Work types" onClose={onClose}>
      {active.length === 0 ? (
        <p className="text-xs text-gray-500">No types added yet. The built-in list is always there.</p>
      ) : (
        <ul className="divide-y divide-gray-100 text-sm">
          {active.map((t) => (
            <li key={t.id} className="flex items-center gap-2 py-1.5">
              <span className="flex-1 text-gray-800">{t.label}</span>
              {t.counts_as && <span className="text-xs text-gray-500">matches Deere {t.counts_as}</span>}
              <DeleteButton label="Remove" confirm={`Remove "${t.label}" from the list? Records already made keep the name.`} onDelete={() => remove.mutate(t.id)} />
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="min-w-0 flex-1 basis-40 text-sm">
          <span className="mb-0.5 block text-xs text-gray-500">New type</span>
          <input value={label} onChange={(e) => setLabel(e.target.value)} className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm" placeholder="e.g. Root picking" />
        </label>
        <div className="basis-40">
          <span className="mb-0.5 block text-xs text-gray-500">Same as</span>
          <Select value={countsAs} onChange={setCountsAs} options={COUNTS_AS} ariaLabel="Same as" className="w-full" />
        </div>
        <button
          type="button"
          disabled={!label.trim() || add.isPending}
          onClick={() =>
            add.mutate(
              { label, counts_as: (countsAs || null) as FieldWorkRecord['counts_as'] },
              {
                onSuccess: () => {
                  setLabel('')
                  setCountsAs('')
                },
              },
            )
          }
          className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          Add
        </button>
      </div>
      {err && <p className="mt-2 text-xs text-red-600">{err.message}</p>}
    </Modal>
  )
}
