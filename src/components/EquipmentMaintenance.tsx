import { DateField } from '@/components/DateField'
import { useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, ClipboardPlus, Plus, Trash2, Wrench } from 'lucide-react'
import {
  useCreateEquipmentTask,
  useDeleteServicePlan,
  useEquipmentAlerts,
  useLogService,
  useSaveServicePlan,
  useServicePlans,
  type Equipment,
  type ServicePlanRow,
} from '@/lib/equipment'
import { dueLabel, dueRank, dueState, type DueState } from '@/lib/maintenance'
import { LogServiceDialog } from '@/components/LogServiceDialog'
import { HelpNote } from '@/components/HelpNote'
import { cn } from '@/lib/utils'

const STATE_STYLE: Record<DueState, string> = {
  overdue: 'bg-red-100 text-red-800',
  'due-soon': 'bg-amber-100 text-amber-800',
  unknown: 'bg-gray-100 text-gray-500',
  ok: 'bg-green-100 text-green-800',
}
const STATE_LABEL: Record<DueState, string> = {
  overdue: 'Overdue',
  'due-soon': 'Due soon',
  unknown: 'Unknown',
  ok: 'OK',
}

const input = 'w-full rounded border border-gray-300 px-2 py-1 text-sm'

function PlanForm({
  equipmentId,
  existing,
  onDone,
}: {
  equipmentId: string
  existing?: ServicePlanRow
  onDone: () => void
}) {
  const save = useSaveServicePlan()
  const [d, setD] = useState({
    name: existing?.name ?? '',
    interval_hours: existing?.interval_hours?.toString() ?? '',
    interval_months: existing?.interval_months?.toString() ?? '',
    last_done_hours: existing?.last_done_hours?.toString() ?? '',
    last_done_on: existing?.last_done_on ?? '',
    warn_within_hours: existing?.warn_within_hours?.toString() ?? '50',
  })
  const num = (v: string) => (v.trim() === '' ? null : Number(v))
  const valid = d.name.trim() && (d.interval_hours.trim() || d.interval_months.trim())

  return (
    <div className="rounded-lg bg-brand-50/50 p-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <label className="text-[11px] text-gray-500 sm:col-span-3">
          What the service is *
          <input
            className={input}
            placeholder="Engine oil and filter"
            value={d.name}
            onChange={(e) => setD({ ...d, name: e.target.value })}
          />
        </label>
        <label className="text-[11px] text-gray-500">
          Every (engine hours)
          <input
            type="number"
            min="1"
            className={input}
            value={d.interval_hours}
            onChange={(e) => setD({ ...d, interval_hours: e.target.value })}
          />
        </label>
        <label className="text-[11px] text-gray-500">
          …or every (months)
          <input
            type="number"
            min="1"
            className={input}
            value={d.interval_months}
            onChange={(e) => setD({ ...d, interval_months: e.target.value })}
          />
        </label>
        <label className="text-[11px] text-gray-500">
          Warn within (hours)
          <input
            type="number"
            min="0"
            className={input}
            value={d.warn_within_hours}
            onChange={(e) => setD({ ...d, warn_within_hours: e.target.value })}
          />
        </label>
        <label className="text-[11px] text-gray-500">
          Last done at (hours)
          <input
            type="number"
            min="0"
            className={input}
            value={d.last_done_hours}
            onChange={(e) => setD({ ...d, last_done_hours: e.target.value })}
          />
        </label>
        <label className="text-[11px] text-gray-500">
          Last done on
          <DateField value={d.last_done_on} onChange={(v) => setD({ ...d, last_done_on: v })} />
        </label>
      </div>
      <HelpNote className="mt-1.5" summary="Whichever comes first." title="Hours and months together">
        Set both intervals for “every 500 hours or once a year, whichever comes first”. Until a last
        service is recorded there is nothing to measure from, and the plan will say so rather than
        guess.
      </HelpNote>
      <div className="mt-2 flex gap-2">
        <button
          disabled={!valid || save.isPending}
          onClick={() =>
            save.mutate(
              {
                id: existing?.id,
                equipment_id: equipmentId,
                name: d.name.trim(),
                interval_hours: num(d.interval_hours),
                interval_months: num(d.interval_months),
                last_done_hours: num(d.last_done_hours),
                last_done_on: d.last_done_on || null,
                warn_within_hours: Number(d.warn_within_hours || 50),
              },
              { onSuccess: onDone },
            )
          }
          className="rounded-md bg-brand-700 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
        >
          Save
        </button>
        <button
          onClick={onDone}
          className="rounded-md border border-gray-300 px-3 py-1 text-xs text-gray-600"
        >
          Cancel
        </button>
        {save.isError && (
          <span className="self-center text-xs text-red-600">{(save.error as Error).message}</span>
        )}
      </div>
    </div>
  )
}

/**
 * Service plans and machine alerts for one machine.
 *
 * The intervals are Prairie Creek's own. Deere will not share its recommended plans
 * with this app — every maintenancePlans endpoint answers 403 or 404 — so the
 * card says whose numbers these are rather than letting them be mistaken for
 * the manufacturer's.
 */
export function EquipmentMaintenance({
  equipment,
  canEdit,
}: {
  equipment: Equipment
  canEdit: boolean
}) {
  const { data: plans } = useServicePlans(equipment.id)
  const { data: alerts } = useEquipmentAlerts(equipment.jd_id)
  const del = useDeleteServicePlan()
  const log = useLogService()
  const createTask = useCreateEquipmentTask()
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [logging, setLogging] = useState<string | null>(null)

  const ranked = useMemo(() => {
    return (plans ?? [])
      .map((p) => ({ plan: p, due: dueState(p, equipment.engine_hours) }))
      .sort((a, b) => dueRank(a.due.state) - dueRank(b.due.state))
  }, [plans, equipment.engine_hours])

  const openAlerts = (alerts ?? []).filter((a) => !a.acknowledged)

  return (
    <div className="mt-4 flex flex-col gap-4">
      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-gray-700">
            <Wrench className="h-4 w-4 text-brand-700" /> Service schedule
          </h2>
          {canEdit && !adding && (
            <button
              onClick={() => setAdding(true)}
              className="inline-flex items-center gap-0.5 text-xs font-medium text-brand-700 hover:underline"
            >
              <Plus className="h-3 w-3" /> Add
            </button>
          )}
        </div>
        <p className="mt-0.5 text-xs text-gray-500">
          Service intervals, measured against{' '}
          {equipment.engine_hours != null
            ? `${Math.round(equipment.engine_hours).toLocaleString('en-CA')} engine hours`
            : 'the calendar — this machine reports no engine hours'}
          .
        </p>

        {adding && (
          <div className="mt-3">
            <PlanForm equipmentId={equipment.id} onDone={() => setAdding(false)} />
          </div>
        )}

        {ranked.length === 0 && !adding ? (
          <p className="mt-3 text-sm text-gray-400">
            No service plans yet{canEdit ? ' — add the first one above.' : '.'}
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-gray-100">
            {ranked.map(({ plan, due }) =>
              editing === plan.id ? (
                <li key={plan.id} className="py-2">
                  <PlanForm
                    equipmentId={equipment.id}
                    existing={plan}
                    onDone={() => setEditing(null)}
                  />
                </li>
              ) : (
                <li key={plan.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2">
                  <span
                    className={cn(
                      'rounded-full px-2 py-0.5 text-[11px] font-medium',
                      STATE_STYLE[due.state],
                    )}
                  >
                    {STATE_LABEL[due.state]}
                  </span>
                  <span className="font-medium text-gray-800">{plan.name}</span>
                  <span className="text-xs text-gray-500">
                    every{' '}
                    {[
                      plan.interval_hours ? `${plan.interval_hours} h` : null,
                      plan.interval_months ? `${plan.interval_months} mo` : null,
                    ]
                      .filter(Boolean)
                      .join(' or ')}
                  </span>
                  <span
                    className={cn(
                      'text-xs tabular-nums',
                      due.state === 'overdue' ? 'font-medium text-red-700' : 'text-gray-600',
                    )}
                    title={due.reason}
                  >
                    {dueLabel(due)}
                  </span>

                  {canEdit && (
                    <span className="ml-auto flex items-center gap-2">
                      {(due.state === 'overdue' || due.state === 'due-soon') && (
                        <button
                          onClick={() =>
                            createTask.mutate({
                              title: `${plan.name} — ${equipment.name ?? 'machine'}`,
                              description: [
                                `${plan.name} on ${equipment.name ?? 'this machine'}.`,
                                `Status: ${STATE_LABEL[due.state]} (${dueLabel(due)}).`,
                                equipment.engine_hours != null
                                  ? `Engine hours at time of raising: ${Math.round(equipment.engine_hours)}.`
                                  : 'This machine reports no engine hours.',
                              ].join('\n\n'),
                            })
                          }
                          className="inline-flex items-center gap-1 text-xs text-brand-700 hover:underline"
                        >
                          <ClipboardPlus className="h-3.5 w-3.5" /> Make a task
                        </button>
                      )}
                      <button
                        onClick={() => setLogging(plan.id)}
                        title="Record this as done — with a photo of the hour meter if you are at the machine"
                        className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-green-700"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" /> Done
                      </button>
                      <button
                        onClick={() => setEditing(plan.id)}
                        className="text-xs text-gray-400 hover:text-brand-700"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => {
                          // Delete always confirms (Sam, 7 Oct 2026); the history stays, unlinked.
                          if (window.confirm(`Delete the "${plan.name}" plan? Services already recorded stay in the history.`)) del.mutate(plan.id)
                        }}
                        aria-label={`Delete ${plan.name}`}
                        className="text-gray-300 hover:text-red-600"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  )}
                </li>
              ),
            )}
          </ul>
        )}
      </section>

      {/* Deere's own diagnostics. Unlike the intervals above, these ARE the
          manufacturer's, and they say what the machine actually reported. */}
      {(alerts ?? []).length > 0 && (
        <section className="rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-gray-700">
            <AlertTriangle className="h-4 w-4 text-amber-600" /> Machine alerts
            <span className="ml-1 text-xs font-normal text-gray-400">
              {openAlerts.length} unacknowledged of {alerts!.length}
            </span>
          </h2>
          <p className="mt-0.5 text-xs text-gray-500">
            Reported by the machine itself, from John Deere.
          </p>
          <ul className="mt-3 divide-y divide-gray-100">
            {alerts!.slice(0, 15).map((a) => (
              <li key={a.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 text-sm">
                <span className="text-gray-800">{a.description ?? a.code ?? 'Alert'}</span>
                {a.severity && a.severity !== 'NONE' && (
                  <span className="rounded bg-amber-100 px-1.5 text-[10px] font-medium text-amber-800">
                    {a.severity.toLowerCase()}
                  </span>
                )}
                <span className="text-xs text-gray-500">
                  {a.occurred_at ? new Date(a.occurred_at).toLocaleDateString('en-CA') : '—'}
                  {a.engine_hours != null && ` · ${Math.round(a.engine_hours)} h`}
                </span>
                {canEdit && !a.task_id && (
                  <button
                    onClick={() =>
                      createTask.mutate({
                        title: `${a.description ?? a.code ?? 'Alert'} — ${equipment.name ?? 'machine'}`,
                        description: [
                          `John Deere reported this on ${equipment.name ?? 'the machine'}.`,
                          a.description ?? '',
                          a.occurred_at ? `First seen ${new Date(a.occurred_at).toLocaleString('en-CA')}.` : '',
                          a.engine_hours != null ? `At ${Math.round(a.engine_hours)} engine hours.` : '',
                        ]
                          .filter(Boolean)
                          .join('\n\n'),
                        alertId: a.id,
                      })
                    }
                    className="ml-auto inline-flex items-center gap-1 text-xs text-brand-700 hover:underline"
                  >
                    <ClipboardPlus className="h-3.5 w-3.5" /> Make a task
                  </button>
                )}
                {a.task_id && <span className="ml-auto text-xs text-gray-400">task raised</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {logging && (() => {
        const plan = plans?.find((p) => p.id === logging)
        if (!plan) return null
        return (
          <LogServiceDialog
            planName={plan.name}
            machineName={equipment.name ?? 'machine'}
            hoursNow={equipment.engine_hours}
            saving={log.isPending}
            onClose={() => setLogging(null)}
            onSave={(v) =>
              log.mutate(
                { equipment_id: equipment.id, plan_id: plan.id, ...v },
                { onSuccess: () => setLogging(null) },
              )
            }
          />
        )
      })()}
    </div>
  )
}
