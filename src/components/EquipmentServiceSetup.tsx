import { useMemo, useState } from 'react'
import { Users } from 'lucide-react'
import {
  useAddServicePlans,
  useDefaultServiceAssignees,
  useSaveDefaultServiceAssignees,
  useSaveEquipment,
  type Equipment,
} from '@/lib/equipment'
import { DEFAULT_WARN_DAYS, DEFAULT_WARN_HOURS } from '@/lib/maintenance'
import { useUsers } from '@/lib/queries'
import {
  MACHINE_TYPE_LABELS,
  guessMachineType,
  missingTemplates,
  type MachineType,
} from '@/lib/service-templates'
import { Select } from '@/components/Select'

type Person = { id: string; full_name: string | null; email: string | null }

function PeopleChecks({ people, value, onChange }: { people: Person[]; value: string[]; onChange: (ids: string[]) => void }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5 rounded-md border border-gray-300 p-2">
      {people.map((u) => (
        <label key={u.id} className="flex items-center gap-1.5 text-sm text-gray-900">
          <input
            type="checkbox"
            checked={value.includes(u.id)}
            onChange={(e) => onChange(e.target.checked ? [...value, u.id] : value.filter((id) => id !== u.id))}
          />
          {u.full_name || u.email || '—'}
        </label>
      ))}
      {people.length === 0 && <span className="text-xs text-gray-400">No users on file.</span>}
    </div>
  )
}

/**
 * Who a machine's service tasks go to: its own people, else the farm default.
 * Managers only. One line when closed; the checkboxes open on Change.
 */
export function ServiceAssignees({ equipment }: { equipment: Equipment }) {
  const { data: users } = useUsers()
  const { data: farmDefault } = useDefaultServiceAssignees()
  const saveMachine = useSaveEquipment()
  const saveDefault = useSaveDefaultServiceAssignees()
  const [editing, setEditing] = useState<'machine' | 'default' | null>(null)
  const [draft, setDraft] = useState<string[]>([])

  const people = useMemo(() => (users ?? []) as Person[], [users])
  const name = useMemo(() => new Map(people.map((u) => [u.id, u.full_name || u.email || '—'])), [people])
  // A row cached before 20261016050000 has no list; that reads as none.
  const own = equipment.service_assignees ?? []
  const def = farmDefault ?? []
  const names = (ids: string[]) => ids.map((id) => name.get(id) ?? 'someone').join(', ')
  const err = (saveMachine.error ?? saveDefault.error) as Error | null

  return (
    <div className="mt-3 rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-600">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Users className="h-3.5 w-3.5 text-gray-400" />
        <span>
          Service tasks go to{' '}
          <span className="font-medium text-gray-800">
            {own.length ? names(own) : def.length ? `${names(def)} (farm default)` : 'nobody yet — managers are told'}
          </span>
        </span>
        {!editing && (
          <>
            <button type="button" onClick={() => { setDraft(own); setEditing('machine') }} className="text-brand-700 hover:underline">
              Change
            </button>
            <button type="button" onClick={() => { setDraft(def); setEditing('default') }} className="text-gray-500 hover:underline">
              Farm default
            </button>
          </>
        )}
      </div>
      {editing && (
        <div className="mt-2">
          <p className="mb-1 text-[11px] text-gray-500">
            {editing === 'machine'
              ? `For ${equipment.name ?? 'this machine'}. Tick nobody to use the farm default.`
              : 'For every machine without its own people.'}
          </p>
          <PeopleChecks people={people} value={draft} onChange={setDraft} />
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              disabled={saveMachine.isPending || saveDefault.isPending}
              onClick={() => {
                const done = { onSuccess: () => setEditing(null) }
                if (editing === 'machine') saveMachine.mutate({ id: equipment.id, service_assignees: draft }, done)
                else saveDefault.mutate(draft, done)
              }}
              className="rounded-md bg-brand-700 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
            >
              Save
            </button>
            <button type="button" onClick={() => setEditing(null)} className="rounded-md border border-gray-300 px-3 py-1 text-xs text-gray-600">
              Cancel
            </button>
            {err && <span className="text-xs text-red-600">{err.message}</span>}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Common starting intervals for the kind of machine, ticked by default, added
 * in one go and then edited one by one. Generic figures, every one marked to
 * be checked against the manual (src/lib/service-templates.ts).
 */
export function ServiceTemplatesPanel({
  equipment,
  existingNames,
  onDone,
}: {
  equipment: Equipment
  existingNames: string[]
  onDone: () => void
}) {
  const add = useAddServicePlans()
  const [type, setType] = useState<MachineType>(() => guessMachineType(equipment))
  const rows = missingTemplates(type, existingNames)
  const [skip, setSkip] = useState<Set<string>>(new Set())
  const chosen = rows.filter((r) => !skip.has(r.name))
  const every = (r: (typeof rows)[number]) =>
    [r.interval_hours ? `${r.interval_hours} h` : null, r.interval_months ? `${r.interval_months} mo` : null].filter(Boolean).join(' or ')

  return (
    <div className="rounded-lg bg-brand-50/50 p-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
        Common intervals for a
        <Select
          className="w-48"
          size="sm"
          ariaLabel="Kind of machine"
          value={type}
          onChange={(v) => { setType(v as MachineType); setSkip(new Set()) }}
          options={(Object.keys(MACHINE_TYPE_LABELS) as MachineType[]).map((k) => ({ value: k, label: MACHINE_TYPE_LABELS[k] }))}
        />
      </div>
      <p className="mt-1 text-[11px] text-amber-800">Generic starting points, not Deere&apos;s and not this machine&apos;s manual. Check each one and edit it after adding.</p>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-gray-400">Every one of these is already on this machine.</p>
      ) : (
        <ul className="mt-2 space-y-1">
          {rows.map((r) => (
            <li key={r.name}>
              <label className="flex items-baseline gap-2 text-sm text-gray-800">
                <input
                  type="checkbox"
                  checked={!skip.has(r.name)}
                  onChange={(e) => {
                    const next = new Set(skip)
                    if (e.target.checked) next.delete(r.name)
                    else next.add(r.name)
                    setSkip(next)
                  }}
                />
                {r.name}
                <span className="text-xs text-gray-500">every {every(r)}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          disabled={!chosen.length || add.isPending}
          onClick={() =>
            add.mutate(
              chosen.map((r) => ({
                equipment_id: equipment.id,
                name: r.name,
                interval_hours: r.interval_hours,
                interval_months: r.interval_months,
                parts: r.parts ?? null,
                notes: r.notes ?? null,
                warn_within_hours: DEFAULT_WARN_HOURS,
                warn_within_days: DEFAULT_WARN_DAYS,
              })),
              { onSuccess: onDone },
            )
          }
          className="rounded-md bg-brand-700 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
        >
          Add {chosen.length || ''}
        </button>
        <button type="button" onClick={onDone} className="rounded-md border border-gray-300 px-3 py-1 text-xs text-gray-600">
          Cancel
        </button>
        {add.isError && <span className="text-xs text-red-600">{(add.error as Error).message}</span>}
      </div>
    </div>
  )
}
