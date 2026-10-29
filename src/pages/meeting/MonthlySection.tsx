import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarCheck, Users } from 'lucide-react'
import { MonthlyToDo } from '@/components/monthly/MonthlyToDo'
import { UserAvatar } from '@/components/UserAvatar'
import { outstanding, taskLoad } from '@/lib/monthly'
import { useActivePeople, useMonthlyToDo } from '@/lib/monthly-data'
import type { TaskRow } from '@/lib/tasks'
import { cn } from '@/lib/utils'

/**
 * The Monday meeting's monthly jobs (Sam, 24 Oct 2026): leftovers from
 * earlier months first, then this month, then next month on the switch, each
 * with a quick Assign and Done. The link opens the Monthly page on the same
 * months.
 */
export function MonthlySection({ now }: { now: number }) {
  const [withNext, setWithNext] = useState(false)
  const { lists } = useMonthlyToDo(now)
  const left = outstanding(lists, withNext).length
  return (
    <section className="break-inside-avoid rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <CalendarCheck className={cn('h-4 w-4', left ? 'text-amber-600' : 'text-gray-400')} />
        <h2 className="text-sm font-semibold text-gray-800">Monthly jobs</h2>
        <span className={cn('rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums', left ? 'bg-amber-100 text-amber-900' : 'bg-gray-100 text-gray-600')}>{left}</span>
        <label className="ml-3 flex items-center gap-1 text-xs text-gray-600 print:hidden">
          <input type="checkbox" checked={withNext} onChange={(e) => setWithNext(e.target.checked)} /> Next month too
        </label>
        <Link to={`/monthly?tab=todo${withNext ? '&next=1' : ''}`} className="ml-auto text-xs text-brand-700 hover:underline print:hidden">
          Monthly →
        </Link>
      </div>
      <MonthlyToDo now={now} withNext={withNext} compact />
    </section>
  )
}

/** Open and overdue tasks for each active person — who has room this week. */
export function TasksByPerson({ tasks }: { tasks: TaskRow[] }) {
  const { data: people } = useActivePeople()
  // Steps of a job are counted with their job, not as more jobs.
  const rows = taskLoad(tasks.filter((t) => !t.parent_task_id), (people ?? []).map((p) => p.id), new Date())
  const personOf = new Map((people ?? []).map((p) => [p.id, p]))
  return (
    <section className="break-inside-avoid rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-2 flex items-center gap-1.5">
        <Users className="h-4 w-4 text-gray-400" />
        <h2 className="text-sm font-semibold text-gray-800">Tasks by person</h2>
        <Link to="/tasks" className="ml-auto text-xs text-brand-700 hover:underline print:hidden">
          Tasks →
        </Link>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-gray-400">No one to show.</p>
      ) : (
        <ul className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
          {rows.map((r) => {
            const p = personOf.get(r.userId)
            return (
              <li key={r.userId} className="flex items-center gap-2 py-0.5 text-sm">
                {p && <UserAvatar person={p} size="xs" />}
                <span className="min-w-0 flex-1 truncate text-gray-900">{p?.full_name || 'Unnamed'}</span>
                <span className="tabular-nums text-gray-700">{r.open} open</span>
                <span className={cn('w-20 text-right tabular-nums text-xs', r.overdue ? 'font-semibold text-amber-700' : 'text-gray-400')}>{r.overdue} overdue</span>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
