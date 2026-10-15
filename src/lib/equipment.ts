import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import type { Database } from './database.types'
import { latestForPlan, newManualJdId } from './equipment-edits'

export type Equipment = Database['public']['Tables']['jd_equipment']['Row']

/**
 * The fleet. Archived machines are kept but pushed out of the way — Deere
 * archives a machine when it is sold, and its history still matters.
 */
export function jdEquipmentQuery(includeArchived = false) {
  return {
    queryKey: ['jd_equipment', includeArchived],
    queryFn: async () => {
      let q = supabase.from('jd_equipment').select('*').order('name')
      if (!includeArchived) q = q.eq('archived', false)
      const { data, error } = await q
      if (error) throw error
      return data
    },
  }
}

export function useEquipment(includeArchived = false) {
  return useQuery(jdEquipmentQuery(includeArchived))
}

export function useEquipmentItem(id: string | undefined) {
  return useQuery({
    queryKey: ['jd_equipment', 'one', id],
    enabled: Boolean(id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('jd_equipment')
        .select('*')
        .eq('id', id!)
        .maybeSingle()
      if (error) throw error
      return data
    },
  })
}

export function useSyncEquipment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const res = await fetch('/api/jd-equipment-sync-background', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token ?? ''}` },
      })
      // A background function answers 202 before it has done anything, so this
      // means "started", not "finished". The list is re-checked below.
      if (res.status === 202 || res.ok) return { started: true }
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      throw new Error(body.error ?? `Could not start the sync (${res.status})`)
    },
    onSuccess: () => {
      for (const ms of [10_000, 30_000, 60_000]) {
        setTimeout(() => void qc.invalidateQueries({ queryKey: ['jd_equipment'] }), ms)
      }
    },
  })
}

export function useSaveEquipment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (
      row: { id: string } & Database['public']['Tables']['jd_equipment']['Update'],
    ) => {
      const { id, ...patch } = row
      const { error } = await supabase
        .from('jd_equipment')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['jd_equipment'] }),
  })
}

/**
 * Add a machine Deere does not know about (managers). It gets a jd_id of our
 * own and is_manual, so the sync's upsert — keyed on Deere's ids — never
 * touches it. Returns the new id so the page can open it.
 */
export function useAddEquipment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (row: Omit<Database['public']['Tables']['jd_equipment']['Insert'], 'jd_id' | 'is_manual'>) => {
      const { data, error } = await supabase
        .from('jd_equipment')
        .insert({ ...row, jd_id: newManualJdId(), is_manual: true, archived: row.archived ?? false })
        .select('id')
        .single()
      if (error) throw error
      return data.id
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['jd_equipment'] }),
  })
}

/**
 * Delete a hand-added machine (managers). Its service plans and log go with it
 * (ON DELETE CASCADE); tasks raised for it stay, unlinked. Deere's machines are
 * archived in Operations Center instead — one deleted here would come back at
 * the next sync — so the delete is limited to is_manual rows.
 */
export function useDeleteEquipment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.from('jd_equipment').delete().eq('id', id).eq('is_manual', true).select('id')
      if (error) throw error
      if (!data?.length) throw new Error('Not deleted: only a machine added by hand can be deleted here.')
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['jd_equipment'] }),
  })
}

export type ServiceLogRow = Database['public']['Tables']['equipment_service_log']['Row']

/** Every service recorded on a machine, newest first. */
export function useServiceLog(equipmentId: string | undefined) {
  return useQuery({
    queryKey: ['equipment_service_log', equipmentId],
    enabled: Boolean(equipmentId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('equipment_service_log')
        .select('*')
        .eq('equipment_id', equipmentId!)
        .order('done_on', { ascending: false })
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as ServiceLogRow[]
    },
  })
}

/**
 * Keep a plan's "last done" on its latest logged service after one is changed
 * or removed; with none left it is left as it was (it may have been set by
 * hand in the plan form).
 */
async function rebasePlan(planId: string) {
  const { data, error } = await supabase.from('equipment_service_log').select('id, plan_id, done_on, engine_hours, created_at').eq('plan_id', planId)
  if (error) throw error
  const latest = latestForPlan(data ?? [], planId)
  if (!latest) return
  const { error: e2 } = await supabase
    .from('equipment_service_plans')
    .update({ last_done_on: latest.done_on, last_done_hours: latest.engine_hours, updated_at: new Date().toISOString() })
    .eq('id', planId)
  if (e2) throw e2
}

/**
 * Add a service by hand, or correct one (Sam, 7 Oct 2026). Anyone active may
 * add (equipment_service_log_insert); changing one is the manager's
 * (equipment_service_log_manage). The plans it touches are re-based.
 */
export function useSaveServiceLog() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: {
      id?: string
      equipment_id: string
      plan_id: string | null
      /** The plan the entry was on before the edit, to re-base it too. */
      was_plan_id?: string | null
      done_on: string
      engine_hours: number | null
      cost: number | null
      notes: string | null
    }) => {
      const row = { plan_id: v.plan_id, done_on: v.done_on, engine_hours: v.engine_hours, cost: v.cost, notes: v.notes }
      if (v.id) {
        const { data, error } = await supabase.from('equipment_service_log').update(row).eq('id', v.id).select('id')
        if (error) throw error
        if (!data?.length) throw new Error('Not saved: only a manager can change a recorded service.')
      } else {
        const {
          data: { user },
        } = await supabase.auth.getUser()
        const { error } = await supabase.from('equipment_service_log').insert({ ...row, equipment_id: v.equipment_id, done_by: user?.id ?? null })
        if (error) throw error
      }
      for (const p of new Set([v.plan_id, v.was_plan_id].filter((x): x is string => Boolean(x)))) await rebasePlan(p)
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['equipment_service_log'] })
      void qc.invalidateQueries({ queryKey: ['equipment_service_plans'] })
    },
  })
}

export function useDeleteServiceLog() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { id: string; plan_id: string | null }) => {
      const { data, error } = await supabase.from('equipment_service_log').delete().eq('id', v.id).select('id')
      if (error) throw error
      if (!data?.length) throw new Error('Not deleted: only a manager can remove a recorded service.')
      if (v.plan_id) await rebasePlan(v.plan_id)
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['equipment_service_log'] })
      void qc.invalidateQueries({ queryKey: ['equipment_service_plans'] })
    },
  })
}

/** "4,132 h · read 3 days ago", or null when the machine reports no hours. */
export function engineHoursLabel(e: Pick<Equipment, 'engine_hours' | 'engine_hours_at'>) {
  if (e.engine_hours == null) return null
  const hours = `${Math.round(e.engine_hours).toLocaleString('en-CA')} h`
  if (!e.engine_hours_at) return hours
  const days = Math.floor((Date.now() - Date.parse(e.engine_hours_at)) / 86_400_000)
  const when = days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`
  return `${hours} · read ${when}`
}

/** Deere's categories, in the order a farmer would look for them. */
export const CATEGORY_ORDER = ['machine', 'implement', 'technology', 'other']

export function categoryRank(category: string | null): number {
  const i = CATEGORY_ORDER.indexOf((category ?? '').toLowerCase())
  return i < 0 ? CATEGORY_ORDER.length : i
}

// ---- maintenance ----------------------------------------------------------

export type ServicePlanRow = {
  id: string
  equipment_id: string
  name: string
  interval_hours: number | null
  interval_months: number | null
  last_done_hours: number | null
  last_done_on: string | null
  warn_within_hours: number
  notes: string | null
  active: boolean
}

export type EquipmentAlert = {
  id: string
  jd_id: string
  equipment_jd_id: string
  occurred_at: string | null
  severity: string | null
  color: string | null
  description: string | null
  code: string | null
  engine_hours: number | null
  acknowledged: boolean
  ignored: boolean
  task_id: string | null
}

export function useServicePlans(equipmentId: string | undefined) {
  return useQuery({
    queryKey: ['equipment_service_plans', equipmentId],
    enabled: Boolean(equipmentId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('equipment_service_plans')
        .select('*')
        .eq('equipment_id', equipmentId!)
        .eq('active', true)
        .order('name')
      if (error) throw error
      return data as unknown as ServicePlanRow[]
    },
  })
}

/** Deere's own alerts for a machine, newest first, hiding ones already dealt with. */
export function useEquipmentAlerts(equipmentJdId: string | undefined) {
  return useQuery({
    queryKey: ['jd_equipment_alerts', equipmentJdId],
    enabled: Boolean(equipmentJdId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('jd_equipment_alerts')
        .select('*')
        .eq('equipment_jd_id', equipmentJdId!)
        .eq('ignored', false)
        .order('occurred_at', { ascending: false })
        .limit(50)
      if (error) throw error
      return data as unknown as EquipmentAlert[]
    },
  })
}

export function useSaveServicePlan() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (p: Partial<ServicePlanRow> & { equipment_id: string; name: string }) => {
      const { id, ...rest } = p
      const patch = { ...rest, updated_at: new Date().toISOString() }
      const { error } = id
        ? await supabase.from('equipment_service_plans').update(patch).eq('id', id)
        : await supabase.from('equipment_service_plans').insert(patch)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['equipment_service_plans'] }),
  })
}

export function useDeleteServicePlan() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('equipment_service_plans').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['equipment_service_plans'] }),
  })
}

/**
 * Record that a service was done, and move the plan's baseline to match.
 *
 * Both halves in one go: logging the work without advancing the plan leaves it
 * reading overdue forever, which trains people to ignore it.
 */
export function useLogService() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: {
      equipment_id: string
      plan_id: string | null
      done_on: string
      engine_hours: number | null
      notes: string | null
    }) => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      const { error } = await supabase.from('equipment_service_log').insert({
        equipment_id: v.equipment_id,
        plan_id: v.plan_id,
        done_on: v.done_on,
        engine_hours: v.engine_hours,
        notes: v.notes,
        done_by: user?.id ?? null,
      })
      if (error) throw error
      if (v.plan_id) {
        const { error: e2 } = await supabase
          .from('equipment_service_plans')
          .update({
            last_done_on: v.done_on,
            last_done_hours: v.engine_hours,
            updated_at: new Date().toISOString(),
          })
          .eq('id', v.plan_id)
        if (e2) throw e2
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['equipment_service_plans'] })
      void qc.invalidateQueries({ queryKey: ['equipment_service_log'] })
    },
  })
}

/** Raise an assignable task from a due service or a machine alert. */
export function useCreateEquipmentTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: {
      title: string
      description: string
      /** Who to put on it. Optional — an equipment fault is often raised for
       *  whoever picks it up rather than for a named person. */
      assignees?: string[]
      alertId?: string
    }) => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      const { data, error } = await supabase
        .from('tasks')
        .insert({
          title: v.title.slice(0, 200),
          description_md: v.description,
          created_by: user?.id ?? undefined,
          source: 'equipment',
        })
        .select('id')
        .single()
      if (error) throw error
      if (v.assignees?.length && data?.id) {
        await supabase.from('task_assignees').insert(
          v.assignees.map((user_id) => ({ task_id: data.id, user_id, assigned_by: user?.id ?? null })),
        )
      }
      // Link the alert to its task so the same fault is not raised twice.
      if (v.alertId && data?.id) {
        await supabase.from('jd_equipment_alerts').update({ task_id: data.id }).eq('id', v.alertId)
      }
      return data
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['tasks'] })
      void qc.invalidateQueries({ queryKey: ['jd_equipment_alerts'] })
    },
  })
}
