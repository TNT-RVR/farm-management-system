import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from './supabase'
import type { Database } from './database.types'
import type { CombineCropKey, SettingKey } from './combine'

export type CombineSettingsRow = Database['public']['Tables']['combine_settings']['Row']
export type LossCheckRow = Database['public']['Tables']['combine_loss_checks']['Row']

/** Both CRs are set the same way, so one machine key until that stops being true. */
export const MACHINE = 'CR9090'

export function useCombineSettings(cropYear: number) {
  return useQuery({
    queryKey: ['combine_settings', cropYear],
    queryFn: async (): Promise<CombineSettingsRow[]> => {
      const { data, error } = await supabase
        .from('combine_settings')
        .select('*')
        .eq('crop_year', cropYear)
      if (error) throw error
      return data ?? []
    },
  })
}

/**
 * Last year's numbers for the same crop.
 *
 * The most useful thing on the screen when starting a crop: what this machine
 * was set to the last time it went well, which beats any published table.
 */
export function usePreviousCombineSettings(cropYear: number) {
  return useQuery({
    queryKey: ['combine_settings', 'before', cropYear],
    queryFn: async (): Promise<CombineSettingsRow[]> => {
      const { data, error } = await supabase
        .from('combine_settings')
        .select('*')
        .lt('crop_year', cropYear)
        .order('crop_year', { ascending: false })
      if (error) throw error
      // One row per crop — the most recent, since the query is already sorted.
      const seen = new Set<string>()
      return (data ?? []).filter((r) => !seen.has(r.crop_key) && seen.add(r.crop_key))
    },
  })
}

export function useSaveCombineSettings(cropYear: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: {
      crop_key: CombineCropKey
      values: Partial<Record<SettingKey, number | null>>
      notes?: string | null
    }) => {
      const { error } = await supabase.from('combine_settings').upsert(
        {
          machine: MACHINE,
          crop_key: v.crop_key,
          crop_year: cropYear,
          ...v.values,
          ...(v.notes !== undefined ? { notes: v.notes } : {}),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'machine,crop_key,crop_year' },
      )
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['combine_settings'] }),
  })
}

export function useLossChecks(cropYear: number) {
  return useQuery({
    queryKey: ['combine_loss_checks', cropYear],
    queryFn: async (): Promise<LossCheckRow[]> => {
      const { data, error } = await supabase
        .from('combine_loss_checks')
        .select('*')
        .eq('crop_year', cropYear)
        .order('checked_at', { ascending: false })
        .limit(100)
      if (error) throw error
      return data ?? []
    },
  })
}

export function useSaveLossCheck(cropYear: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (
      v: Omit<Database['public']['Tables']['combine_loss_checks']['Insert'], 'crop_year'>,
    ) => {
      const { error } = await supabase
        .from('combine_loss_checks')
        .insert({ ...v, crop_year: cropYear, machine: v.machine ?? MACHINE })
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['combine_loss_checks'] }),
  })
}

export type LossCheckPatch = Partial<
  Pick<
    LossCheckRow,
    | 'checked_at'
    | 'field_id'
    | 'source'
    | 'notes'
    | 'seeds'
    | 'pan_area_sqft'
    | 'header_ft'
    | 'discharge_ft'
    | 'grams_per_1000'
    | 'lb_per_bushel'
    | 'yield_bu_per_acre'
    | 'loss_bu_per_acre'
    | 'loss_pct'
  >
>

/**
 * Correct a saved check (any active user may write combine_loss_checks).
 * The generated Update type only lists notes and source — the stored answer
 * is not meant to drift on its own — but a person correcting what was counted
 * changes the answer on purpose, and the caller recomputes it
 * (recomputeLossCheck), so the wider patch goes through an untyped client.
 */
export function useUpdateLossCheck() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: LossCheckPatch }) => {
      const { error } = await (supabase as unknown as SupabaseClient).from('combine_loss_checks').update(patch).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['combine_loss_checks'] }),
  })
}

export function useDeleteLossCheck() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('combine_loss_checks').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['combine_loss_checks'] }),
  })
}
