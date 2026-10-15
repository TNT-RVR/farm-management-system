import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import type { Database } from './database.types'

export type PlanterProfile = Database['public']['Tables']['crop_planter_profiles']['Row']

export function usePlanterProfiles() {
  return useQuery({
    queryKey: ['crop_planter_profiles'],
    queryFn: async (): Promise<PlanterProfile[]> => {
      const { data, error } = await supabase.from('crop_planter_profiles').select('*')
      if (error) throw error
      return data ?? []
    },
  })
}

export function useSavePlanterProfile() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (row: Database['public']['Tables']['crop_planter_profiles']['Insert']) => {
      const { error } = await supabase
        .from('crop_planter_profiles')
        .upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: 'crop_id' })
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['crop_planter_profiles'] }),
  })
}

/**
 * The number to start the calculator with, from a range.
 *
 * The middle, not the bottom. Canola is 154,000 to 206,000 an acre depending on
 * variety and conditions, and either end presented alone reads as the
 * recommendation rather than as one edge of a decision somebody still has to
 * make. The field stays editable, which is the point of filling it rather than
 * fixing it.
 */
export function midpoint(min: number | null, max: number | null): number | null {
  if (min == null && max == null) return null
  if (min == null) return max
  if (max == null) return min
  return (min + max) / 2
}

/** "1.5–2 in", "½ in", or nothing at all. */
export function depthText(p: Pick<PlanterProfile, 'depth_in_min' | 'depth_in_max'>): string | null {
  const lo = p.depth_in_min == null ? null : Number(p.depth_in_min)
  const hi = p.depth_in_max == null ? null : Number(p.depth_in_max)
  if (lo == null && hi == null) return null
  if (lo != null && hi != null && lo !== hi) return `${lo}–${hi} in`
  return `${lo ?? hi} in`
}

/** "32,000", "154,000–206,000", or nothing. */
export function populationText(
  p: Pick<PlanterProfile, 'seeds_per_acre_min' | 'seeds_per_acre_max'>,
): string | null {
  const lo = p.seeds_per_acre_min
  const hi = p.seeds_per_acre_max
  if (lo == null && hi == null) return null
  const f = (n: number) => n.toLocaleString('en-CA')
  if (lo != null && hi != null && lo !== hi) return `${f(lo)}–${f(hi)}`
  return f((lo ?? hi)!)
}

/** Whether a profile carries enough to be worth filling the calculator from. */
export function hasSettings(p: PlanterProfile | null | undefined): boolean {
  if (!p) return false
  return (
    p.plate_holes != null ||
    p.seeds_per_acre_min != null ||
    p.seed_spacing_in != null ||
    p.planting_speed_mph != null
  )
}
