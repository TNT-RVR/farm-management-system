import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from './supabase'
import type { SettingKey } from './combine'
import type { UsedSettings } from './combine-start'
import { syncSettingsRows, type ExistingSettingsRow } from './combine-finish'

/** What "Field finished" reads and writes besides the work record (lib/combine-finish.ts). */

const sb = () => supabase as unknown as SupabaseClient

/** The settings rows saved with one finish. Empty before 20261017050000. */
export function useFinishSettings(workRecordId: string | null | undefined) {
  return useQuery({
    // v1: combine_settings_used.work_record_id (20261017050000).
    queryKey: ['combine_settings_used', 'v1', 'finish', workRecordId ?? ''],
    enabled: Boolean(workRecordId),
    queryFn: async (): Promise<UsedSettings[]> => {
      const { data, error } = await sb().from('combine_settings_used').select('*').eq('work_record_id', workRecordId!)
      if (error) return []
      return (data ?? []) as UsedSettings[]
    },
  })
}

export type FinishSettingsBase = {
  crop_key: string
  crop_year: number
  field_id: string
  used_on: string
  header_type: string | null
  operation_instance: string | null
  operator: string | null
  variety: string | null
  tag: string | null
  notes: string | null
}

/**
 * Write what the combines ran, one row per combine on the finish, linked to
 * it: rows of combines still on it are rewritten, new combines get a row,
 * combines taken off lose theirs.
 */
export function useSaveFinishSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: {
      workRecordId: string
      existing: ExistingSettingsRow[]
      combineIds: string[]
      base: FinishSettingsBase
      values: Partial<Record<SettingKey, number | null>>
    }) => {
      const plan = syncSettingsRows(v.existing, v.combineIds)
      const body = { ...v.base, ...v.values, work_record_id: v.workRecordId }
      for (const r of plan.update) {
        const { error } = await sb().from('combine_settings_used').update({ ...body, equipment_id: r.equipment_id }).eq('id', r.id)
        if (error) throw new Error(error.message)
      }
      if (plan.insert.length) {
        const { error } = await sb()
          .from('combine_settings_used')
          .insert(plan.insert.map((equipment_id) => ({ ...body, equipment_id })))
        if (error) throw new Error(error.message)
      }
      if (plan.remove.length) {
        const { error } = await sb().from('combine_settings_used').delete().in('id', plan.remove)
        if (error) throw new Error(error.message)
      }
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['combine_settings_used'] }),
  })
}
