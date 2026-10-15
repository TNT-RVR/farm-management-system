import { supabase } from '@/lib/supabase'
import { ACTIVE_GRANT_STATUSES, GRANT_STATUSES, GRANT_STATUS_LABEL, moneyRange, type GrantStatus } from '@/lib/grants'
import { fetchAll, type Cell, type GatherContext, type ParamValues, type ReportData, type ReportGroup } from './framework'

/**
 * Grant applications and deadlines: a group per status (the order the
 * Grants page works through them), each grant with its funder, what it
 * pays, when it opens and closes, the days left, and the next open task on
 * it (grant work items are ordinary tasks with source 'grant').
 */

export type GrantLite = {
  id: string
  title: string
  funder: string | null
  status: GrantStatus
  amount_min: unknown
  amount_max: unknown
  opens_on: string | null
  closes_on: string | null
  assigned_to: string | null
  url: string | null
}
export type GrantTaskLite = { title: string; due_at: string | null; status: string; source_ref: string | null; assignee_ids: string[] | null }

export const GRANT_FILTERS: Record<string, GrantStatus[]> = {
  active: ACTIVE_GRANT_STATUSES,
  applied: ['submitted', 'awarded', 'declined'],
  all: GRANT_STATUSES,
}

export const GRANT_COLUMNS = [{ label: 'Grant' }, { label: 'Funder' }, { label: 'Amount' }, { label: 'Opens' }, { label: 'Deadline' }, { label: 'Days left', decimals: 0 }, { label: 'Next task' }, { label: 'On it' }]

const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000)

export function grantGroups(grants: GrantLite[], tasks: GrantTaskLite[], who: Map<string, string>, statuses: GrantStatus[], today: string): ReportGroup[] {
  const nextTask = (id: string) =>
    tasks
      .filter((t) => t.source_ref === id && t.status !== 'done')
      .sort((a, b) => (a.due_at ?? '9999').localeCompare(b.due_at ?? '9999'))[0] ?? null
  const num = (v: unknown) => (v == null || v === '' ? null : Number(v))
  return statuses
    .map((s) => {
      const list = grants
        .filter((g) => g.status === s)
        .sort((a, b) => (a.closes_on ?? '9999').localeCompare(b.closes_on ?? '9999') || a.title.localeCompare(b.title))
      const rows: Cell[][] = list.map((g) => {
        const t = nextTask(g.id)
        const people = [...new Set([g.assigned_to, ...(t?.assignee_ids ?? [])].filter((x): x is string => !!x))].map((id) => who.get(id) ?? 'someone')
        const left = g.closes_on ? daysBetween(today, g.closes_on) : null
        return [
          g.title,
          g.funder,
          moneyRange(num(g.amount_min), num(g.amount_max)).replace('—', ''),
          g.opens_on,
          g.closes_on ?? 'ongoing',
          left != null && left >= 0 ? left : null,
          t ? `${t.title}${t.due_at ? ` (due ${t.due_at.slice(0, 10)})` : ''}` : null,
          people.join(', ') || null,
        ]
      })
      return { title: GRANT_STATUS_LABEL[s], rows }
    })
    .filter((g) => g.rows.length > 0)
}

export async function gatherGrants(p: ParamValues, ctx: GatherContext): Promise<ReportData> {
  const filter = GRANT_FILTERS[p.status] ? p.status : 'active'
  const statuses = GRANT_FILTERS[filter]
  const [grants, tasks, users] = await Promise.all([
    fetchAll<GrantLite>((a, b) => supabase.from('grants').select('id, title, funder, status, amount_min, amount_max, opens_on, closes_on, assigned_to, url').in('status', statuses).order('id').range(a, b)),
    fetchAll<GrantTaskLite>((a, b) => supabase.from('tasks_with_assignees').select('title, due_at, status, source_ref, assignee_ids').eq('source', 'grant').order('id').range(a, b)),
    fetchAll<{ id: string; full_name: string | null }>((a, b) => supabase.from('users').select('id, full_name').order('id').range(a, b)),
  ])
  const groups = grantGroups(grants, tasks, new Map(users.map((u) => [u.id, u.full_name ?? 'someone'])), statuses, ctx.today)
  if (!groups.length) throw new Error(filter === 'active' ? 'No open grants. Look for new ones on the Grants page.' : 'No grants match.')
  const upcoming = grants.filter((g) => g.closes_on && g.closes_on >= ctx.today).sort((a, b) => a.closes_on!.localeCompare(b.closes_on!))[0]
  const label = { active: 'Open grants', applied: 'Applied for', all: 'All grants' }[filter]
  return {
    title: 'Grant applications and deadlines',
    subtitle: label,
    meta: [
      ['Grants', grants.length],
      ['Next deadline', upcoming ? `${upcoming.closes_on} · ${upcoming.title}` : 'none set'],
      ['With a task', grants.filter((g) => tasks.some((t) => t.source_ref === g.id && t.status !== 'done')).length],
    ],
    columns: GRANT_COLUMNS,
    groups,
    groupLabel: 'Status',
    filename: `Grants ${label} ${ctx.today}`,
  }
}
