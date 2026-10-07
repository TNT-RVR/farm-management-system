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
  useHailMutations,
  type FieldRow,
} from '@/lib/queries'
import { useFieldSeasons, useSetIrrigationDone } from '@/lib/irrigation'
import { cn } from '@/lib/utils'
import { HelpNote } from '@/components/HelpNote'
import { useAllowJdField, useDismissedJdFields } from '@/lib/jd-dismissed'
import { withDisplay } from '@/lib/reports/columns'
import { doneWateringFields, fieldListColumns, fieldListRows, fieldSeasonMap, type FieldListRow } from '@/lib/reports/lists'

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
  const { setHail } = useHailMutations(cropYear)
  const { data: seasons } = useFieldSeasons(cropYear)
  const setDone = useSetIrrigationDone(cropYear)
  const isManager = hasManagerAccess(profile?.role)
  const hailFields = useMemo(
    () => new Set((hailEvents ?? []).map((h) => h.field_id)),
    [hailEvents],
  )

  // One season row per field for this year; the whole-field row carries the
  // "done watering" checkbox the to-do generator reads.
  const seasonByField = useMemo(() => fieldSeasonMap(seasons ?? []), [seasons])
  const doneFields = useMemo(() => doneWateringFields(seasonByField), [seasonByField])

  const [tab, setTab] = useState<'active' | 'archive'>('active')
  const [adding, setAdding] = useState(false)
  const [deleting, setDeleting] = useState<FieldRow | null>(null)

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
  const columns: DataTableColumn<Row>[] = withDisplay(fieldListColumns({ cropYear, hailFields, doneFields }), {
    name: { className: 'font-medium' },
    map_acres: {
      // A dash already says "no boundary"; the separate Boundary column said it twice.
      render: (r) => (r.map_acres != null ? r.map_acres.toFixed(1) : '—'),
      className: 'text-right tabular-nums',
    },
    hail: {
      className: 'text-center',
      render: (r) => (
        <input
          type="checkbox"
          checked={hailFields.has(r.id)}
          disabled={!isManager}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => setHail.mutate({ fieldId: r.id, on: e.target.checked })}
          className="h-4 w-4 cursor-pointer accent-brand-700 disabled:cursor-default"
          title={`Mark a hail event on ${r.name} in ${cropYear}`}
          aria-label={`Hail event on ${r.name}`}
        />
      ),
    },
    watered: {
      className: 'text-center',
      render: (r) => {
        const season = seasonByField.get(r.id)
        // No season row means the field is not being scheduled at all — there
        // is nothing raising to-dos, so there is nothing to silence. A dash
        // rather than an unticked box, which would read as "still to do".
        if (!season) return <span className="text-xs text-gray-300">—</span>
        return (
          <input
            type="checkbox"
            checked={Boolean(season.irrigation_done_at)}
            disabled={!isManager}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) =>
              setDone.mutate({
                seasonId: season.id,
                done: e.target.checked,
                userId: profile?.id ?? null,
              })
            }
            className="h-4 w-4 cursor-pointer accent-brand-700 disabled:cursor-default"
            title={`Finished watering ${r.name} for ${cropYear} — stops the irrigation to-dos`}
            aria-label={`Done watering ${r.name}`}
          />
        )
      },
    },
  })
  if (isManager) {
    columns.push({
      key: 'actions',
      label: '',
      value: () => '',
      className: 'text-right',
      render: (r) => (
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
        {isManager && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setAdding(true)}
              className="flex items-center gap-1.5 rounded-md bg-brand-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-800"
            >
              <Plus className="h-3.5 w-3.5" /> Add field
            </button>
            <Link
              to="/fields/import"
              className="flex items-center gap-1.5 rounded-md border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              <FileUp className="h-3.5 w-3.5" /> Import boundaries
            </Link>
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
    <div className="mt-6 rounded-lg border border-gray-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-gray-700">Deleted John Deere fields</h2>
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
  )
}
