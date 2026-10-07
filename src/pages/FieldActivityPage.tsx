import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, History } from 'lucide-react'
import { Select } from '@/components/Select'
import { useAllFields, useFieldAudit, useUsers } from '@/lib/queries'
import { cn } from '@/lib/utils'

/**
 * Everything that has happened to one field.
 *
 * Split off the field page, where the full trail ran to hundreds of rows and
 * pushed the boundary, the irrigation card and the files below the fold. The
 * field page keeps the recent handful — "has anyone touched this lately" — and
 * this answers the other question, which is usually "when did that change and
 * who did it".
 *
 * Grouped by day, because that is how the question arrives: not "entry 214" but
 * "what happened the week we re-drew the boundary".
 */
const TABLE_LABELS: Record<string, string> = {
  fields: 'Field',
  fieldnet_systems: 'Pivot status',
  hail_inspections: 'Hail inspection',
  field_boundaries: 'Boundary',
  field_files: 'File',
  field_hail_events: 'Hail',
  field_crop_seasons: 'Irrigation season',
  crop_plans: 'Crop plan',
  crop_history: 'Crop history',
  map_features: 'Map feature',
}

const ACTION_LABEL: Record<string, string> = {
  insert: 'created',
  update: 'updated',
  delete: 'deleted',
}

export function FieldActivityPage() {
  const { id } = useParams<{ id: string }>()
  const { data: audit } = useFieldAudit(id)
  const { data: users } = useUsers()
  const { data: fields } = useAllFields()
  const [table, setTable] = useState('')
  // People first. The pivot sync writes to fieldnet_systems every ten minutes,
  // so on a field with a pivot the automatic entries outnumber the human ones
  // roughly fifty to one — a log where you scroll past two hundred identical
  // machine writes to find the boundary someone re-drew is not a log anybody
  // reads twice.
  const [who, setWho] = useState<'people' | 'all'>('people')

  const field = fields?.find((f) => f.id === id)
  const userName = (uid: string | null) =>
    (uid && users?.find((u) => u.id === uid)?.full_name) || 'system'

  const tables = useMemo(
    () => [...new Set((audit ?? []).map((a) => a.table_name))].sort(),
    [audit],
  )

  const rows = useMemo(
    () =>
      (audit ?? [])
        .filter((a) => !table || a.table_name === table)
        .filter((a) => who === 'all' || a.actor_id),
    [audit, table, who],
  )
  const automatic = (audit ?? []).filter((a) => !a.actor_id).length

  /** Newest day first, entries within a day newest first. */
  const byDay = useMemo(() => {
    const m = new Map<string, typeof rows>()
    for (const a of rows) {
      const day = new Date(a.changed_at).toLocaleDateString('en-CA', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
      if (!m.has(day)) m.set(day, [])
      m.get(day)!.push(a)
    }
    return [...m.entries()]
  }, [rows])

  return (
    <div className="p-4 md:p-6">
      {/* Back to the section this drills down from, not to the top of the
          field — this is the long form of what the History tab summarises. */}
      <Link
        to={`/fields/${id}/history`}
        className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> {field?.name ?? 'The field'} · History
      </Link>

      <h1 className="mt-2 flex items-center gap-1.5 text-lg font-semibold text-gray-900">
        <History className="h-5 w-5 text-gray-400" /> Activity
        {field && <span className="font-normal text-gray-500">· {field.name}</span>}
      </h1>
      <p className="mt-0.5 text-xs text-gray-500">
        Every recorded change to this field, newest first. Written by the database itself, so it
        covers changes made anywhere in the app.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className="flex rounded-md border border-gray-200 p-0.5">
          {(['people', 'all'] as const).map((w) => (
            <button
              key={w}
              onClick={() => setWho(w)}
              className={cn(
                'rounded px-2.5 py-1 text-xs font-medium',
                who === w ? 'bg-brand-700 text-white' : 'text-gray-600 hover:bg-gray-50',
              )}
            >
              {w === 'people' ? 'People' : 'Everything'}
            </button>
          ))}
        </div>
        {who === 'people' && automatic > 0 && (
          <span className="text-[11px] text-gray-400">
            {automatic} automatic {automatic === 1 ? 'entry' : 'entries'} hidden — mostly the pivot
            sync writing status
          </span>
        )}
      </div>

      {tables.length > 1 && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Select
            value={table}
            onChange={setTable}
            size="sm"
            ariaLabel="Filter by what changed"
            placeholder="Everything"
            className="w-56"
            options={tables.map((t) => ({ value: t, label: TABLE_LABELS[t] ?? t }))}
          />
          {table && (
            <button
              onClick={() => setTable('')}
              className="text-xs text-gray-500 hover:text-gray-800 hover:underline"
            >
              Clear
            </button>
          )}
          <span className="text-[11px] text-gray-400">
            {rows.length} of {audit?.length ?? 0} entries
          </span>
        </div>
      )}

      {audit == null ? (
        <p className="mt-4 text-sm text-gray-400">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="mt-4 text-sm text-gray-400">
          {table
            ? 'Nothing of that kind.'
            : who === 'people'
              ? 'Nobody has changed this field by hand. Switch to Everything for the automatic entries.'
              : 'No recorded activity.'}
        </p>
      ) : (
        <div className="mt-4 space-y-4">
          {byDay.map(([day, entries]) => (
            <section key={day}>
              <h2 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                {day}
              </h2>
              <ul className="mt-1 divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
                {entries.map((a) => {
                  const nv = (a.new_values ?? {}) as Record<string, unknown>
                  const detail =
                    a.table_name === 'field_files'
                      ? String(nv.filename ?? '')
                      : a.crop_year
                        ? `crop year ${a.crop_year}`
                        : ''
                  return (
                    <li key={a.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-3 py-1.5 text-sm">
                      <span className="w-14 shrink-0 text-xs tabular-nums text-gray-400">
                        {new Date(a.changed_at).toLocaleTimeString('en-CA', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="font-medium text-gray-900">
                          {TABLE_LABELS[a.table_name] ?? a.table_name}
                        </span>{' '}
                        <span
                          className={cn(
                            a.action === 'delete' ? 'text-red-700' : 'text-gray-600',
                          )}
                        >
                          {ACTION_LABEL[a.action] ?? a.action}
                        </span>
                        {detail && <span className="text-gray-500"> — {detail}</span>}
                      </span>
                      <span className="shrink-0 text-xs text-gray-400">{userName(a.actor_id)}</span>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
