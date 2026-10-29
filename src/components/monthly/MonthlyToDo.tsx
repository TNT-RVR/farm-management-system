import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Check, ClipboardList, Undo2, UserPlus } from 'lucide-react'
import { Modal } from '@/components/Modal'
import { AvatarStack } from '@/components/UserAvatar'
import { useTasks } from '@/lib/tasks'
import {
  assigneesOf,
  fromYm,
  MONTH_NAMES,
  tasksByCopy,
  windowLabel,
  windowOf,
  type ListItem,
} from '@/lib/monthly'
import {
  useActivePeople,
  useAssignCopy,
  useMonthlyToDo,
  useSetCopyState,
  useStartCopyChecklist,
  type MonthlyCopyRow,
  type MonthlyJobRow,
} from '@/lib/monthly-data'
import { cn } from '@/lib/utils'

/**
 * The monthly To do list: last months' leftovers, this month, and next month
 * when asked. The Monthly page shows it whole; the Monday meeting shows it
 * `compact` — Assign and Done only (Sam, 24 Oct 2026: "easily and quickly
 * assign to everyone").
 *
 * Done and skipped jobs stay on their month's list, greyed and ticked, until
 * the month is over: "when a user checks it off on their side it checks it
 * off on the list but doesn't remove it from the list".
 */

type Item = ListItem<MonthlyCopyRow, MonthlyJobRow>
type Person = { id: string; full_name: string | null; avatar_url: string | null }

const shortDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }) : '')
const monthTitle = (n: number) => {
  const { year, month } = fromYm(n)
  return `${MONTH_NAMES[month - 1]} ${year}`
}

export function MonthlyToDo({ now, withNext, compact = false }: { now: number; withNext: boolean; compact?: boolean }) {
  const { lists, isLoading, error } = useMonthlyToDo(now)
  const { data: tasks } = useTasks()
  const { data: people } = useActivePeople()
  const byCopy = useMemo(() => tasksByCopy(tasks ?? []), [tasks])
  const [assigning, setAssigning] = useState<Item | null>(null)
  const [skipping, setSkipping] = useState<Item | null>(null)

  if (isLoading) return <p className="text-sm text-gray-400">Loading…</p>
  if (error) return <p className="text-sm text-red-700">Could not load the monthly jobs: {error.message}</p>

  const personOf = new Map((people ?? []).map((p) => [p.id, p]))
  const row = (i: Item, leftover = false) => (
    <JobRow
      key={i.copy.id}
      item={i}
      leftover={leftover}
      compact={compact}
      assignees={assigneesOf(byCopy.get(i.copy.id)).map((id) => personOf.get(id) ?? { id, full_name: null, avatar_url: null })}
      nameOf={(id) => (id ? (personOf.get(id)?.full_name ?? 'someone') : 'someone')}
      onAssign={() => setAssigning(i)}
      onSkip={() => setSkipping(i)}
    />
  )
  const sections: { key: string; title: string; items: Item[]; leftover?: boolean; empty: string }[] = [
    ...(lists.leftovers.length ? [{ key: 'left', title: 'Still to do from earlier months', items: lists.leftovers, leftover: true, empty: '' }] : []),
    { key: 'this', title: monthTitle(now), items: lists.thisMonth, empty: 'No jobs due this month.' },
    ...(withNext ? [{ key: 'next', title: monthTitle(now + 1), items: lists.nextMonth, empty: 'Nothing new due next month.' }] : []),
  ]

  return (
    <div className="space-y-4">
      {sections.map((s) => {
        const done = s.items.filter((i) => i.copy.state !== 'todo').length
        return (
          <div key={s.key}>
            <div className={cn('mb-1 flex items-baseline gap-2', s.leftover && 'text-amber-800')}>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">{s.title}</h3>
              {!s.leftover && s.items.length > 0 && (
                <span className="text-[11px] text-gray-400">
                  {done} of {s.items.length} done
                </span>
              )}
            </div>
            {s.items.length === 0 ? (
              <p className="text-sm text-gray-400">{s.empty}</p>
            ) : (
              <ul className="divide-y divide-gray-100 rounded-md border border-gray-100">{s.items.map((i) => row(i, s.leftover))}</ul>
            )}
          </div>
        )
      })}
      {assigning && <AssignDialog item={assigning} people={people ?? []} already={assigneesOf(byCopy.get(assigning.copy.id))} onClose={() => setAssigning(null)} />}
      {skipping && <SkipDialog item={skipping} onClose={() => setSkipping(null)} />}
    </div>
  )
}

function JobRow({
  item,
  leftover,
  compact,
  assignees,
  nameOf,
  onAssign,
  onSkip,
}: {
  item: Item
  leftover: boolean
  compact: boolean
  assignees: Person[]
  nameOf: (id: string | null) => string
  onAssign: () => void
  onSkip: () => void
}) {
  const { copy, job } = item
  const setState = useSetCopyState()
  const start = useStartCopyChecklist()
  const navigate = useNavigate()
  const closed = copy.state !== 'todo'
  const wide = windowOf(copy, job)
  const when = leftover || wide.start !== wide.end ? windowLabel(copy, job, leftover) : null

  return (
    <li className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 px-2 py-1.5 text-sm', closed && 'bg-gray-50')}>
      <button
        type="button"
        onClick={() => setState.mutate({ id: copy.id, state: closed ? 'todo' : 'done' })}
        disabled={setState.isPending}
        aria-label={closed ? `Undo ${job.title}` : `Mark ${job.title} done`}
        title={closed ? 'Back to to do' : 'Done'}
        className={cn(
          'flex h-5 w-5 shrink-0 items-center justify-center rounded border',
          copy.state === 'done' ? 'border-green-600 bg-green-600 text-white' : copy.state === 'skipped' ? 'border-gray-300 bg-gray-200 text-gray-500' : 'border-gray-300 hover:border-brand-600',
        )}
      >
        {copy.state === 'done' && <Check className="h-3.5 w-3.5" />}
        {copy.state === 'skipped' && <span className="text-[10px] font-bold">–</span>}
      </button>
      <div className="min-w-0 flex-1">
        <span className={cn('font-medium text-gray-900', closed && 'text-gray-400 line-through decoration-gray-300')}>{job.title}</span>
        {when && <span className={cn('ml-2 text-xs', leftover ? 'text-amber-700' : 'text-gray-400')}>{when}</span>}
        {copy.state === 'done' && (
          <span className="ml-2 text-xs text-green-700">
            Done by {nameOf(copy.completed_by)}, {shortDate(copy.completed_at)}
          </span>
        )}
        {copy.state === 'skipped' && (
          <span className="ml-2 text-xs text-gray-500">
            Skipped by {nameOf(copy.completed_by)}, {shortDate(copy.completed_at)}
            {copy.skip_note ? ` — ${copy.skip_note}` : ''}
          </span>
        )}
        {!compact && job.notes_md && !closed && <span className="block text-xs text-gray-500">{job.notes_md}</span>}
      </div>
      <AvatarStack people={assignees} size="xs" />
      <div className="flex shrink-0 items-center gap-1 print:hidden">
        {!closed && (
          <button type="button" onClick={onAssign} className="flex items-center gap-1 rounded-md border border-gray-200 px-2 py-0.5 text-xs text-gray-700 hover:bg-gray-50">
            <UserPlus className="h-3.5 w-3.5" /> Assign
          </button>
        )}
        {!compact && job.checklist_template_id && (
          copy.checklist_run_id ? (
            <Link to={`/checklists/runs/${copy.checklist_run_id}`} className="flex items-center gap-1 rounded-md border border-gray-200 px-2 py-0.5 text-xs text-brand-700 hover:bg-gray-50">
              <ClipboardList className="h-3.5 w-3.5" /> Checklist
            </Link>
          ) : (
            !closed && (
              <button
                type="button"
                disabled={start.isPending}
                onClick={() => start.mutate(copy.id, { onSuccess: (runId) => navigate(`/checklists/runs/${runId}`) })}
                className="flex items-center gap-1 rounded-md border border-gray-200 px-2 py-0.5 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                <ClipboardList className="h-3.5 w-3.5" /> Start checklist
              </button>
            )
          )
        )}
        {!compact && !closed && (
          <button type="button" onClick={onSkip} className="rounded-md border border-gray-200 px-2 py-0.5 text-xs text-gray-500 hover:bg-gray-50">
            Skip
          </button>
        )}
        {closed && (
          <button
            type="button"
            onClick={() => setState.mutate({ id: copy.id, state: 'todo' })}
            className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          >
            <Undo2 className="h-3.5 w-3.5" /> Undo
          </button>
        )}
      </div>
      {(setState.error || start.error) && <p className="w-full text-xs text-red-700">{((setState.error ?? start.error) as Error).message}</p>}
    </li>
  )
}

/** Hand a job to one or more people: a task each, due the end of the job's month. */
function AssignDialog({ item, people, already, onClose }: { item: Item; people: Person[]; already: string[]; onClose: () => void }) {
  const assign = useAssignCopy()
  const [picked, setPicked] = useState<string[]>(() =>
    already.length === 0 && item.job.default_assignee && people.some((p) => p.id === item.job.default_assignee) ? [item.job.default_assignee] : [],
  )
  const { year, month } = fromYm(item.end)
  const due = new Date(year, month, 0).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })
  return (
    <Modal title={`Assign — ${item.job.title}`} onClose={onClose}>
      <p className="mb-2 text-xs text-gray-500">Each person gets their own task, due {due}. When any of them ticks it, the job is done.</p>
      <ul className="max-h-72 space-y-1 overflow-y-auto">
        {people.map((p) => {
          const has = already.includes(p.id)
          return (
            <li key={p.id}>
              <label className={cn('flex items-center gap-2 rounded px-1 py-1 text-sm', has ? 'text-gray-400' : 'hover:bg-gray-50')}>
                <input
                  type="checkbox"
                  disabled={has}
                  checked={has || picked.includes(p.id)}
                  onChange={(e) => setPicked((x) => (e.target.checked ? [...x, p.id] : x.filter((id) => id !== p.id)))}
                />
                {p.full_name || 'Unnamed'}
                {has && <span className="text-xs">has it</span>}
              </label>
            </li>
          )
        })}
      </ul>
      {assign.error && <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{(assign.error as Error).message}</p>}
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">
          Cancel
        </button>
        <button
          type="button"
          disabled={picked.length === 0 || assign.isPending}
          onClick={() => assign.mutate({ id: item.copy.id, userIds: picked }, { onSuccess: onClose })}
          className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
        >
          {assign.isPending ? 'Assigning…' : picked.length > 1 ? `Assign ${picked.length} people` : 'Assign'}
        </button>
      </div>
    </Modal>
  )
}

function SkipDialog({ item, onClose }: { item: Item; onClose: () => void }) {
  const setState = useSetCopyState()
  const [note, setNote] = useState('')
  return (
    <Modal title={`Skip — ${item.job.title}`} onClose={onClose}>
      <label className="block text-xs font-medium text-gray-500">
        Why (optional)
        <textarea
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          placeholder="Not needed this year"
        />
      </label>
      {setState.error && <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{(setState.error as Error).message}</p>}
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">
          Cancel
        </button>
        <button
          type="button"
          disabled={setState.isPending}
          onClick={() => setState.mutate({ id: item.copy.id, state: 'skipped', note }, { onSuccess: onClose })}
          className="rounded-md bg-gray-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-50"
        >
          Skip
        </button>
      </div>
    </Modal>
  )
}
