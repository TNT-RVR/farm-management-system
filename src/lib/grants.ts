import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import type { Database } from './database.types'
import { farmName, farmProvinceName } from './farm-context'

export type GrantRow = Database['public']['Tables']['grants']['Row']
export type GrantStatus = GrantRow['status']

export const GRANT_STATUSES: GrantStatus[] = [
  'new',
  'reviewing',
  'applying',
  'submitted',
  'awarded',
  'declined',
  'ignored',
  'closed',
]
export const GRANT_STATUS_LABEL: Record<GrantStatus, string> = {
  new: 'New',
  reviewing: 'Looked at',
  applying: 'Applying',
  submitted: 'Submitted',
  awarded: 'Awarded',
  declined: 'Declined',
  ignored: 'Ignored',
  closed: 'Closed',
}
// "Archived / resolved" = already applied for, awarded, or ruled out.
// "Archived / resolved" = applied for, awarded, ruled out, or the window shut.
// 'closed' is set automatically once the deadline passes, and is distinct from
// 'ignored' on purpose: one is the calendar deciding, the other is us.
export const ARCHIVED_GRANT_STATUSES: GrantStatus[] = [
  'submitted', 'awarded', 'declined', 'ignored', 'closed',
]
export const ACTIVE_GRANT_STATUSES: GrantStatus[] = ['new', 'reviewing', 'applying']
export const isArchivedGrant = (s: GrantStatus) => ARCHIVED_GRANT_STATUSES.includes(s)

export const GRANT_STATUS_COLOR: Record<GrantStatus, string> = {
  new: 'bg-sky-100 text-sky-800',
  reviewing: 'bg-indigo-100 text-indigo-800',
  applying: 'bg-amber-100 text-amber-800',
  submitted: 'bg-purple-100 text-purple-800',
  awarded: 'bg-green-100 text-green-800',
  declined: 'bg-gray-200 text-gray-600',
  ignored: 'bg-gray-100 text-gray-500',
  closed: 'bg-stone-200 text-stone-700',
}

export function moneyRange(min: number | null, max: number | null): string {
  const f = (n: number) => `$${Math.round(n).toLocaleString('en-CA')}`
  if (min == null && max == null) return '—'
  if (min != null && max != null) return min === 0 ? `up to ${f(max)}` : `${f(min)}–${f(max)}`
  return f((min ?? max)!)
}

export function useGrants() {
  return useQuery({
    queryKey: ['grants'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('grants')
        .select('*')
        .order('closes_on', { nullsFirst: false })
      if (error) throw error
      return data
    },
  })
}

/** Trigger the (background) grant auto-pull; new grants appear within a minute or two. */
export function useGrantsPull() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const res = await fetch('/api/grants-pull-background', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token ?? ''}` },
      })
      if (res.status >= 400 && res.status !== 202) throw new Error('Could not start the grant check')
    },
    onSuccess: () => {
      // Background job → refetch a couple of times as results land.
      setTimeout(() => qc.invalidateQueries({ queryKey: ['grants'] }), 45_000)
      setTimeout(() => qc.invalidateQueries({ queryKey: ['grants'] }), 120_000)
    },
  })
}

export function useGrantMutations() {
  const qc = useQueryClient()
  const invalidate = () => void qc.invalidateQueries({ queryKey: ['grants'] })
  const add = useMutation({
    mutationFn: async (g: Database['public']['Tables']['grants']['Insert']) => {
      const { data, error } = await supabase.from('grants').insert(g).select('id').single()
      if (error) throw error
      return data.id
    },
    onSuccess: invalidate,
  })
  const update = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Database['public']['Tables']['grants']['Update'] }) => {
      const { error } = await supabase.from('grants').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('grants').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
  return { add, update, remove }
}

// ---- grant work items (reuse the tasks system: source='grant', source_ref=grant.id) ----
export type GrantTask = Database['public']['Tables']['tasks']['Row']

export function useGrantTasks(grantId: string | null | undefined) {
  return useQuery({
    queryKey: ['grant_tasks', grantId],
    enabled: Boolean(grantId),
    queryFn: async () => {
      // The view, not the table: a task's assignees live in task_assignees now
      // and reading the bare table would show every grant task as unassigned.
      const { data, error } = await supabase
        .from('tasks_with_assignees')
        .select('*')
        .eq('source', 'grant')
        .eq('source_ref', grantId!)
        .order('created_at')
      if (error) throw error
      return data
    },
  })
}

export function useGrantTaskMutations(grantId: string) {
  const qc = useQueryClient()
  const invalidate = () => void qc.invalidateQueries({ queryKey: ['grant_tasks', grantId] })
  const add = useMutation({
    mutationFn: async ({ title, assigned_to }: { title: string; assigned_to?: string | null }) => {
      const { data, error } = await supabase
        .from('tasks')
        .insert({ title, source: 'grant', source_ref: grantId })
        .select('id')
        .single()
      if (error) throw error
      if (assigned_to) {
        const { error: aErr } = await supabase
          .from('task_assignees')
          .insert({ task_id: data.id, user_id: assigned_to })
        if (aErr) throw aErr
      }
    },
    onSuccess: invalidate,
  })
  const update = useMutation({
    mutationFn: async ({
      id,
      patch,
      assigned_to,
    }: {
      id: string
      patch?: Database['public']['Tables']['tasks']['Update']
      /** Undefined leaves it alone; null clears; an id replaces. */
      assigned_to?: string | null
    }) => {
      if (patch && Object.keys(patch).length) {
        const { error } = await supabase.from('tasks').update(patch).eq('id', id)
        if (error) throw error
      }
      if (assigned_to !== undefined) {
        // Grants assign one person at a time, so replacing whoever is on it is
        // the whole operation.
        const { error: delErr } = await supabase.from('task_assignees').delete().eq('task_id', id)
        if (delErr) throw delErr
        if (assigned_to) {
          const { error: insErr } = await supabase
            .from('task_assignees')
            .insert({ task_id: id, user_id: assigned_to })
          if (insErr) throw insErr
        }
      }
    },
    onSuccess: invalidate,
  })
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('tasks').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
  return { add, update, remove }
}

/** A ready-to-paste prompt for drafting the application with Claude. */
export function claudeGrantPrompt(g: GrantRow): string {
  return [
    `I'm applying for an agriculture grant for our farm/cattle operation in ${farmProvinceName()} (${farmName()}). Help me write a strong application.`,
    ``,
    `GRANT: ${g.title}`,
    g.funder ? `Funder: ${g.funder}` : '',
    g.url ? `Link: ${g.url}` : '',
    g.eligibility_summary ? `Eligibility: ${g.eligibility_summary}` : '',
    g.summary ? `Summary: ${g.summary}` : '',
    g.closes_on ? `Closes: ${g.closes_on}` : '',
    g.notes_md ? `\nOur notes:\n${g.notes_md}` : '',
    ``,
    `Please: 1) confirm what this grant funds and the key eligibility criteria, 2) ask me for the specific details you need about our operation, and 3) draft the application answers in a clear, compelling way. Start by listing what you need from me.`,
  ]
    .filter(Boolean)
    .join('\n')
}
