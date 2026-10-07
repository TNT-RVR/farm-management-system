import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { hasManagerAccess, useAuth } from '@/lib/auth'
import { useUsers } from '@/lib/queries'
import { useCheckRunItem, useRun, useRunItems, useTemplates, type RunItemRow } from '@/lib/checklists'
import { RunMap } from './checklists/RunMap'
import { AddJob } from './checklists/AddJob'
import { cn } from '@/lib/utils'

function RunItem({
  item,
  runId,
  canCheck,
  userName,
}: {
  item: RunItemRow
  runId: string
  canCheck: boolean
  userName: (id: string | null) => string
}) {
  const check = useCheckRunItem(runId)
  const [note, setNote] = useState(item.note ?? '')
  const noteMissing = item.requires_note && item.checked && !item.note

  return (
    <li className="py-3">
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          disabled={!canCheck}
          checked={item.checked}
          onChange={(e) => check.mutate({ itemId: item.id, checked: e.target.checked })}
          className="mt-0.5 h-4 w-4 shrink-0"
        />
        <div className="min-w-0 flex-1">
          <span className={cn('text-sm', item.checked && 'text-gray-400 line-through')}>
            {item.item_text_snapshot}
          </span>
          {item.checked && item.checked_by && (
            <span className="ml-2 text-xs text-gray-400">
              {userName(item.checked_by)}
              {item.checked_at
                ? ` · ${new Date(item.checked_at).toLocaleDateString('en-CA', {
                    month: 'short',
                    day: 'numeric',
                  })}`
                : ''}
            </span>
          )}
          {item.requires_note && (
            <input
              disabled={!canCheck}
              value={note}
              placeholder="Note required"
              onChange={(e) => setNote(e.target.value)}
              onBlur={() => {
                if (note !== (item.note ?? '')) check.mutate({ itemId: item.id, note: note || null })
              }}
              className={cn(
                'mt-1 w-full rounded-md border px-2 py-1 text-sm',
                noteMissing ? 'border-red-400 bg-white' : 'border-gray-200',
              )}
            />
          )}
        </div>
      </div>
    </li>
  )
}

export function ChecklistRunPage() {
  const { id } = useParams<{ id: string }>()
  const { profile } = useAuth()
  const { data: run } = useRun(id)
  const { data: items } = useRunItems(id)
  const { data: users } = useUsers()
  const { data: templates } = useTemplates()

  const userName = (uid: string | null) => users?.find((u) => u.id === uid)?.full_name ?? '—'

  if (!run) {
    return <div className="p-6 text-sm text-gray-500">{run === null ? 'Not found.' : 'Loading…'}</div>
  }

  const isAssignee = profile ? run.assigned_to.includes(profile.id) : false
  // A map checklist is ticked by whoever is out there (the database allows
  // any active user on those; see checklist_run_is_map).
  const mapBased = Boolean(templates?.find((t) => t.id === run.template_id)?.map_based)
  const canCheck = hasManagerAccess(profile?.role) || isAssignee || (mapBased && Boolean(profile?.active))
  const done = items?.filter((i) => i.checked).length ?? 0
  const total = items?.length ?? 0
  const pct = total ? Math.round((done / total) * 100) : 0

  return (
    <div className={cn('mx-auto p-4 md:p-6', mapBased ? 'max-w-6xl' : 'max-w-2xl')}>
      <Link
        to="/checklists"
        className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800"
      >
        <ArrowLeft className="h-4 w-4" /> Checklists
      </Link>

      <div className="mt-3 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-bold text-gray-900">{run.name}</h1>
        <span
          className={cn(
            'rounded-full px-2.5 py-0.5 text-xs font-medium',
            run.status === 'done' ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800',
          )}
        >
          {run.status === 'done' ? 'Complete' : 'In progress'}
        </span>
      </div>

      <p className="mt-1 text-sm text-gray-500">
        {run.crop_year}
        {mapBased ? ' · anyone can tick these off' : <> · Assigned to {run.assigned_to.length ? run.assigned_to.map(userName).join(', ') : 'no one'}</>}
        {run.due_at
          ? ` · due ${new Date(run.due_at).toLocaleDateString('en-CA', {
              month: 'short',
              day: 'numeric',
            })}`
          : ''}
      </p>

      <div className="mt-3">
        <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
          <div
            className={cn('h-full rounded-full', pct === 100 ? 'bg-green-500' : 'bg-brand-600')}
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="mt-1 text-xs text-gray-500">
          {done} / {total} done
        </p>
      </div>

      {mapBased && items && (
        <div className="mt-4">
          <RunMap run={run} items={items} userName={userName} />
        </div>
      )}

      {!mapBased && !canCheck && (
        <p className="mt-3 rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-500">
          You’re not assigned to this run — read only.
        </p>
      )}

      {!mapBased && <ul className="mt-3 divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white px-4">
        {items?.map((item) => (
          <RunItem
            key={item.id}
            item={item}
            runId={run.id}
            canCheck={canCheck}
            userName={userName}
          />
        ))}
      </ul>}
      {!mapBased && hasManagerAccess(profile?.role) && <AddJob runId={run.id} templateId={run.template_id} runLocationId={null} keeps={Boolean(run.template_id)} />}
    </div>
  )
}
