import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import type { Database } from './database.types'
import { cropYearOf } from './soil-import'

/**
 * The fields ticked for soil testing, by the crop year the test is for.
 *
 * Read by Soil tests → To test (where they are ticked) and by the "Soil test
 * request" report (what goes to the lab).
 */

export type SoilTestRequest = Database['public']['Tables']['soil_test_requests']['Row']

/**
 * The crop year a test pulled on `today` is for: the soil test reports' own
 * rule, so a fall list and the results that come back for it share one year.
 */
export function requestYearOf(today: string): number {
  return cropYearOf(today) ?? Number(today.slice(0, 4))
}

/** Each field's newest soil test year before `year`, from the reports on file. */
export function lastTestedBefore(reports: { field_id: string; crop_year: number }[], year: number): Map<string, number> {
  const out = new Map<string, number>()
  for (const r of reports) if (r.crop_year < year && r.crop_year > (out.get(r.field_id) ?? 0)) out.set(r.field_id, r.crop_year)
  return out
}

const key = (year: number) => ['soil_test_requests', year] as const

export function useSoilTestRequests(year: number) {
  return useQuery({
    queryKey: key(year),
    queryFn: async (): Promise<SoilTestRequest[]> => {
      const { data, error } = await supabase.from('soil_test_requests').select('*').eq('crop_year', year)
      if (error) throw error
      return data ?? []
    },
  })
}

export function useSoilTestRequestMutations(year: number) {
  const qc = useQueryClient()
  const invalidate = () => void qc.invalidateQueries({ queryKey: key(year) })

  /** Tick or untick fields; several at once for "tick all". */
  const set = useMutation({
    mutationFn: async ({ fieldIds, on }: { fieldIds: string[]; on: boolean }) => {
      if (!fieldIds.length) return
      const { error } = on
        ? await supabase
            .from('soil_test_requests')
            .upsert(
              fieldIds.map((field_id) => ({ field_id, crop_year: year })),
              { onConflict: 'field_id,crop_year', ignoreDuplicates: true },
            )
        : await supabase.from('soil_test_requests').delete().eq('crop_year', year).in('field_id', fieldIds)
      if (error) throw error
    },
    onSuccess: invalidate,
  })

  const note = useMutation({
    mutationFn: async ({ id, notes }: { id: string; notes: string }) => {
      const { error } = await supabase
        .from('soil_test_requests')
        .update({ notes: notes.trim() || null, updated_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })

  return { set, note }
}
