import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { ChevronRight, Search, Tag, Users } from 'lucide-react'
import {
  AddButton,
  DeleteButton,
  DetailList,
  EditButton,
  RecordEditModal,
  rowClick,
  type EditField,
} from '@/components/RecordEditor'
import {
  ageFromBirth,
  CATTLE_SEXES,
  CATTLE_STATUSES,
  cattleWord,
  filterAnimals,
  useCattle,
  useCattleGroupMutations,
  useCattleGroups,
  useCattleMutations,
  type CattleGroupRow,
  type CattleRow,
} from '@/lib/cattle'
import { cn } from '@/lib/utils'

/**
 * The individually tagged animals, on the Herd page (Sam, 7 Oct 2026: every
 * row opens to its detail). /cattle/:id existed but nothing listed the
 * animals, so the only way in was search. Scoped by the ranch picker like the
 * rest of the section; under All every ranch's animals show and Add asks which
 * ranch.
 */
export function HerdAnimals({
  ranchId,
  ranches,
  isManager,
}: {
  /** '' is every ranch. */
  ranchId: string
  ranches: { id: string; name: string }[]
  isManager: boolean
}) {
  const navigate = useNavigate()
  const { data: animals, isLoading } = useCattle(ranchId || null)
  const { data: groups } = useCattleGroups(ranchId || null)
  const { create } = useCattleMutations()
  const [search, setSearch] = useState('')
  const [showGone, setShowGone] = useState(false)
  const [adding, setAdding] = useState(false)

  const groupName = useMemo(() => {
    const m = new Map((groups ?? []).map((g) => [g.id, g.name]))
    return (id: string | null) => (id ? (m.get(id) ?? '') : '')
  }, [groups])
  const ranchName = (id: string | null) => ranches.find((r) => r.id === id)?.name ?? ''
  const rows = useMemo(
    () => filterAnimals(animals ?? [], { search, showGone, groupName }),
    [animals, search, showGone, groupName],
  )
  const gone = (animals ?? []).filter((a) => a.status !== 'active').length

  const fields: EditField[] = [
    { key: 'tag', label: 'Tag', kind: 'text', placeholder: '1024' },
    { key: 'name', label: 'Name', kind: 'text' },
    { key: 'sex', label: 'Sex / class', kind: 'select', options: [{ value: '', label: '—' }, ...CATTLE_SEXES.map((s) => ({ value: s, label: s }))] },
    { key: 'breed', label: 'Breed', kind: 'text' },
    { key: 'birth_date', label: 'Birth date', kind: 'date' },
    { key: 'acquired_date', label: 'Bought / arrived', kind: 'date' },
    ...(ranchId
      ? []
      : [{ key: 'ranch_id', label: 'Ranch', kind: 'select' as const, required: true, options: [{ value: '', label: 'Choose…' }, ...ranches.map((r) => ({ value: r.id, label: r.name }))] }]),
    { key: 'group_id', label: 'Group', kind: 'select', options: [{ value: '', label: 'No group' }, ...(groups ?? []).map((g) => ({ value: g.id, label: g.name }))] },
    { key: 'status', label: 'Status', kind: 'select', options: CATTLE_STATUSES.map((s) => ({ value: s, label: s })) },
    { key: 'dam_tag', label: 'Dam tag', kind: 'text' },
    { key: 'sire_tag', label: 'Sire tag', kind: 'text' },
    { key: 'notes_md', label: 'Notes', kind: 'textarea' },
  ]

  return (
    <section className="mb-4 rounded-lg border border-gray-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-3 py-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-gray-700">
          <Tag className="h-4 w-4 text-gray-400" /> Animals
          <span className="font-normal text-gray-400">{(animals ?? []).length - gone} on hand</span>
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Tag, name, group…"
              aria-label="Search animals"
              className="w-44 rounded-md border border-gray-300 py-1 pl-7 pr-2 text-xs"
            />
          </label>
          {gone > 0 && (
            <label className="flex items-center gap-1 text-xs text-gray-500">
              <input type="checkbox" checked={showGone} onChange={(e) => setShowGone(e.target.checked)} />
              sold, died, culled ({gone})
            </label>
          )}
          {isManager && <AddButton label="Add animal" onClick={() => setAdding(true)} />}
        </div>
      </div>

      {isLoading ? (
        <p className="px-3 py-4 text-sm text-gray-400">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="px-3 py-6 text-center text-sm text-gray-400">
          {(animals ?? []).length === 0 ? 'No tagged animals recorded — the head count above is the herd.' : 'No animal matches.'}
        </p>
      ) : (
        <div className="max-h-[28rem] overflow-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="sticky top-0 bg-white text-left text-[10px] uppercase tracking-wide text-gray-400">
              <tr>
                <th className="px-3 py-1.5 font-medium">Tag</th>
                <th className="px-2 py-1.5 font-medium">Name</th>
                <th className="px-2 py-1.5 font-medium">Class</th>
                <th className="px-2 py-1.5 font-medium">Group</th>
                {!ranchId && <th className="px-2 py-1.5 font-medium">Ranch</th>}
                <th className="px-2 py-1.5 font-medium">Born</th>
                <th className="px-2 py-1.5 font-medium">Status</th>
                <th />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((a) => (
                <tr
                  key={a.id}
                  onClick={rowClick(() => navigate(`/cattle/${a.id}`))}
                  className={cn('cursor-pointer hover:bg-gray-50', a.status !== 'active' && 'text-gray-400')}
                >
                  <td className="px-3 py-1.5 font-medium tabular-nums">{a.tag ? `#${a.tag}` : 'Untagged'}</td>
                  <td className="px-2 py-1.5">{a.name ?? ''}</td>
                  <td className="px-2 py-1.5 capitalize">{a.sex ?? '—'}</td>
                  <td className="px-2 py-1.5">{groupName(a.group_id) || '—'}</td>
                  {!ranchId && <td className="px-2 py-1.5">{ranchName(a.ranch_id) || '—'}</td>}
                  <td className="px-2 py-1.5 tabular-nums" title={a.birth_date ?? undefined}>
                    {a.birth_date ? `${a.birth_date} · ${ageFromBirth(a.birth_date)}` : '—'}
                  </td>
                  <td className="px-2 py-1.5 capitalize">{cattleWord(a.status)}</td>
                  <td className="px-2 py-1.5 text-right">
                    <ChevronRight className="inline h-4 w-4 text-gray-300" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {adding && (
        <RecordEditModal
          title="Add an animal"
          fields={fields}
          row={{ ranch_id: ranchId, status: 'active' }}
          saving={create.isPending}
          error={create.error ? (create.error as Error).message : null}
          onClose={() => setAdding(false)}
          onSave={(patch) =>
            create.mutateAsync({
              ...(patch as Partial<CattleRow>),
              ranch_id: ranchId || (patch.ranch_id as string),
              status: (patch.status as CattleRow['status']) ?? 'active',
            })
          }
        />
      )}
    </section>
  )
}

/**
 * The animal groups (cattle_groups) an animal can be put in: add, rename,
 * delete. Kept apart from the head-count classes above — those are totals the
 * Feed and Grazing tabs read; these only sort tagged animals.
 */
export function CattleGroupsCard({ ranchId, ranches, isManager }: { ranchId: string; ranches: { id: string; name: string }[]; isManager: boolean }) {
  const qc = useQueryClient()
  const { data: groups } = useCattleGroups(ranchId || null)
  const { data: animals } = useCattle(ranchId || null)
  const m = useCattleGroupMutations()
  const [open, setOpen] = useState<string | null>(null)
  const [editing, setEditing] = useState<CattleGroupRow | 'new' | null>(null)
  const inGroup = (id: string) => (animals ?? []).filter((a) => a.group_id === id && a.status === 'active').length
  const ranchName = (id: string | null) => ranches.find((r) => r.id === id)?.name ?? ''

  const fields: EditField[] = [
    { key: 'name', label: 'Name', kind: 'text', required: true },
    ...(ranchId || editing !== 'new'
      ? []
      : [{ key: 'ranch_id', label: 'Ranch', kind: 'select' as const, required: true, options: [{ value: '', label: 'Choose…' }, ...ranches.map((r) => ({ value: r.id, label: r.name }))] }]),
    { key: 'avg_weight_lb', label: 'Average weight (lb)', kind: 'number', int: true },
    { key: 'active', label: 'In use', kind: 'bool' },
    { key: 'notes_md', label: 'Notes', kind: 'textarea' },
  ]
  const err = m.create.error ?? m.update.error ?? m.remove.error
  const afterDelete = () => void qc.invalidateQueries({ queryKey: ['cattle'] })

  if (!isManager && !(groups ?? []).length) return null
  return (
    <section className="mb-4 rounded-lg border border-gray-200 bg-white">
      <div className="flex items-center justify-between gap-2 border-b border-gray-200 px-3 py-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-gray-700">
          <Users className="h-4 w-4 text-gray-400" /> Animal groups
        </h2>
        {isManager && <AddButton label="Add group" onClick={() => setEditing('new')} />}
      </div>
      <ul className="divide-y divide-gray-100 text-sm">
        {(groups ?? []).map((g) => (
          <li key={g.id}>
            <div
              onClick={rowClick(() => setOpen(open === g.id ? null : g.id))}
              className="flex cursor-pointer items-center gap-2 px-3 py-1.5 hover:bg-gray-50"
            >
              <ChevronRight className={cn('h-3.5 w-3.5 text-gray-400 transition-transform', open === g.id && 'rotate-90')} />
              <span className={cn('min-w-0 flex-1 truncate', !g.active && 'text-gray-400')}>{g.name}</span>
              <span className="text-xs tabular-nums text-gray-500">{inGroup(g.id)} animals</span>
              {isManager && (
                <span onClick={(e) => e.stopPropagation()} className="flex items-center gap-1">
                  <EditButton onClick={() => setEditing(g)} />
                  <DeleteButton
                    label="Delete"
                    confirm={`Delete the group "${g.name}"? ${inGroup(g.id) ? `Its ${inGroup(g.id)} animals stay, with no group.` : ''}`}
                    onDelete={() => m.remove.mutate(g.id, { onSuccess: afterDelete })}
                  />
                </span>
              )}
            </div>
            {open === g.id && (
              <DetailList
                className="bg-gray-50 px-9 py-2"
                rows={[
                  ['Ranch', ranchName(g.ranch_id)],
                  ['Animals in it', String(inGroup(g.id))],
                  ['Average weight', g.avg_weight_lb != null ? `${g.avg_weight_lb.toLocaleString('en-CA')} lb` : null],
                  ['In use', g.active ? 'Yes' : 'No'],
                  ['Notes', g.notes_md],
                ]}
              />
            )}
          </li>
        ))}
        {(groups ?? []).length === 0 && <li className="px-3 py-3 text-xs text-gray-400">No groups yet.</li>}
      </ul>
      {err && <p className="px-3 pb-2 text-xs text-red-600">{(err as Error).message}</p>}

      {editing && (
        <RecordEditModal
          title={editing === 'new' ? 'Add a group' : `Edit ${editing.name}`}
          fields={fields}
          row={editing === 'new' ? { ranch_id: ranchId, active: true } : editing}
          saving={m.create.isPending || m.update.isPending}
          error={err ? (err as Error).message : null}
          onClose={() => setEditing(null)}
          onDelete={editing === 'new' ? undefined : () => m.remove.mutateAsync(editing.id).then(afterDelete)}
          deleteConfirm={editing === 'new' ? undefined : `Delete the group "${editing.name}"? Its animals stay, with no group.`}
          onSave={async (patch) => {
            if (editing === 'new') {
              await m.create.mutateAsync({
                name: String(patch.name),
                ranch_id: ranchId || (patch.ranch_id as string) || null,
                avg_weight_lb: patch.avg_weight_lb as number | null,
                active: patch.active !== false,
                notes_md: patch.notes_md as string | null,
              })
              return
            }
            await m.update.mutateAsync({
              id: editing.id,
              patch: {
                name: String(patch.name),
                avg_weight_lb: patch.avg_weight_lb as number | null,
                active: patch.active == null ? editing.active : Boolean(patch.active),
                notes_md: patch.notes_md as string | null,
              },
            })
          }}
        />
      )}
    </section>
  )
}
