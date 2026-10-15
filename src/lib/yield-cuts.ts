import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import type { YieldCut } from './yield-estimate'

/** Every cut to an estimated yield in a crop year (small: a handful a season). */
export function yieldCutsQuery(cropYear: number) {
  return {
    queryKey: ['yield_adjustments', cropYear],
    queryFn: async (): Promise<YieldCut[]> => {
      const { data, error } = await supabase
        .from('yield_adjustments')
        .select('id, field_id, crop_year, crop_id, zone_id, loss_pct, reason')
        .eq('crop_year', cropYear)
      if (error) throw error
      return (data ?? []).map((r) => ({ ...r, loss_pct: Number(r.loss_pct) }))
    },
  }
}

export function useYieldCuts(cropYear: number) {
  return useQuery(yieldCutsQuery(cropYear))
}

/** Add, change or remove a cut. Everything that reads an estimate refreshes. */
export function useYieldCutMutations() {
  const qc = useQueryClient()
  const refresh = () => {
    for (const key of ['yield_adjustments', 'crop_position']) void qc.invalidateQueries({ queryKey: [key] })
  }
  const save = useMutation({
    mutationFn: async (c: { id?: string; field_id: string; crop_year: number; crop_id: string | null; zone_id: string | null; loss_pct: number; reason: string }) => {
      const { id, ...row } = c
      const { error } = id
        ? await supabase.from('yield_adjustments').update({ crop_id: row.crop_id, zone_id: row.zone_id, loss_pct: row.loss_pct, reason: row.reason }).eq('id', id)
        : await supabase.from('yield_adjustments').insert(row)
      if (error) {
        if (error.code === '23505') throw new Error('There is already a cut for that crop on this field — open it to change it.')
        throw error
      }
    },
    onSuccess: refresh,
  })
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('yield_adjustments').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: refresh,
  })
  return { save, remove }
}
