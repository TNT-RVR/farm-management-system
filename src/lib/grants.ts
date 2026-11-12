import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import { grantsSource } from './partner'
import type { Database } from './database.types'

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
        .from(grantsSource())
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

/**
 * How many rows are a second listing of a grant already on the list.
 *
 * Drives whether the page offers to merge at all. The weekly pull sweeps on
 * its way out, so the usual answer is none and the button stays away.
 */
export function useGrantDuplicateCount() {
  return useQuery({
    queryKey: ['grant_duplicates'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('grant_duplicate_count')
      if (error) throw error
      return data ?? 0
    },
  })
}

/**
 * Fold every set of rows naming the same programme into one.
 *
 * The survivor keeps the fullest record and takes whatever the others held
 * that it was missing — notes, the contact, the application form, who it is
 * assigned to. Nothing is thrown away silently.
 */
export function useGrantDedupe() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('fn_dedupe_grants')
      if (error) throw error
      return data ?? 0
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['grants'] })
      void qc.invalidateQueries({ queryKey: ['grant_duplicates'] })
    },
  })
}

/** Fold one grant into another by hand, for a pair only a person can spot. */
export function useGrantMerge() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ keeper, loser }: { keeper: string; loser: string }) => {
      const { error } = await supabase.rpc('fn_merge_grants', { p_keeper: keeper, p_loser: loser })
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['grants'] })
      void qc.invalidateQueries({ queryKey: ['grant_duplicates'] })
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
      const { error } = await supabase.from(grantsSource()).update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id)
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

// ---- acting on a grant (Sam, 2 Nov 2026): lib/grant-kit.ts has the words ----

/** The signed-in person's token, for the site's own functions. */
async function bearer(): Promise<string> {
  const { data } = await supabase.auth.getSession()
  return `Bearer ${data.session?.access_token ?? ''}`
}

/**
 * Read the program's pages and fill the grant's blanks (deadline, share,
 * contact, the application form). A background job: the grant refreshes a few
 * times while it runs, typically a minute.
 */
export function useGrantDetailsLookup() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch('/api/grant-details-background', {
        method: 'POST',
        headers: { Authorization: await bearer(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      if (res.status >= 400) throw new Error('Could not start the lookup')
    },
    onSuccess: () => {
      for (const ms of [30_000, 60_000, 100_000, 150_000]) setTimeout(() => qc.invalidateQueries({ queryKey: ['grants'] }), ms)
    },
  })
}

/** Send the meeting-request email from the app. notConfigured: no Resend key in Settings → Connections yet. */
export function useSendGrantEmail() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (m: { grantId: string; to: string; subject: string; body: string }) => {
      const res = await fetch('/api/grant-email', {
        method: 'POST',
        headers: { Authorization: await bearer(), 'Content-Type': 'application/json' },
        body: JSON.stringify(m),
      })
      const out = (await res.json().catch(() => ({}))) as { error?: string; notConfigured?: boolean; from?: string }
      if (!res.ok) throw Object.assign(new Error(out.error ?? 'Could not send'), { notConfigured: Boolean(out.notConfigured) })
      return out
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['grants'] }),
  })
}

/** A link to the saved application form, good for an hour. */
export function useGrantPdfUrl(path: string | null | undefined) {
  return useQuery({
    queryKey: ['grant_pdf', path],
    enabled: Boolean(path),
    staleTime: 50 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.storage.from('grant-docs').createSignedUrl(path!, 3600, { download: 'application.pdf' })
      if (error) throw error
      return data.signedUrl
    },
  })
}

/** Save someone's own copy of the application form, in place of any found one. */
export function useUploadGrantPdf() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ grantId, file }: { grantId: string; file: File }) => {
      if (file.type !== 'application/pdf') throw new Error('Choose a PDF file.')
      const path = `${grantId}/application.pdf`
      const { error } = await supabase.storage.from('grant-docs').upload(path, file, { contentType: 'application/pdf', upsert: true })
      if (error) throw error
      const { error: e2 } = await supabase.from('grants').update({ application_pdf_path: path, updated_at: new Date().toISOString() }).eq('id', grantId)
      if (e2) throw e2
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['grants'] })
      void qc.invalidateQueries({ queryKey: ['grant_pdf'] })
    },
  })
}
