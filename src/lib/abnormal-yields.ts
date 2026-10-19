import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from './supabase'

/**
 * "Not a normal year" on a harvested crop (Sam, 16 Oct 2026: the yellow
 * beans' cover crop wouldn't die, "so not the normal and probably [shouldn't]
 * contribute to the average yield").
 *
 * One mark per field, crop year and crop (abnormal_yield_years, migration
 * 20261016070000), so each crop area of a split field is marked on its own.
 * crop_yields_v carries it as exclude_from_averages / abnormal_reason;
 * readers of crop_history and crop_area_yields attach it with withAbnormal.
 *
 * A marked yield still shows in every history list and against its estimate;
 * every average and history-based estimate leaves it out (forecast.ts
 * isActualYield).
 */

export type AbnormalYear = { id: string; field_id: string; crop_year: number; crop_id: string; reason: string }

/** What a yield row carries once the marks are attached. */
export type AbnormalFlag = { exclude_from_averages: boolean; abnormal_reason: string | null }

export const abnormalKey = (fieldId: string, cropYear: number, cropId: string | null | undefined) => `${fieldId}:${cropYear}:${cropId ?? ''}`

/** The words a marked yield shows beside it. */
export const abnormalText = (reason: string | null | undefined) => `Abnormal — left out of averages${reason ? `: ${reason}` : ''}`

/** The longest reason the table takes. */
export const ABNORMAL_REASON_MAX = 200

const db = supabase as unknown as SupabaseClient

/** Every mark (a few a year at most). Takes the client so a script can read them too. */
export async function fetchAbnormalYears(sb: SupabaseClient = db): Promise<AbnormalYear[]> {
  const { data, error } = await sb.from('abnormal_yield_years').select('id, field_id, crop_year, crop_id, reason')
  if (error) throw error
  return (data ?? []) as AbnormalYear[]
}

/** Marks by abnormalKey. */
export function abnormalIndex(marks: readonly AbnormalYear[]): Map<string, AbnormalYear> {
  return new Map(marks.map((m) => [abnormalKey(m.field_id, m.crop_year, m.crop_id), m]))
}

/** The rows with their mark attached: a marked one is left out of averages. */
export function withAbnormal<R extends { field_id: string; crop_year: number; crop_id: string | null }>(
  rows: readonly R[],
  marks: readonly AbnormalYear[],
): (R & AbnormalFlag)[] {
  const by = abnormalIndex(marks)
  return rows.map((r) => {
    const m = by.get(abnormalKey(r.field_id, r.crop_year, r.crop_id))
    return { ...r, exclude_from_averages: Boolean(m), abnormal_reason: m?.reason ?? null }
  })
}

export function useAbnormalYears() {
  return useQuery({
    queryKey: ['abnormal_yield_years', 1],
    staleTime: 10 * 60_000,
    queryFn: () => fetchAbnormalYears(),
  })
}

/** The queries whose averages or history lists change with a mark. */
const AFFECTED = new Set([
  'abnormal_yield_years',
  'crop_history',
  'crop_area_yields',
  'field_yield',
  'fert_crop_history',
  'rotation-context',
  'crop-compare-field',
  'crop-compare-farm',
  'water-season-review',
])

/** Mark a harvest as not a normal year (with a reason), or clear the mark (reason null). */
export function useSetAbnormalYear() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { fieldId: string; cropYear: number; cropId: string; reason: string | null }) => {
      const reason = v.reason?.trim() ?? ''
      if (v.reason == null) {
        const { error } = await db
          .from('abnormal_yield_years')
          .delete()
          .eq('field_id', v.fieldId)
          .eq('crop_year', v.cropYear)
          .eq('crop_id', v.cropId)
        if (error) throw error
        return
      }
      if (!reason) throw new Error('Give a short reason, e.g. "cover crop wouldn’t die".')
      if (reason.length > ABNORMAL_REASON_MAX) throw new Error(`Keep the reason under ${ABNORMAL_REASON_MAX} characters.`)
      const { error } = await db
        .from('abnormal_yield_years')
        .upsert(
          { field_id: v.fieldId, crop_year: v.cropYear, crop_id: v.cropId, reason, updated_at: new Date().toISOString() },
          { onConflict: 'field_id,crop_year,crop_id' },
        )
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ predicate: (q) => AFFECTED.has(String(q.queryKey[0])) }),
  })
}
