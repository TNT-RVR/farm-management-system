import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import type { Database } from './database.types'
import { monthlyLists, type CopyState } from './monthly'

/**
 * Monthly jobs: reading and writing (the rules are in lib/monthly.ts).
 *
 * Handing out, starting a checklist and making the copies go through database
 * functions (assign_monthly_copy, start_monthly_checklist,
 * ensure_monthly_copies). Ticking a linked task done ticks the copy in a
 * trigger, so it works from the Tasks page, the phone and the Any.do sync
 * alike; finishing the linked checklist run does the same.
 */

export type MonthlyJobRow = Database['public']['Tables']['monthly_task_templates']['Row']
export type MonthlyCopyRow = Database['public']['Tables']['monthly_task_instances']['Row']

const COPY_COLS = 'id, template_id, year, month, state, skip_note, completed_by, completed_at, checklist_run_id'

export function useMonthlyJobs() {
  return useQuery({
    queryKey: ['monthly_templates'],
    queryFn: async () => {
      const { data, error } = await supabase.from('monthly_task_templates').select('*').order('sort_order').order('title')
      if (error) throw error
      return data as MonthlyJobRow[]
    },
  })
}

/**
 * The copies the To do list and the meeting need: made first (twelve months
 * back to next month), then read from last year on.
 */
export function useMonthlyCopies() {
  return useQuery({
    queryKey: ['monthly_instances', 'current'],
    queryFn: async () => {
      const { error: ensureErr } = await supabase.rpc('ensure_monthly_copies')
      if (ensureErr) throw ensureErr
      const { data, error } = await supabase
        .from('monthly_task_instances')
        .select(COPY_COLS)
        .gte('year', new Date().getFullYear() - 1)
      if (error) throw error
      return data as MonthlyCopyRow[]
    },
  })
}

/** One calendar year's copies, for the Completed tab. */
export function useMonthlyYear(year: number) {
  return useQuery({
    queryKey: ['monthly_instances', year],
    queryFn: async () => {
      const { data, error } = await supabase.from('monthly_task_instances').select(COPY_COLS).eq('year', year)
      if (error) throw error
      return data as MonthlyCopyRow[]
    },
  })
}

/**
 * Accounts that are not people: Claude's and the conference-room TV's. They
 * sign in, so they are active users, but a job is never theirs and "Tasks by
 * person" listing them reads as two people with nothing to do (Sam's
 * meeting, 24 Oct 2026). Same name rule as the drivers list (bin-loads.ts).
 */
export const isServiceAccount = (name: string | null | undefined) => /^(claude|conference room)/i.test((name ?? '').trim())

/** Active people, with their pictures: who a job can be handed to. */
export function useActivePeople() {
  return useQuery({
    queryKey: ['users', 'active'],
    queryFn: async () => {
      const { data, error } = await supabase.from('users').select('id, full_name, avatar_url').eq('active', true).order('full_name')
      if (error) throw error
      return (data as { id: string; full_name: string | null; avatar_url: string | null }[]).filter((u) => !isServiceAccount(u.full_name))
    },
  })
}

function useInvalidate() {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: ['monthly_instances'] })
    void qc.invalidateQueries({ queryKey: ['tasks'] })
    void qc.invalidateQueries({ queryKey: ['checklist_runs'] })
  }
}

/** Done, skipped (with an optional note) or back to to do. Who and when are recorded by the database. */
export function useSetCopyState() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: async ({ id, state, note }: { id: string; state: CopyState; note?: string | null }) => {
      const { error } = await supabase
        .from('monthly_task_instances')
        .update({ state, skip_note: state === 'skipped' ? note?.trim() || null : null })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
}

/** A task each for the people picked, due the end of the copy's month. */
export function useAssignCopy() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: async ({ id, userIds }: { id: string; userIds: string[] }) => {
      const { data, error } = await supabase.rpc('assign_monthly_copy', { p_copy: id, p_users: userIds })
      if (error) throw error
      return data as number
    },
    onSuccess: invalidate,
  })
}

/** Starts the job's checklist run (or finds the one already started); returns its id. */
export function useStartCopyChecklist() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.rpc('start_monthly_checklist', { p_copy: id })
      if (error) throw error
      return data as string
    },
    onSuccess: invalidate,
  })
}

export function useMonthlyJobMutations() {
  const qc = useQueryClient()
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['monthly_templates'] })
    void qc.invalidateQueries({ queryKey: ['monthly_instances'] })
  }
  type Insert = Database['public']['Tables']['monthly_task_templates']['Insert']
  type Update = Database['public']['Tables']['monthly_task_templates']['Update']
  const create = useMutation({
    mutationFn: async (job: Insert) => {
      const { error } = await supabase.from('monthly_task_templates').insert(job)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
  const update = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Update }) => {
      const { error } = await supabase.from('monthly_task_templates').update(patch).eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('monthly_task_templates').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
  return { create, update, remove }
}

/** The To do lists for month `now` (lib/monthly.ts monthlyLists), loaded. */
export function useMonthlyToDo(now: number) {
  const jobs = useMonthlyJobs()
  const copies = useMonthlyCopies()
  const lists = useMemo(() => monthlyLists(jobs.data ?? [], copies.data ?? [], now), [jobs.data, copies.data, now])
  return { lists, isLoading: jobs.isLoading || copies.isLoading, error: (jobs.error ?? copies.error) as Error | null }
}
