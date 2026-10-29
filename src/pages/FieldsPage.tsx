import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Archive, ArchiveRestore, FileUp, Pencil, Plus, Trash2 } from 'lucide-react'
import { DataTable, type DataTableColumn } from '@/components/DataTable'
import { ConfirmDialog, Modal } from '@/components/Modal'
import { hasManagerAccess, useAuth } from '@/lib/auth'
import { useCropYear } from '@/lib/crop-year'
import {
  boundariesForYear,
  findSimilarFields,
  useAllBoundaries,
  useAllFields,
  useCropHistoryByYear,
  useCropPlans,
  useCrops,
  useFieldMutations,
  useHailEvents,
  type FieldRow,
} from '@/lib/queries'
import { useFieldSeasons } from '@/lib/irrigation'
import { cn } from '@/lib/utils'
import { HelpNote } from '@/components/HelpNote'
import { useAllowJdField, useDismissedJdFields } from '@/lib/jd-dismissed'
import { withDisplay } from '@/lib/reports/columns'
import { fieldListColumns, fieldListRows, fieldSeasonMap, type FieldListRow } from '@/lib/reports/lists'
import { useSeasonProgress, progressByField } from '@/lib/field-progress-data'
import { fieldState, hailLabel, hailSummary, FIELD_STATE_CLASS, type HailSummary } from '@/lib/field-state'
import { HailEventDialog } from '@/components/HailEventDialog'
import { CARD_HEAD } from '@/lib/table-style'
import { usePartnerAccess } from '@/lib/partner-view'

type Row = FieldListRow

export function FieldsPage() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { cropYear } = useCropYear()
  const { data: fields, isLoading } = useAllFields()
  const { data: allBoundaries } = useAllBoundaries()
  const { data: plans } = useCropPlans(cropYear)
  const { data: history } = useCropHistoryByYear(cropYear)
  const { data: crops } = useCrops()
  const { create, setArchived, remove } = useFieldMutations()
  const { data: hailEvents } = useHailEvents(cropYear)
  const { data: seasons } = useFieldSeasons(cropYear)
  const { data: progress } = useSeasonProgress(cropYear)
  const isManager = hasManagerAccess(profile?.role)
  // A crop-share partner adds and keeps his company's own fields; ours on his
  // list are his to record on, not to set up (lib/partner-view.ts).
  const { partner, isOwnField } = usePartnerAccess()
  const canAdd = isManager || partner

  // The year's hail per field: a count and the worst assessed loss, which is
  // what the chip says. A field can hail twice.
  const hailByField = useMemo(() => {
    const m = new Map<string, HailSummary>()
    const byField = new Map<string, typeof hailEvents>()
    for (const h of hailEvents ?? []) {
      const list = byField.get(h.field_id) ?? []
      list.push(h)
      byField.set(h.field_id, list)
    }
    for (const [id, list] of byField) {
      const s = hailSummary(list ?? [])
      if (s) m.set(id, s)
    }
    return m
  }, [hailEvents])

  // One season row per field for this year; the whole-field row is the one
  // the season's watering belongs on.
  const seasonByField = useMemo(() => fieldSeasonMap(seasons ?? []), [seasons])
  const progressBy = useMemo(() => progressByField(progress), [progress])

  // Where each field is in the season. Derived, not ticked: see lib/field-state.ts.
  const stateByField = useMemo(() => {
    const m = new Map<string, ReturnType<typeof fieldState>>()
    for (const [id, p] of progressBy) {
      const season = seasonByField.get(id)
      m.set(
        id,
        fieldState({
          cropName: p.cropName,
          harvestFinished: p.harvestFinished,
          harvestStarted: p.harvestStarted,
          lastLoadOn: p.lastLoadOn,
          wateringDoneAt: season?.irrigation_done_at ?? null,
          wateringDoneSource: season?.irrigation_done_source ?? null,
          wateringDoneNote: season?.irrigation_done_note ?? null,
          irrigated: Boolean(season),
        }),
      )
    }
    return m
  }, [progressBy, seasonByField])

  const stateOf = (id: string) => stateByField.get(id) ?? fieldState({ cropName: null })

  const [tab, setTab] = useState<'active' | 'archive'>('active')
  const [adding, setAdding] = useState(false)
  const [deleting, setDeleting] = useState<FieldRow | null>(null)
  const [hailFor, setHailFor] = useState<{ id: string; name: string } | null>(null)

  const buildRows = (list: FieldRow[]): Row[] =>
    fieldListRows(list, {
      boundaries: allBoundaries ? boundariesForYear(allBoundaries, cropYear) : [],
      crops: crops ?? [],
      plans: plans ?? [],
      history: history ?? [],
    })

  const activeFields = useMemo(() => (fields ?? []).filter((f) => f.active), [fields])
  const archivedFields = useMemo(() => (fields ?? []).filter((f) => !f.active), [fields])
  const rows = useMemo(
    () => buildRows(tab === 'active' ? activeFields : archivedFields),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tab, activeFields, archivedFields, allBoundaries, cropYear, plans, history, crops],
  )

  // The columns the CSV carries are shared with the Reports page; only what is
  // drawn on screen is added here.
  const columns: DataTableColumn<Row>[] = withDisplay(
    fieldListColumns({
      cropYear,
      state: stateOf,
      hail: (id) => {
        const s = hailByField.get(id)
        return s ? hailLabel(s) : null
      },
    }),
    {
      name: { className: 'font-medium' },
      map_acres: {
        // A dash already says "no boundary"; the separate Boundary column said it twice.
        render: (r) => (r.map_acres != null ? r.map_acres.toFixed(1) : '—'),
        className: 'text-right tabular-nums',
      },
      state: {
        render: (r) => {
          const s = stateOf(r.id)
          if (s.key === 'no-crop') return <span className="text-xs text-gray-300">—</span>
          return (
            <span
              className={cn('inline-block rounded px-1.5 py-0.5 text-xs font-medium', FIELD_STATE_CLASS[s.key])}
              title={s.why}
            >
              {s.label}
            </span>
          )
        },
      },
      hail: {
        render: (r) => {
          const s = hailByField.get(r.id)
          return (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setHailFor({ id: r.id, name: r.name })
              }}
              title={s ? `Hail on ${r.name} in ${cropYear}` : `Record hail on ${r.name}`}
              aria-label={s ? `Hail on ${r.name}: ${hailLabel(s)}` : `Record hail on ${r.name}`}
              className={cn(
                'relative rounded px-1.5 py-0.5 text-xs after:absolute after:-inset-2 after:content-[\'\'] sm:after:content-none',
                s ? 'bg-red-50 font-medium text-red-700 hover:bg-red-100' : 'text-gray-300 hover:bg-gray-100 hover:text-gray-600',
              )}
            >
              {s ? hailLabel(s) : 'none'}
            </button>
          )
        },
      },
    },
  )
  if (partner) {
    columns.splice(1, 0, {
      key: 'whose',
      label: 'Whose',
      value: (r) => (isOwnField(r.id) ? 'Yours' : 'Shared'),
    })
  }
  if (canAdd) {
    columns.push({
      key: 'actions',
      label: '',
      value: () => '',
      className: 'text-right',
      render: (r) => partner && !isOwnField(r.id) ? null : (
        <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => navigate(`/fields/${r.id}`)}
            className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            title="Edit field"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            onClick={() => setArchived.mutate({ id: r.id, archived: r.active })}
            className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            title={r.active ? 'Archive field' : 'Restore field'}
          >
            {r.active ? <Archive className="h-4 w-4" /> : <ArchiveRestore className="h-4 w-4" />}
          </button>
          {!r.active && (
            <button
              onClick={() => setDeleting(r)}
              className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
              title="Permanently delete"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      ),
    })
  }

  // Borrowed off the first field when there is one. A new farm has none, so
  // the create mutation falls back to ensure_farm() — the modal used to need
  // this id just to open, which left "Add field" silently dead on an empty farm.
  const farmId = fields?.[0]?.farm_id ?? null

  return (
    <div className="p-4 md:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold text-gray-900">Fields</h1>
          <div className="flex rounded-md border border-gray-200 bg-white p-0.5 text-sm">
            {(['active', 'archive'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={cn(
                  'rounded px-3 py-1 capitalize',
                  tab === t ? 'bg-brand-700 font-semibold text-white' : 'text-gray-600 hover:bg-gray-50',
                )}
              >
                {t} ({t === 'active' ? activeFields.length : archivedFields.length})
              </button>
            ))}
          </div>
        </div>
        {canAdd && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setAdding(true)}
              className="flex items-center gap-1.5 rounded-md bg-brand-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-800"
            >
              <Plus className="h-3.5 w-3.5" /> Add field
            </button>
            {isManager && <Link
              to="/fields/import"
              className="flex items-center gap-1.5 rounded-md border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              <FileUp className="h-3.5 w-3.5" /> Import boundaries
            </Link>}
          </div>
        )}
      </div>

      {isLoading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : (
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(r) => r.id}
          exportFilename={`fields-${tab}-${cropYear}`}
          onRowClick={(r) => navigate(`/fields/${r.id}`)}
          emptyMessage={tab === 'archive' ? 'No archived fields.' : 'No fields yet.'}
        />
      )}

      {tab === 'archive' && <DismissedJdFields />}

      {hailFor && (
        <HailEventDialog
          fieldId={hailFor.id}
          fieldName={hailFor.name}
          cropYear={cropYear}
          canEdit={isManager}
          onClose={() => setHailFor(null)}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title={`Delete ${deleting.name}?`}
          message={
            <>
              Permanently delete <b>{deleting.name}</b>? This removes the field and{' '}
              <b>all of its data</b> — boundary, crop history, irrigation setup, soil profile and
              pivot. This can’t be undone. (To keep it for later, leave it archived instead.)
              {deleting.jd_field_id && (
                <>
                  {' '}
                  John Deere will not bring it back either; it is listed under the archive tab if
                  you change your mind.
                </>
              )}
            </>
          }
          confirmLabel="Delete permanently"
          busy={remove.isPending}
          error={remove.isError ? (remove.error as Error).message : null}
          onClose={() => {
            remove.reset()
            setDeleting(null)
          }}
          onConfirm={() => remove.mutate(deleting.id, { onSuccess: () => setDeleting(null) })}
        />
      )}

      {adding && (
        <AddFieldModal
          archived={archivedFields}
          onClose={() => {
            create.reset()
            setAdding(false)
          }}
          onRestore={(id) => setArchived.mutate({ id, archived: false }, { onSuccess: () => { setAdding(false); setTab('active') } })}
          onCreate={(name, legal) =>
            create.mutate(
              { farm_id: farmId, name, legal_land_description: legal },
              { onSuccess: () => setAdding(false) },
            )
          }
          saving={create.isPending || setArchived.isPending}
          error={create.error ? (create.error as Error).message : null}
        />
      )}
    </div>
  )
}

function AddFieldModal({
  archived,
  onClose,
  onRestore,
  onCreate,
  saving,
  error,
}: {
  archived: FieldRow[]
  onClose: () => void
  onRestore: (id: string) => void
  onCreate: (name: string, legal: string | null) => void
  saving: boolean
  error?: string | null
}) {
  const [name, setName] = useState('')
  const [legal, setLegal] = useState('')
  const [matches, setMatches] = useState<FieldRow[] | null>(null)

  const submit = () => {
    const n = name.trim()
    if (!n) return
    const similar = findSimilarFields(n, archived)
    if (similar.length) setMatches(similar)
    else onCreate(n, legal.trim() || null)
  }

  return (
    <Modal title="Add field" onClose={onClose}>
      {matches ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-gray-700">
            {matches.length === 1 ? 'An archived field looks like the same one:' : 'These archived fields look similar:'}
          </p>
          <ul className="divide-y divide-gray-100 rounded-md border border-gray-200">
            {matches.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-2 px-3 py-2">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-gray-900">{m.name}</span>
                  {m.legal_land_description && (
                    <span className="block truncate text-xs text-gray-500">{m.legal_land_description}</span>
                  )}
                </span>
                <button
                  onClick={() => onRestore(m.id)}
                  disabled={saving}
                  className="shrink-0 rounded-md bg-brand-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
                >
                  Restore this
                </button>
              </li>
            ))}
          </ul>
          <HelpNote summary="Restore it, or create a brand-new field with this name." title="Restore or create">
            Restoring brings the field back with all its saved information (crop history, soil,
            pivot, notes). Or create a brand-new field with this name.
          </HelpNote>
          <div className="flex justify-end gap-2">
            <button onClick={() => setMatches(null)} className="rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">
              Back
            </button>
            <button
              onClick={() => onCreate(name.trim(), legal.trim() || null)}
              disabled={saving}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Create new anyway
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <label className="text-xs font-medium text-gray-500">
            Field name
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900"
            />
          </label>
          <label className="text-xs font-medium text-gray-500">
            Legal land description (optional)
            <input
              value={legal}
              onChange={(e) => setLegal(e.target.value)}
              className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900"
            />
          </label>
          {/* Shown because the first field on a new farm also creates the farm
              record, and a failure there would otherwise look like nothing happened. */}
          {error && <p className="text-xs text-red-700">{error}</p>}
          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={saving || !name.trim()}
              className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
            >
              Add field
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}

/**
 * Deere fields that were deleted here.
 *
 * A delete used to be undone by the next sync — the field came straight back,
 * dashes and all — so it now leaves a headstone the sync respects. That makes a
 * delete final in a way it was not before, which is a thing to be able to see
 * and take back rather than a silent list in the database.
 *
 * Under the archive tab because that is where somebody goes looking for a field
 * they have put away.
 */
function DismissedJdFields() {
  const { data } = useDismissedJdFields()
  const allow = useAllowJdField()
  const { profile } = useAuth()
  if (!data?.length) return null

  return (
    <div className="overflow-hidden mt-6 rounded-lg border border-gray-200 bg-white">
      <h2 className={cn('font-medium', CARD_HEAD)}>Deleted John Deere fields</h2>
      <div className="p-4">
      <p className="mt-1 text-xs text-gray-500">
        Deere still has these. They are not brought back in, because they were deleted here on
        purpose.
      </p>
      <ul className="mt-2 divide-y divide-gray-100">
        {data.map((d) => (
          <li key={d.jd_field_id} className="flex items-center justify-between gap-3 py-2">
            <div>
              <span className="text-sm font-medium text-gray-800">{d.name || '(no name)'}</span>
              <span className="ml-2 text-xs text-gray-400">
                deleted {new Date(d.dismissed_at).toLocaleDateString('en-CA')}
              </span>
            </div>
            {hasManagerAccess(profile?.role) && (
              <button
                onClick={() => allow.mutate(d.jd_field_id)}
                disabled={allow.isPending}
                title="Let the next John Deere sync bring this field back."
                className="rounded-md border border-gray-200 px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40"
              >
                let it back
              </button>
            )}
          </li>
        ))}
      </ul>

      </div>
    </div>
  )
}
