import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import type { Database } from './database.types'
import { loadChart, type MoistureChart } from './moisture'

export type MoistureTest = Database['public']['Tables']['moisture_tests']['Row']
export type MoistureTestInsert = Database['public']['Tables']['moisture_tests']['Insert']
export type SampleCondition = 'screened' | 'dirty'
export type BinAirAlert = Database['public']['Tables']['bin_air_alerts']['Row']

/**
 * One crop's conversion table, fetched once and kept.
 *
 * Through react-query rather than a bare await so the calculator does not
 * re-import and re-parse on every keystroke. The table is static published
 * reference data, so it never goes stale and never needs refetching — `Infinity`
 * here is a statement about the CGC, not an optimisation.
 */
export function useMoistureChart(key: string | null | undefined) {
  return useQuery<MoistureChart>({
    queryKey: ['919-chart', key],
    enabled: Boolean(key),
    staleTime: Infinity,
    gcTime: Infinity,
    queryFn: () => loadChart(key!),
  })
}

export function moistureTestsQuery(cropYear: number) {
  return {
    queryKey: ['moisture_tests', cropYear],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('moisture_tests')
        .select('*')
        .eq('crop_year', cropYear)
        .order('tested_at', { ascending: false })
        .limit(500)
      if (error) throw error
      return data as unknown as MoistureTest[]
    },
  }
}

export function useMoistureTests(cropYear: number) {
  return useQuery(moistureTestsQuery(cropYear))
}

export function useRecordMoistureTest() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (t: Omit<MoistureTestInsert, 'created_by'>) => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      const { data, error } = await supabase
        .from('moisture_tests')
        .insert({ ...t, created_by: user?.id })
        .select('*')
        .single()
      if (error) throw error
      return data as unknown as MoistureTest
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['moisture_tests'] })
      // Every test re-teaches the dry-down: the crop's model, the farm's, and
      // every field's prediction that rests on them (dry-down-data.ts).
      void qc.invalidateQueries({ queryKey: ['dry-down'] })
      void qc.invalidateQueries({ queryKey: ['dry-down-model'] })
      // A wet sample on a field that is already off raises the alert inside the
      // same insert, so the list it lands in has to be re-read.
      void qc.invalidateQueries({ queryKey: ['bin_air_alerts'] })
    },
  })
}

/**
 * Fix a saved test afterwards. Its recorder may change the note and
 * screened/dirty; a manager anything (the database holds that line, in
 * fn_moisture_test_own_edit). A changed grade or field can raise a bin's
 * air alert in the same update, so the alerts are read again.
 */
export function useUpdateMoistureTest() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (
      v: { id: string; note?: string | null; sample_condition?: SampleCondition | null } & Omit<
        Database['public']['Tables']['moisture_tests']['Update'],
        'id' | 'note' | 'sample_condition'
      >,
    ) => {
      const { id, ...patch } = v
      const { error } = await supabase.from('moisture_tests').update(patch).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['moisture_tests'] })
      // Every test re-teaches the dry-down: the crop's model, the farm's, and
      // every field's prediction that rests on them (dry-down-data.ts).
      void qc.invalidateQueries({ queryKey: ['dry-down'] })
      void qc.invalidateQueries({ queryKey: ['dry-down-model'] })
      void qc.invalidateQueries({ queryKey: ['bin_detail'] })
      void qc.invalidateQueries({ queryKey: ['bin_air_alerts'] })
    },
  })
}

export function useDeleteMoistureTest() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('moisture_tests').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['moisture_tests'] })
      // Every test re-teaches the dry-down: the crop's model, the farm's, and
      // every field's prediction that rests on them (dry-down-data.ts).
      void qc.invalidateQueries({ queryKey: ['dry-down'] })
      void qc.invalidateQueries({ queryKey: ['dry-down-model'] })
      void qc.invalidateQueries({ queryKey: ['bin_detail'] })
    },
  })
}

export function binAirAlertsQuery() {
  return {
    queryKey: ['bin_air_alerts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bin_air_alerts')
        .select('*')
        .is('dismissed_at', null)
        .order('raised_at', { ascending: false })
      if (error) throw error
      return data as unknown as BinAirAlert[]
    },
  }
}

/** Open alerts only. A dismissed one is over; the audit log keeps the history. */
export function useBinAirAlerts() {
  return useQuery(binAirAlertsQuery())
}

export function useDismissBinAirAlert() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, note }: { id: string; note?: string }) => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      const { error } = await supabase
        .from('bin_air_alerts')
        .update({
          dismissed_at: new Date().toISOString(),
          dismissed_by: user?.id ?? null,
          dismissed_note: note?.trim() || null,
        })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['bin_air_alerts'] })
      void qc.invalidateQueries({ queryKey: ['bin_detail'] })
    },
  })
}
