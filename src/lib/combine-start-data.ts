import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from './supabase'
import type { SettingKey } from './combine'
import { startDefaultsOf, type SavedSettings, type StartDefaults, type UsedSettings } from './combine-start'

/** What "Start a field" reads and writes (lib/combine-start.ts). */

const sb = () => supabase as unknown as SupabaseClient

/** operating_settings key for the Operation Instance defaults. */
export const START_SETTINGS_KEY = 'combine_start'

/** Every "what we actually ran" row, newest first. Empty before the table exists (20261017030000). */
export function useSettingsUsed() {
  return useQuery({
    // v1: combine_settings_used (20261017030000); v2: variety and work_record_id (20261017050000).
    queryKey: ['combine_settings_used', 'v2'],
    queryFn: async (): Promise<UsedSettings[]> => {
      const { data, error } = await sb().from('combine_settings_used').select('*').order('used_on', { ascending: false }).order('created_at', { ascending: false }).limit(1000)
      if (error) return []
      return (data ?? []) as UsedSettings[]
    },
  })
}

/** Every year's saved per-crop settings. */
export function useAllCombineSettings() {
  return useQuery({
    queryKey: ['combine_settings', 'all'],
    queryFn: async (): Promise<SavedSettings[]> => {
      const { data, error } = await supabase.from('combine_settings').select('*')
      if (error) throw error
      return (data ?? []) as unknown as SavedSettings[]
    },
  })
}

export type SwathRecord = { field_id: string; crop_id: string | null; day: string }

/** Swathing recorded in field work this crop year, field by field (the latest). */
export function useSwathRecords(cropYear: number) {
  return useQuery({
    queryKey: ['field_work_records', 'swathing', cropYear],
    queryFn: async (): Promise<SwathRecord[]> => {
      const { data, error } = await supabase
        .from('field_work_records')
        .select('field_id, crop_id, started_at')
        .eq('work_type', 'swathing')
        .eq('crop_year', cropYear)
        .order('started_at', { ascending: false })
      if (error) throw error
      return (data ?? []).map((r) => ({ field_id: r.field_id, crop_id: r.crop_id, day: (r.started_at ?? '').slice(0, 10) }))
    },
  })
}

/** Active people, for the Operator pick list. */
export function useActivePeople() {
  return useQuery({
    queryKey: ['users', 'active_names'],
    queryFn: async (): Promise<{ id: string; name: string }[]> => {
      const { data, error } = await supabase.from('users').select('id, full_name, email, active').eq('active', true)
      if (error) throw error
      return (data ?? [])
        .map((u) => ({ id: u.id, name: (u.full_name ?? '').trim() || (u.email ?? '').split('@')[0] }))
        .filter((u) => u.name)
        .sort((a, b) => a.name.localeCompare(b.name))
    },
  })
}

export function useStartDefaults() {
  return useQuery({
    queryKey: ['operating_settings', START_SETTINGS_KEY],
    queryFn: async (): Promise<StartDefaults> => {
      const { data, error } = await supabase.from('operating_settings').select('value').eq('key', START_SETTINGS_KEY).maybeSingle()
      if (error) throw error
      return startDefaultsOf(data?.value)
    },
  })
}

/** Set one crop's and/or one header's Operation Instance default (managers); blank removes it. */
export function useSaveStartDefaults() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { current: StartDefaults; cropKey: string | null; crop: string | null; header: string | null; headerValue: string | null }) => {
      const crop = { ...(v.current.operation_instance?.crop ?? {}) }
      const header = { ...(v.current.operation_instance?.header ?? {}) }
      if (v.cropKey) {
        if (v.crop?.trim()) crop[v.cropKey] = v.crop.trim()
        else delete crop[v.cropKey]
      }
      if (v.header) {
        if (v.headerValue?.trim()) header[v.header] = v.headerValue.trim()
        else delete header[v.header]
      }
      const { error } = await supabase
        .from('operating_settings')
        .upsert({ key: START_SETTINGS_KEY, value: { operation_instance: { crop, header } }, updated_at: new Date().toISOString() }, { onConflict: 'key' })
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['operating_settings', START_SETTINGS_KEY] }),
  })
}

export type UsedInsert = Partial<Record<SettingKey, number | null>> & {
  crop_key: string
  crop_year: number
  field_id: string | null
  equipment_id: string | null
  header_type: string | null
  operation_instance: string | null
  operator: string | null
  tag: string | null
  /** The display's Variety (20261017050000). */
  variety?: string | null
  notes: string | null
}

/** "Save what I actually used" (managers): the next field of this crop starts from it. */
export function useSaveSettingsUsed() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (row: UsedInsert) => {
      const { error } = await sb().from('combine_settings_used').insert(row)
      if (error) throw new Error(error.message)
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['combine_settings_used'] }),
  })
}
