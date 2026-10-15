import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import type { Database } from './database.types'
import type { VarietySettingRow } from './crop-variety-settings'

type Insert = Database['public']['Tables']['crop_variety_settings']['Insert']

/** Every variety's own settings (the client matches by crop and name). */
export function cropVarietySettingsQuery() {
  return {
    queryKey: ['crop_variety_settings'],
    queryFn: async (): Promise<VarietySettingRow[]> => {
      const { data, error } = await supabase.from('crop_variety_settings').select('*').order('variety')
      if (error) throw error
      return data ?? []
    },
  }
}

export function useCropVarietySettings() {
  return useQuery(cropVarietySettingsQuery())
}

/** The variety names plans and history recorded, so the ones never added to a crop's list are offered too. */
export function useRecordedVarieties() {
  return useQuery({
    queryKey: ['recorded_varieties'],
    queryFn: async () => {
      const [plans, history] = await Promise.all([
        supabase.from('crop_plans').select('crop_id, variety').not('variety', 'is', null),
        supabase.from('crop_history').select('crop_id, variety').not('variety', 'is', null),
      ])
      if (plans.error) throw plans.error
      if (history.error) throw history.error
      return [...(plans.data ?? []), ...(history.data ?? [])] as { crop_id: string | null; variety: string | null }[]
    },
    staleTime: 5 * 60_000,
  })
}

export function useCropVarietySettingMutations() {
  const qc = useQueryClient()
  const invalidate = () => void qc.invalidateQueries({ queryKey: ['crop_variety_settings'] })
  const save = useMutation({
    mutationFn: async ({ id, ...row }: Insert) => {
      const variety = row.variety.trim()
      if (!variety) throw new Error('Pick the variety.')
      const patch = { ...row, variety, updated_at: new Date().toISOString() }
      const { error } = id
        ? await supabase.from('crop_variety_settings').update(patch).eq('id', id)
        : await supabase.from('crop_variety_settings').insert(patch)
      if (error) {
        if ((error as { code?: string }).code === '23505') throw new Error(`${variety} already has its own settings.`)
        throw error
      }
    },
    onSuccess: invalidate,
  })
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('crop_variety_settings').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
  return { save, remove }
}
