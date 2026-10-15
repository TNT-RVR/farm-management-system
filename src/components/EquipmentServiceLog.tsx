import { Fragment, useMemo, useState } from 'react'
import { ChevronRight, History } from 'lucide-react'
import { AddButton, DetailList, EditButton, RecordEditModal, rowClick, type EditField } from '@/components/RecordEditor'
import { useDeleteServiceLog, useSaveServiceLog, useServiceLog, useServicePlans, type Equipment, type ServiceLogRow } from '@/lib/equipment'
import { useUsers } from '@/lib/queries'
import { keepOpenOnError } from '@/lib/record-actions'
import { cn } from '@/lib/utils'

const day = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })
const money = (v: number | null) => (v == null ? null : `$${Number(v).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)

/**
 * The service done on a machine — written by "Done" on the schedule, never
 * shown until now (Sam, 7 Oct 2026). A row opens to the whole entry; anyone
 * active may add one (equipment_service_log_insert), only a manager may change
 * or delete one (equipment_service_log_manage). A plan's "last done" follows
 * its latest entry when one is corrected or removed.
 */
export function EquipmentServiceLog({ equipment, canEdit, canAdd }: { equipment: Equipment; canEdit: boolean; canAdd: boolean }) {
  const { data: log } = useServiceLog(equipment.id)
  const { data: plans } = useServicePlans(equipment.id)
  const { data: users } = useUsers()
  const save = useSaveServiceLog()
  const del = useDeleteServiceLog()
  const [open, setOpen] = useState<string | null>(null)
  const [editing, setEditing] = useState<ServiceLogRow | 'new' | null>(null)
  const [all, setAll] = useState(false)

  const planName = useMemo(() => new Map((plans ?? []).map((p) => [p.id, p.name])), [plans])
  const userName = useMemo(() => new Map((users ?? []).map((u) => [u.id, u.full_name || u.email])), [users])
  const what = (r: ServiceLogRow) => (r.plan_id ? (planName.get(r.plan_id) ?? 'A retired plan') : 'Other work')
  const rows = log ?? []
  const shown = all ? rows : rows.slice(0, 10)

  const fields: EditField[] = [
    { key: 'done_on', label: 'Done on', kind: 'date', required: true },
    {
      key: 'plan_id',
      label: 'What',
      kind: 'select',
      options: [
        { value: '', label: 'Other work (no plan)' },
        ...(plans ?? []).map((p) => ({ value: p.id, label: p.name })),
        // An entry on a plan since retired keeps its plan in the list.
        ...(editing && editing !== 'new' && editing.plan_id && !planName.has(editing.plan_id) ? [{ value: editing.plan_id, label: 'A retired plan' }] : []),
      ],
    },
    { key: 'engine_hours', label: 'Engine hours', kind: 'number', step: '1' },
    { key: 'cost', label: 'Cost ($)', kind: 'number', step: '0.01' },
    { key: 'notes', label: 'What was done / notes', kind: 'textarea' },
  ]
  const err = save.error ?? del.error

  return (
    <section className="mt-4 rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-gray-700">
          <History className="h-4 w-4 text-brand-700" /> Service history
        </h2>
        <span className="text-xs text-gray-400">{rows.length}</span>
        {canAdd && (
          <span className="ml-auto">
            <AddButton
              label="Record a service"
              onClick={() => {
                save.reset()
                setEditing('new')
              }}
            />
          </span>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-gray-400">Nothing recorded yet. &ldquo;Done&rdquo; on the schedule above records a service here.</p>
      ) : (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[480px] text-sm">
            <thead className="text-left text-[10px] uppercase tracking-wide text-gray-400">
              <tr>
                <th className="w-5" />
                <th className="py-1 font-medium">Date</th>
                <th className="py-1 font-medium">What</th>
                <th className="py-1 text-right font-medium">Hours</th>
                <th className="py-1 text-right font-medium">Cost</th>
                <th className="py-1 pl-3 font-medium">By</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {shown.map((r) => {
                const isOpen = open === r.id
                return (
                  <Fragment key={r.id}>
                    <tr className={cn('cursor-pointer hover:bg-gray-50', isOpen && 'bg-gray-50')} onClick={rowClick(() => setOpen(isOpen ? null : r.id))}>
                      <td>
                        <ChevronRight className={cn('h-3.5 w-3.5 text-gray-400 transition-transform', isOpen && 'rotate-90')} />
                      </td>
                      <td className="py-1.5 whitespace-nowrap text-gray-700">{day(r.done_on)}</td>
                      <td className="py-1.5 text-gray-900">
                        {what(r)}
                        {r.notes && <span className="ml-1.5 text-xs text-gray-400">{r.notes.length > 40 ? `${r.notes.slice(0, 40)}…` : r.notes}</span>}
                      </td>
                      <td className="py-1.5 text-right tabular-nums text-gray-600">{r.engine_hours != null ? Math.round(Number(r.engine_hours)).toLocaleString('en-CA') : '—'}</td>
                      <td className="py-1.5 text-right tabular-nums text-gray-600">{money(r.cost) ?? '—'}</td>
                      <td className="py-1.5 pl-3 text-gray-500">{r.done_by ? (userName.get(r.done_by) ?? '—') : '—'}</td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-gray-50/60">
                        <td />
                        <td colSpan={5} className="pb-2 pt-1">
                          <DetailList
                            className="text-xs"
                            rows={[
                              ['Done on', day(r.done_on)],
                              ['What', what(r)],
                              ['Engine hours', r.engine_hours != null ? Math.round(Number(r.engine_hours)).toLocaleString('en-CA') : null],
                              ['Cost', money(r.cost)],
                              ['Notes', r.notes],
                              ['Recorded by', r.done_by ? (userName.get(r.done_by) ?? null) : null],
                              ['Recorded', new Date(r.created_at).toLocaleString('en-CA')],
                            ]}
                          />
                          {canEdit && (
                            <div className="mt-1.5">
                              <EditButton
                                onClick={() => {
                                  save.reset()
                                  del.reset()
                                  setEditing(r)
                                }}
                              />
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
          {rows.length > 10 && (
            <button type="button" onClick={() => setAll((a) => !a)} className="mt-1 text-xs text-brand-700 underline">
              {all ? 'show fewer' : `show all ${rows.length}`}
            </button>
          )}
        </div>
      )}
      {editing && (
        <RecordEditModal
          title={editing === 'new' ? `Record a service — ${equipment.name ?? 'machine'}` : `Service — ${day(editing.done_on)}`}
          fields={fields}
          row={
            editing === 'new'
              ? { done_on: new Date().toLocaleDateString('en-CA'), engine_hours: equipment.engine_hours != null ? Math.round(equipment.engine_hours) : null }
              : (editing as unknown as Record<string, unknown>)
          }
          onClose={() => setEditing(null)}
          onSave={(p) =>
            save.mutateAsync({
              id: editing === 'new' ? undefined : editing.id,
              equipment_id: equipment.id,
              plan_id: (p.plan_id as string | null) ?? null,
              was_plan_id: editing === 'new' ? null : editing.plan_id,
              done_on: String(p.done_on),
              engine_hours: p.engine_hours as number | null,
              cost: p.cost as number | null,
              notes: (p.notes as string | null) ?? null,
            })
          }
          onDelete={editing === 'new' ? undefined : () => keepOpenOnError(del.mutateAsync({ id: editing.id, plan_id: editing.plan_id }))}
          deleteConfirm={editing === 'new' ? undefined : `Delete the ${what(editing).toLowerCase()} service of ${day(editing.done_on)}? The plan's last-done moves back to the service before it.`}
          saving={save.isPending || del.isPending}
          error={err ? (err as Error).message : null}
        />
      )}
    </section>
  )
}
