import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'

/**
 * The figure typed on the plan before the scale replaced it, by
 * `${field_id}:${crop_id}` (crop_history.plan_yield_before, saved by the
 * yield_before trigger the first time a season's yield lands). It is the
 * estimate a harvested field is graded against.
 */
export function useTypedBeforeHarvest(cropYear: number) {
  return useQuery({
    queryKey: ['crop_history', 'plan_yield_before', cropYear],
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<Map<string, number | null>> => {
      const { data, error } = await supabase
        .from('crop_history')
        .select('field_id, crop_id, plan_yield_before')
        .eq('crop_year', cropYear)
        .eq('plan_yield_saved', true)
      if (error) throw error
      const m = new Map<string, number | null>()
      for (const r of data ?? []) {
        if (r.crop_id) m.set(`${r.field_id}:${r.crop_id}`, r.plan_yield_before == null ? null : Number(r.plan_yield_before))
      }
      return m
    },
  })
}

/** Set or clear a field's goal yield for the year (its plan row). */
export function useSetPlanGoal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ planId, goal }: { planId: string; goal: number | null }) => {
      if (goal != null && !(goal > 0)) throw new Error('A goal is a yield above zero, or blank.')
      const { error } = await supabase.from('crop_plans').update({ goal_yield: goal }).eq('id', planId)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['crop_plans'] }),
  })
}
