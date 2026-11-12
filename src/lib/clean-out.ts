import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

/**
 * The clean-out to take off a truckload before valuing it (Sam, 2 Nov 2026):
 * the crop's estimate (Estimated clean-out % on the crop's page) until the
 * field's yield after clean-out is entered, then that field's actual —
 * 1 − clean total ÷ the field-run scale total — so every load from the field
 * revalues by itself.
 */
export type CleanOut = { pct: number; actual: boolean }

/** Null when neither the field's actual nor the crop's estimate is known. */
export function cleanOutFor(
  history: { clean_total: number | null; scale_total: number | null } | null | undefined,
  estimatePct: number | null | undefined,
): CleanOut | null {
  const clean = history?.clean_total == null ? null : Number(history.clean_total)
  const scale = history?.scale_total == null ? null : Number(history.scale_total)
  if (clean != null && scale != null && scale > 0 && clean > 0) {
    return { pct: Math.round(Math.min(99, Math.max(0, (1 - clean / scale) * 100)) * 100) / 100, actual: true }
  }
  if (estimatePct != null && Number.isFinite(Number(estimatePct))) return { pct: Number(estimatePct), actual: false }
  return null
}

/**
 * The field's crop-history row for the season: its scale total and, once
 * entered, its yield after clean-out. Keyed under crop_history, which every
 * load and yield change refreshes.
 */
export function useFieldCleanYield(fieldId: string | null, cropId: string, cropYear: number) {
  return useQuery({
    queryKey: ['crop_history', 'clean', fieldId, cropId, cropYear],
    enabled: !!fieldId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('crop_history')
        .select('clean_total, scale_total')
        .eq('field_id', fieldId!)
        .eq('crop_id', cropId)
        .eq('crop_year', cropYear)
        .maybeSingle()
      if (error) throw error
      return data as { clean_total: number | null; scale_total: number | null } | null
    },
  })
}
