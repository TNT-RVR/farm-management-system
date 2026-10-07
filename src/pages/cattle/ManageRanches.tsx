import { useState } from 'react'
import { ChevronRight, Home } from 'lucide-react'
import { DetailList, EditButton, RecordEditModal, rowClick, type EditField } from '@/components/RecordEditor'
import { AddRanchButton } from '@/pages/cattle/AddRanch'
import { loadRanchUse, ranchDeleteBlockers, useDeleteRanch, useEditRanch } from '@/lib/cattle'
import { useMainRanch, useRanches, type Ranch } from '@/lib/ranches'
import { cn } from '@/lib/utils'

const FIELDS: EditField[] = [
  {
    key: 'name',
    label: 'Name',
    kind: 'text',
    required: true,
    hint: 'eShepherd mobs are matched to a ranch by name ("East Ranch Replacement Heifer") — rename the mobs too.',
  },
  { key: 'latitude', label: 'Latitude', kind: 'number', hint: 'For the weather lookups.' },
  { key: 'longitude', label: 'Longitude', kind: 'number' },
]

/**
 * The ranches the Cattle section is scoped by: each opens to its details,
 * and can be renamed or deleted (Sam, 7 Oct 2026). Delete is refused while
 * the ranch still holds animals, head counts, feed records, the yard ledger,
 * pastures or sales — deleting would take the feed history with it — and the
 * refusal says what is in the way.
 */
export function ManageRanches({ isManager }: { isManager: boolean }) {
  const { data: ranches } = useRanches()
  const main = useMainRanch()
  const edit = useEditRanch()
  const del = useDeleteRanch()
  const [open, setOpen] = useState<string | null>(null)
  const [editing, setEditing] = useState<Ranch | null>(null)
  const [refusal, setRefusal] = useState<string | null>(null)

  const tryDelete = async (r: Ranch) => {
    setRefusal(null)
    try {
      const blockers = ranchDeleteBlockers(await loadRanchUse(r))
      if (blockers.length) {
        setRefusal(`${r.name} cannot be deleted while it has ${blockers.join(', ')}. Move or remove those first.`)
        return
      }
      if (!window.confirm(`Delete the ranch ${r.name}? Its feed plan, rations and mineral programme go with it.`)) return
      await del.mutateAsync(r.id)
      setEditing(null)
    } catch (e) {
      setRefusal((e as Error).message)
    }
  }

  return (
    <section className="rounded-lg border border-gray-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-3 py-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
          <Home className="h-4 w-4 text-gray-400" /> Ranches
        </h2>
        {isManager && <AddRanchButton />}
      </div>
      <ul className="divide-y divide-gray-100 text-sm">
        {(ranches ?? []).map((r) => (
          <li key={r.id}>
            <div onClick={rowClick(() => setOpen(open === r.id ? null : r.id))} className="flex cursor-pointer items-center gap-2 px-3 py-1.5 hover:bg-gray-50">
              <ChevronRight className={cn('h-3.5 w-3.5 text-gray-400 transition-transform', open === r.id && 'rotate-90')} />
              <span className="min-w-0 flex-1 truncate font-medium text-gray-800">{r.name}</span>
              {main?.id === r.id && <span className="text-[11px] text-gray-400">main ranch</span>}
              {isManager && (
                <span className="flex items-center gap-1">
                  <EditButton label="Rename" onClick={() => setEditing(r)} />
                  {/* The confirm comes after the check, inside tryDelete. */}
                  <button
                    type="button"
                    onClick={() => void tryDelete(r)}
                    className="rounded-md border border-red-200 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
                  >
                    Delete
                  </button>
                </span>
              )}
            </div>
            {open === r.id && (
              <DetailList
                className="bg-gray-50 px-9 py-2 text-xs"
                rows={[
                  ['Place', r.latitude != null && r.longitude != null ? `${Number(r.latitude).toFixed(4)}, ${Number(r.longitude).toFixed(4)}` : 'Not set — weather lookups need it'],
                  ['Main ranch', main?.id === r.id ? 'Yes (Farm setup)' : null],
                  ['Google My Map', r.mymaps_url],
                ]}
              />
            )}
          </li>
        ))}
      </ul>
      {refusal && <p className="px-3 py-2 text-xs text-amber-800">{refusal}</p>}
      {editing && (
        <RecordEditModal
          title={`Rename ${editing.name}`}
          fields={FIELDS}
          row={editing}
          saving={edit.isPending}
          error={edit.error ? (edit.error as Error).message : null}
          onClose={() => setEditing(null)}
          onSave={(p) =>
            edit.mutateAsync({
              id: editing.id,
              oldName: editing.name,
              patch: { name: String(p.name).trim(), latitude: p.latitude as number | null, longitude: p.longitude as number | null },
            })
          }
        />
      )}
    </section>
  )
}
