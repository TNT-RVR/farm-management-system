import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import type { Database } from './database.types'

export type EquipmentRow = Database['public']['Tables']['equipment']['Row']
export type TemplateRow = Database['public']['Tables']['checklist_templates']['Row']
export type TemplateItemRow = Database['public']['Tables']['checklist_template_items']['Row']
export type RunRow = Database['public']['Tables']['checklist_runs']['Row']
export type RunItemRow = Database['public']['Tables']['checklist_run_items']['Row']
export type ChecklistCategory = TemplateRow['category']

export const CATEGORIES: ChecklistCategory[] = [
  'irrigation',
  'equipment',
  'fields',
  'cattle',
  'other',
]

export function useTemplates() {
  return useQuery({
    queryKey: ['checklist_templates'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('checklist_templates')
        .select('*')
        .order('name')
      if (error) throw error
      return data
    },
  })
}

export function useTemplateItems(templateId: string | undefined) {
  return useQuery({
    queryKey: ['checklist_template_items', templateId],
    enabled: Boolean(templateId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('checklist_template_items')
        .select('*')
        .eq('template_id', templateId!)
        .order('sort_order')
      if (error) throw error
      return data
    },
  })
}

export function useRuns(cropYear: number) {
  return useQuery({
    queryKey: ['checklist_runs', cropYear],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('checklist_runs')
        .select('*')
        .eq('crop_year', cropYear)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data
    },
  })
}

export function useRun(runId: string | undefined) {
  return useQuery({
    queryKey: ['checklist_run', runId],
    enabled: Boolean(runId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('checklist_runs')
        .select('*')
        .eq('id', runId!)
        .single()
      if (error) throw error
      return data
    },
  })
}

export function useRunItems(runId: string | undefined) {
  return useQuery({
    queryKey: ['checklist_run_items', runId],
    enabled: Boolean(runId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('checklist_run_items')
        .select('*')
        .eq('run_id', runId!)
        .order('sort_order')
      if (error) throw error
      return data
    },
  })
}

export function equipmentQuery() {
  return {
    queryKey: ['equipment'],
    queryFn: async () => {
      const { data, error } = await supabase.from('equipment').select('*').order('name')
      if (error) throw error
      return data
    },
  }
}

export function useEquipment() {
  return useQuery(equipmentQuery())
}

export function useCreateRun() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (args: {
      templateId: string
      assignedTo: string[]
      dueAt: string | null
      cropYear: number
    }) => {
      const { data, error } = await supabase.rpc('create_checklist_run', {
        p_template_id: args.templateId,
        p_assigned_to: args.assignedTo,
        p_due_at: args.dueAt,
        p_crop_year: args.cropYear,
      })
      if (error) throw error
      return data as string
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['checklist_runs'] })
      void queryClient.invalidateQueries({ queryKey: ['tasks'] })
    },
  })
}

export function useCheckRunItem(runId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      itemId,
      checked,
      note,
    }: {
      itemId: string
      checked?: boolean
      note?: string | null
    }) => {
      const patch: Database['public']['Tables']['checklist_run_items']['Update'] = {}
      if (checked !== undefined) patch.checked = checked
      if (note !== undefined) patch.note = note
      const { error } = await supabase.from('checklist_run_items').update(patch).eq('id', itemId)
      if (error) throw error
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['checklist_run_items', runId] })
      void queryClient.invalidateQueries({ queryKey: ['checklist_run', runId] })
      void queryClient.invalidateQueries({ queryKey: ['checklist_runs'] })
    },
  })
}

/**
 * Add a job to a year's checklist, and to its template so every later year
 * has it too (checklist_add_job). On a map checklist anyone active may; on
 * another, managers only — the database decides.
 */
export function useAddRunJob(runId: string, templateId: string | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ runLocationId, text }: { runLocationId: string | null; text: string }) => {
      const { error } = await (supabase.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<{ error: Error | null }>)('checklist_add_job', {
        p_run: runId,
        p_run_location: runLocationId,
        p_text: text,
      })
      if (error) throw error
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['checklist_run_items', runId] })
      void queryClient.invalidateQueries({ queryKey: ['checklist_runs'] })
      if (templateId) void queryClient.invalidateQueries({ queryKey: ['checklist_template_items', templateId] })
    },
  })
}
