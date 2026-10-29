import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PillTabs } from '@/components/PillTabs'
import { AddButton, RecordEditModal, rowClick, type EditField } from '@/components/RecordEditor'
import { MonthlyToDo } from '@/components/monthly/MonthlyToDo'
import { hasManagerAccess, useAuth } from '@/lib/auth'
import { useTemplates } from '@/lib/checklists'
import { useTab } from '@/lib/useTab'
import { closedByMonth, jobWhen, MONTH_NAMES, MONTHS, windowLabel, ymOf } from '@/lib/monthly'
import { useActivePeople, useMonthlyJobMutations, useMonthlyJobs, useMonthlyYear, type MonthlyJobRow } from '@/lib/monthly-data'
import { useUsers } from '@/lib/queries'
import { cn } from '@/lib/utils'
import { YearSelect } from '@/components/YearSelect'
import { TABLE_HEAD } from '@/lib/table-style'

/**
 * Monthly jobs (rebuilt 24 Oct 2026): what typically needs doing in a month.
 *
 *   To do      last months' leftovers, this month, and next month on the switch
 *   Completed  what was done or skipped, by month, for any year
 *   Jobs       the master list, add / edit / delete
 *
 * `?next=1` opens the To do list with next month showing — the Monday
 * meeting's link carries it when the meeting has it on.
 */
const TABS = ['todo', 'completed', 'jobs'] as const
type Tab = (typeof TABS)[number]
const LABEL: Record<Tab, string> = { todo: 'To do', completed: 'Completed', jobs: 'Jobs' }

export function MonthlyPage() {
  const [tab, setTab] = useTab<Tab>('monthly', TABS)
  const [params] = useSearchParams()
  const [withNext, setWithNext] = useState(params.get('next') === '1')
  const now = ymOf(new Date())

  return (
    <div className="p-4 md:p-6">
      <h1 className="mb-3 text-lg font-semibold text-gray-900">Monthly jobs</h1>
      <PillTabs tabs={TABS.map((t) => ({ key: t, label: LABEL[t] }))} value={tab} onChange={setTab} className="mb-4" />
      {tab === 'todo' && (
        <>
          <label className="mb-3 flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={withNext} onChange={(e) => setWithNext(e.target.checked)} />
            Show next month too
          </label>
          <MonthlyToDo now={now} withNext={withNext} />
        </>
      )}
      {tab === 'completed' && <CompletedTab />}
      {tab === 'jobs' && <JobsTab />}
    </div>
  )
}

function CompletedTab() {
  const thisYear = new Date().getFullYear()
  const [year, setYear] = useState(thisYear)
  const { data: jobs } = useMonthlyJobs()
  const { data: copies, isLoading } = useMonthlyYear(year)
  const { data: users } = useUsers()
  const nameOf = (id: string | null) => users?.find((u) => u.id === id)?.full_name ?? 'someone'
  const groups = useMemo(() => closedByMonth(jobs ?? [], copies ?? [], year), [jobs, copies, year])
  const years = Array.from({ length: 5 }, (_, i) => thisYear - i)

  return (
    <div className="space-y-4">
      <div className="w-32">
        <YearSelect value={year} years={years} size="sm" onChange={setYear} />
      </div>
      {isLoading && <p className="text-sm text-gray-400">Loading…</p>}
      {!isLoading && groups.length === 0 && <p className="text-sm text-gray-400">Nothing done or skipped in {year} yet.</p>}
      {groups.map((g) => (
        <div key={`${g.year}-${g.month}`}>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
            {MONTH_NAMES[g.month - 1]} {g.year}
          </h3>
          <ul className="divide-y divide-gray-100 rounded-md border border-gray-100 bg-white">
            {g.items.map(({ copy, job }) => (
              <li key={copy.id} className="flex flex-wrap items-baseline gap-x-3 px-2 py-1.5 text-sm">
                <span className={cn('rounded px-1.5 text-[11px] font-semibold', copy.state === 'done' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600')}>
                  {copy.state === 'done' ? 'Done' : 'Skipped'}
                </span>
                <span className="min-w-0 flex-1 basis-48 font-medium text-gray-900">
                  {job.title}
                  {job.start_month !== job.end_month && <span className="ml-2 text-xs font-normal text-gray-400">{windowLabel(copy, job)}</span>}
                </span>
                <span className="text-xs text-gray-500">
                  {nameOf(copy.completed_by)}
                  {copy.completed_at ? `, ${new Date(copy.completed_at).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}` : ''}
                  {copy.skip_note ? ` — ${copy.skip_note}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

const REPEAT_OPTIONS = [
  { value: 'annual', label: 'Once in the window' },
  { value: 'multi_per_year', label: 'Every month in the window' },
]

function JobsTab() {
  const { profile } = useAuth()
  const isManager = hasManagerAccess(profile?.role)
  const { data: jobs } = useMonthlyJobs()
  const { data: people } = useActivePeople()
  const { data: users } = useUsers()
  const { data: checklists } = useTemplates()
  const { create, update, remove } = useMonthlyJobMutations()
  const [editing, setEditing] = useState<MonthlyJobRow | 'new' | null>(null)
  const monthOptions = MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))
  const nameOf = (id: string | null) => users?.find((u) => u.id === id)?.full_name ?? ''
  const checklistOf = (id: string | null) => checklists?.find((c) => c.id === id)?.name ?? ''

  const fields: EditField[] = [
    { key: 'title', label: 'Job', kind: 'text', required: true },
    { key: 'recurrence', label: 'Repeats', kind: 'select', options: REPEAT_OPTIONS, required: true },
    { key: 'start_month', label: 'From', kind: 'select', options: monthOptions, required: true },
    { key: 'end_month', label: 'To', kind: 'select', options: monthOptions, required: true },
    { key: 'default_assignee', label: 'Usual person', kind: 'select', options: [{ value: '', label: '—' }, ...(people ?? []).map((u) => ({ value: u.id, label: u.full_name || '—' }))] },
    { key: 'checklist_template_id', label: 'Checklist', kind: 'select', options: [{ value: '', label: '—' }, ...(checklists ?? []).map((c) => ({ value: c.id, label: c.name }))] },
    { key: 'sort_order', label: 'Order', kind: 'number', int: true },
    { key: 'active', label: 'Active', kind: 'select', options: [{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }], required: true },
    { key: 'notes_md', label: 'Notes', kind: 'textarea' },
  ]

  const toPatch = (p: Record<string, unknown>) => ({
    title: String(p.title),
    // The old 'one_time' reads as once in the window; saving keeps what was picked.
    recurrence: (p.recurrence === 'multi_per_year' ? 'multi_per_year' : 'annual') as MonthlyJobRow['recurrence'],
    start_month: Number(p.start_month),
    end_month: Number(p.end_month),
    default_assignee: (p.default_assignee as string | null) ?? null,
    checklist_template_id: (p.checklist_template_id as string | null) ?? null,
    sort_order: (p.sort_order as number | null) ?? 0,
    active: p.active !== 'false',
    notes_md: (p.notes_md as string | null) ?? null,
  })

  const row = editing === 'new' ? { recurrence: 'annual', start_month: new Date().getMonth() + 1, end_month: new Date().getMonth() + 1, active: 'true', sort_order: (jobs?.length ?? 0) + 1 } : editing
  const saving = create.isPending || update.isPending

  return (
    <div>
      {isManager && (
        <div className="mb-3 flex justify-end">
          <AddButton label="New job" onClick={() => setEditing('new')} />
        </div>
      )}
      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className={TABLE_HEAD}>
            <tr>
              <th className="px-3 py-2 font-medium">Job</th>
              <th className="px-3 py-2 font-medium">When</th>
              <th className="px-3 py-2 font-medium">Usual person</th>
              <th className="px-3 py-2 font-medium">Checklist</th>
            </tr>
          </thead>
          <tbody>
            {(jobs ?? []).map((j) => (
              <tr
                key={j.id}
                onClick={isManager ? rowClick(() => setEditing(j)) : undefined}
                className={cn('border-b border-gray-100 last:border-0', isManager && 'cursor-pointer hover:bg-gray-50', !j.active && 'text-gray-400')}
              >
                <td className="px-3 py-2">
                  <span className="font-medium">{j.title}</span>
                  {!j.active && <span className="ml-2 text-xs">off</span>}
                  {j.notes_md && <span className="block text-xs text-gray-500">{j.notes_md}</span>}
                </td>
                <td className="px-3 py-2 text-gray-600">{jobWhen(j)}</td>
                <td className="px-3 py-2 text-gray-600">{nameOf(j.default_assignee)}</td>
                <td className="px-3 py-2 text-gray-600">{checklistOf(j.checklist_template_id)}</td>
              </tr>
            ))}
            {(jobs ?? []).length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-8 text-center text-gray-400">
                  No monthly jobs yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && row && (
        <RecordEditModal
          title={editing === 'new' ? 'New monthly job' : 'Edit monthly job'}
          fields={fields}
          row={editing === 'new' ? row : { ...editing, recurrence: editing.recurrence === 'multi_per_year' ? 'multi_per_year' : 'annual', active: String(editing.active) }}
          saving={saving}
          onClose={() => setEditing(null)}
          onSave={(p) => (editing === 'new' ? create.mutateAsync(toPatch(p)) : update.mutateAsync({ id: editing.id, patch: toPatch(p) }))}
          onDelete={editing === 'new' ? undefined : () => remove.mutateAsync(editing.id)}
          deleteConfirm={editing === 'new' ? undefined : `Delete “${editing.title}”? Its record of past months goes with it. To keep the record, set Active to No instead.`}
        />
      )}
    </div>
  )
}
