import { DateField } from '@/components/DateField'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, ClipboardCheck, ClipboardPlus, ListPlus, Plus, Trash2, Wrench } from 'lucide-react'
import {
  useCreateEquipmentTask,
  useDeleteServicePlan,
  useEquipmentAlerts,
  useLogService,
  useRunServiceCheck,
  useSaveServicePlan,
  useServicePlans,
  useServiceTasks,
  type Equipment,
  type ServicePlanRow,
} from '@/lib/equipment'
import { DEFAULT_WARN_DAYS, DEFAULT_WARN_HOURS, dueLabel, dueRank, dueState, nextDueLabel, type DueState } from '@/lib/maintenance'
import { LogServiceDialog } from '@/components/LogServiceDialog'
import { ServiceAssignees, ServiceTemplatesPanel } from '@/components/EquipmentServiceSetup'
import { HelpNote } from '@/components/HelpNote'
import { cn } from '@/lib/utils'
import { staleHoursDate } from '@/lib/stale-hours'
import { askConfirm } from '@/components/askConfirm'
import { CARD_HEAD } from '@/lib/table-style'

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
    warn_within_hours: existing?.warn_within_hours?.toString() ?? String(DEFAULT_WARN_HOURS),
    warn_within_days: existing?.warn_within_days?.toString() ?? String(DEFAULT_WARN_DAYS),
    parts: existing?.parts ?? '',
    notes: existing?.notes ?? '',
  })
  const num = (v: string) => (v.trim() === '' ? null : Number(v))
  const valid = d.name.trim() && (d.interval_hours.trim() || d.interval_months.trim())
  const box = (key: keyof typeof d, label: string, opts: { type?: string; min?: string; span?: boolean; placeholder?: string } = {}) => (
    <label className={cn('text-[11px] text-gray-500', opts.span && 'col-span-2 sm:col-span-3')}>
      {label}
      <input
        type={opts.type ?? 'text'}
        min={opts.min}
        className={input}
        placeholder={opts.placeholder}
        value={d[key]}
        onChange={(e) => setD({ ...d, [key]: e.target.value })}
      />
    </label>
  )

  return (
    <div className="rounded-lg bg-brand-50/50 p-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {box('name', 'What the service is *', { span: true, placeholder: 'Engine oil and filter' })}
        {box('interval_hours', 'Every (engine hours)', { type: 'number', min: '1' })}
        {box('interval_months', '…or every (months)', { type: 'number', min: '1' })}
        <span className="hidden sm:block" />
        {box('warn_within_hours', 'Warn within (hours)', { type: 'number', min: '0' })}
        {box('warn_within_days', 'Warn within (days)', { type: 'number', min: '0' })}
        <span className="hidden sm:block" />
        {box('last_done_hours', 'Last done at (hours)', { type: 'number', min: '0' })}
        <label className="text-[11px] text-gray-500">
          Last done on
          <DateField value={d.last_done_on} onChange={(v) => setD({ ...d, last_done_on: v })} />
        </label>
        <span className="hidden sm:block" />
        {box('parts', 'Parts (optional)', { span: true, placeholder: 'Filter part numbers, oil' })}
        {box('notes', 'Notes (optional)', { span: true })}
      </div>
      <HelpNote className="mt-1.5" summary="Whichever comes first." title="Hours and months together">
        Set both intervals for “every 500 hours or once a year, whichever comes first”. A task is made when
        the machine&apos;s hours from John Deere come within the hour warning, or the date within the day
        warning. Until a last service is recorded there is nothing to measure from, and the plan will say so
        rather than guess.
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
                warn_within_hours: num(d.warn_within_hours) ?? DEFAULT_WARN_HOURS,
                warn_within_days: num(d.warn_within_days) ?? DEFAULT_WARN_DAYS,
                parts: d.parts.trim() || null,
                notes: d.notes.trim() || null,
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
 *
 * A plan coming due raises one task by itself (netlify/shared/service-due.ts,
 * after every Deere sync). Ticking that task done, or Done here, records the
 * service and moves the next due point on (both in the database).
 */
export function EquipmentMaintenance({
  equipment,
  canEdit,
  canLog,
  hoursStaleSince = null,
}: {
  equipment: Equipment
  /** When the machine's hours stopped updating (lib/stale-hours.ts): hours-based due points can't be trusted. */
  hoursStaleSince?: string | null
  /** Managers: plans, people, raising the task. */
  canEdit: boolean
  /** Anyone active may record a service as done. */
  canLog: boolean
}) {
  const { data: plans } = useServicePlans(equipment.id)
  const { data: alerts } = useEquipmentAlerts(equipment.jd_id)
  const { data: tasks } = useServiceTasks(equipment.id)
  const del = useDeleteServicePlan()
  const log = useLogService()
  const check = useRunServiceCheck()
  const createTask = useCreateEquipmentTask()
  const [adding, setAdding] = useState<'form' | 'templates' | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [logging, setLogging] = useState<string | null>(null)

  const ranked = useMemo(() => {
    return (plans ?? [])
      .map((p) => ({ plan: p, due: dueState(p, equipment.engine_hours) }))
      .sort((a, b) => dueRank(a.due.state) - dueRank(b.due.state))
  }, [plans, equipment.engine_hours])
  const taskByPlan = useMemo(() => new Map((tasks ?? []).map((t) => [t.source_ref, t])), [tasks])

  const openAlerts = (alerts ?? []).filter((a) => !a.acknowledged)

  return (
    <div className="mt-4 flex flex-col gap-4">
      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-gray-700">
            <Wrench className="h-4 w-4 text-brand-700" /> Service schedule
          </h2>
          {canEdit && !adding && (
            <>
              <button
                onClick={() => setAdding('form')}
                className="inline-flex items-center gap-0.5 text-xs font-medium text-brand-700 hover:underline"
              >
                <Plus className="h-3 w-3" /> Add
              </button>
              <button
                onClick={() => setAdding('templates')}
                className="inline-flex items-center gap-0.5 text-xs font-medium text-brand-700 hover:underline"
              >
                <ListPlus className="h-3 w-3" /> Common intervals
              </button>
            </>
          )}
        </div>
        <p className="mt-0.5 text-xs text-gray-500">
          Measured against{' '}
          {equipment.engine_hours != null
            ? `${Math.round(equipment.engine_hours).toLocaleString('en-CA')} engine hours`
            : 'the calendar — this machine reports no engine hours'}
          .
        </p>
        {hoursStaleSince && (
          <p className="mt-1 text-xs font-medium text-amber-800">
            Its hours have not updated since {staleHoursDate(hoursStaleSince)}, so a due point by hours can&apos;t be trusted.
          </p>
        )}

        {adding === 'form' && (
          <div className="mt-3">
            <PlanForm equipmentId={equipment.id} onDone={() => setAdding(null)} />
          </div>
        )}
        {adding === 'templates' && (
          <div className="mt-3">
            <ServiceTemplatesPanel
              equipment={equipment}
              existingNames={(plans ?? []).map((p) => p.name)}
              onDone={() => setAdding(null)}
            />
          </div>
        )}

        {ranked.length === 0 && !adding ? (
          <p className="mt-3 text-sm text-gray-400">
            No service plans yet{canEdit ? ' — add one, or start from the common intervals.' : '.'}
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-gray-100">
            {ranked.map(({ plan, due }) => {
              const task = taskByPlan.get(plan.id)
              const at = nextDueLabel(due)
              return editing === plan.id ? (
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
                    {at ? `next ${at} · ` : ''}
                    {dueLabel(due)}
                  </span>
                  {plan.parts && <span className="text-[11px] text-gray-400">parts: {plan.parts}</span>}
                  {hoursStaleSince && plan.interval_hours ? (
                    <span className="text-[11px] font-medium text-amber-800">hours due point can&apos;t be trusted</span>
                  ) : null}

                  <span className="ml-auto flex items-center gap-2">
                    {task && (
                      <Link to={`/tasks/${task.id}`} className="inline-flex items-center gap-1 text-xs text-brand-700 hover:underline">
                        <ClipboardCheck className="h-3.5 w-3.5" /> Task open
                      </Link>
                    )}
                    {canEdit && !task && (due.state === 'overdue' || due.state === 'due-soon') && (
                      <button
                        onClick={() => check.mutate()}
                        disabled={check.isPending}
                        title="Raise the service task now instead of at the next Deere sync"
                        className="inline-flex items-center gap-1 text-xs text-brand-700 hover:underline disabled:opacity-50"
                      >
                        <ClipboardPlus className="h-3.5 w-3.5" /> {check.isPending ? 'Raising…' : 'Raise the task'}
                      </button>
                    )}
                    {canLog && (
                      <button
                        onClick={() => setLogging(plan.id)}
                        title="Mark serviced at the hours on the meter — with a photo of it if you are at the machine"
                        className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-green-700"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" /> Done
                      </button>
                    )}
                    {canEdit && (
                      <>
                        <button
                          onClick={() => setEditing(plan.id)}
                          className="text-xs text-gray-400 hover:text-brand-700"
                        >
                          Edit
                        </button>
                        <button
                          onClick={async () => {
                            // Delete always confirms (Sam, 7 Oct 2026); the history stays, unlinked.
                            if (await askConfirm(`Delete the "${plan.name}" plan? Services already recorded stay in the history.`)) del.mutate(plan.id)
                          }}
                          aria-label={`Delete ${plan.name}`}
                          className="text-gray-300 hover:text-red-600"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </>
                    )}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
        {check.isError && <p className="mt-1 text-xs text-red-600">{(check.error as Error).message}</p>}
        {canEdit && <ServiceAssignees equipment={equipment} />}
      </section>

      {/* Deere's own diagnostics. Unlike the intervals above, these ARE the
          manufacturer's, and they say what the machine actually reported. */}
      {(alerts ?? []).length > 0 && (
        <section className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <h2 className={cn('flex items-center gap-1.5 font-medium', CARD_HEAD)}>
            <AlertTriangle className="h-4 w-4 text-amber-200" /> Machine alerts
            <span className="ml-1 text-xs font-normal text-brand-100">
              {openAlerts.length} unacknowledged of {alerts!.length}
            </span>
          </h2>
          <div className="p-4">
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

          </div>
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
