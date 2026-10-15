import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from './supabase'

/**
 * Yield per crop area on a split field (migration 20261009010000): one row
 * per field, year and crop, filled from the scale loads of that crop over
 * that crop's own acres, with a manager's figure able to stand over it.
 * Read through an untyped handle and shaped here.
 */
const db = supabase as unknown as SupabaseClient

export type CropAreaYield = {
  id: string
  field_id: string
  crop_year: number
  crop_id: string
  acres: number | null
  yield_unit: string | null
  yield_per_acre: number | null
  actual_yield_total: number | null
  scale_total: number | null
  scale_loads: number | null
  yield_override: boolean
  source: string
  notes: string | null
}

const num = (v: unknown) => (v == null ? null : Number(v))
const shape = (r: Record<string, unknown>): CropAreaYield =>
  ({
    ...r,
    acres: num(r.acres),
    yield_per_acre: num(r.yield_per_acre),
    actual_yield_total: num(r.actual_yield_total),
    scale_total: num(r.scale_total),
  }) as CropAreaYield

export async function fetchAreaYields(filter?: { fieldId?: string; cropYear?: number }): Promise<CropAreaYield[]> {
  let q = db.from('crop_area_yields').select('*')
  if (filter?.fieldId) q = q.eq('field_id', filter.fieldId)
  if (filter?.cropYear != null) q = q.eq('crop_year', filter.cropYear)
  const { data, error } = await q
  if (error) throw error
  return (data ?? []).map(shape)
}

export function useFieldAreaYields(fieldId: string | null | undefined, cropYear: number) {
  return useQuery({
    queryKey: ['crop_area_yields', fieldId, cropYear],
    enabled: Boolean(fieldId),
    queryFn: () => fetchAreaYields({ fieldId: fieldId!, cropYear }),
  })
}

/** A manager's figure for one crop area; it stands over the scale's until cleared. */
export function useSaveAreaYield() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { id?: string; field_id: string; crop_year: number; crop_id: string; acres: number | null; yield_per_acre: number | null; yield_unit: string | null; notes: string | null }) => {
      const total = v.yield_per_acre != null && v.acres != null ? Math.round(v.yield_per_acre * v.acres) : null
      const row = { ...v, actual_yield_total: total, yield_override: v.yield_per_acre != null, source: v.yield_per_acre != null ? 'manual' : 'scale', updated_at: new Date().toISOString() }
      const { error } = v.id
        ? await db.from('crop_area_yields').update(row).eq('id', v.id)
        : await db.from('crop_area_yields').insert(row)
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['crop_area_yields'] })
      void qc.invalidateQueries({ queryKey: ['crop_history'] })
    },
  })
}

/** Drop the typed figure and take the scale's again. */
export function useUseAreaScale() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.rpc('use_area_scale_yield', { p_id: id })
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['crop_area_yields'] })
      void qc.invalidateQueries({ queryKey: ['crop_history'] })
    },
  })
}
