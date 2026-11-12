import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import type { Answers } from './sclerotinia'
import type { Database } from './database.types'

export type ChecklistRow = Database['public']['Tables']['sclerotinia_checklists']['Row']

/** Every checklist for a crop year, by field id. */
export function useSclerotiniaChecklists(cropYear: number) {
  return useQuery({
    queryKey: ['sclerotinia_checklists', cropYear],
    queryFn: async (): Promise<Map<string, ChecklistRow>> => {
      const { data, error } = await supabase
        .from('sclerotinia_checklists')
        .select('*')
        .eq('crop_year', cropYear)
      if (error) throw error
      return new Map((data ?? []).map((r) => [r.field_id, r as ChecklistRow]))
    },
  })
}

export function useSaveChecklist(cropYear: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { fieldId: string; answers: Answers; notes: string | null }) => {
      const { error } = await supabase.from('sclerotinia_checklists').upsert(
        {
          field_id: v.fieldId,
          crop_year: cropYear,
          answers: v.answers,
          notes: v.notes,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'field_id,crop_year' },
      )
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sclerotinia_checklists', cropYear] }),
  })
}

/**
 * What the app can already answer, per field.
 *
 * Offered, never applied: every one of these questions is a judgement the sheet
 * asks a person to make, and a records-based guess that filled itself in would
 * be a verdict the farm never gave. The screen shows the suggestion beside the
 * option it points at and waits to be clicked.
 *
 *  - Q2 and Q10, sclerotinia and apothecia seen before: the scouting records.
 *  - Q7, whether a sclerotinia fungicide helped: whether one was ever sprayed.
 *  - Q14, yield potential: the crop plan's goal for this field this year.
 *  - Q15, what those 30+ bu/ac fields actually did: the yield history.
 *
 * Questions 9 and 11 want weather before and during flowering. They are left
 * to the grower here rather than read off a station: "wet enough for the soil to
 * stay moist for extended periods" is not a rainfall total, and the nearest
 * station is not the field.
 */
export type ChecklistHints = {
  /** Question number → the points the records point at, with why. */
  hints: Record<string, { points: number; why: string }>
}

export function useChecklistHints(cropYear: number) {
  return useQuery({
    queryKey: ['sclerotinia_hints', cropYear],
    queryFn: async (): Promise<Map<string, ChecklistHints>> => {
      // Question 15 asks what this field's CANOLA did when the potential was
      // 30+ bu/ac, so a wheat yield off the same field is the wrong answer.
      const { data: crops, error: cropsError } = await supabase.from('crops').select('id, name')
      if (cropsError) throw cropsError
      const canolaIds = (crops ?? []).filter((c) => /canola/i.test(c.name ?? '')).map((c) => c.id)

      const [scouting, yields] = await Promise.all([
        supabase
          .from('scouting_notes')
          .select('field_id, crop_year, subject, note, severity')
          .eq('category', 'disease')
          .lte('crop_year', cropYear),
        canolaIds.length
          ? supabase
              .from('crop_yields_v')
              .select('field_id, crop_year, yield_per_acre, yield_unit')
              .in('crop_id', canolaIds)
              .lt('crop_year', cropYear)
          : Promise.resolve({ data: [], error: null }),
      ])
      for (const r of [scouting, yields]) if (r.error) throw r.error

      const out = new Map<string, ChecklistHints>()
      const touch = (id: string) => {
        if (!out.has(id)) out.set(id, { hints: {} })
        return out.get(id)!
      }

      for (const s of scouting.data ?? []) {
        const row = s as {
          field_id: string | null
          crop_year: number
          subject: string | null
          note: string | null
          severity: number
        }
        if (!row.field_id) continue
        const text = `${row.subject ?? ''} ${row.note ?? ''}`
        if (/sclerotinia|white stem|stem rot/i.test(text)) {
          touch(row.field_id).hints['2'] = {
            points: 20,
            why: `scouted in ${row.crop_year}${row.subject ? ` as ${row.subject}` : ''}, severity ${row.severity}`,
          }
        }
        if (/apothec/i.test(text)) {
          touch(row.field_id).hints['10'] = {
            points: 20,
            why: `apothecia noted in ${row.crop_year}`,
          }
        }
      }

      // Q15: a field whose canola came off between 20 and 30 bu/ac scores 20.
      // Only bushels count — a tonne figure would read as a 2 bu/ac crop.
      const best = new Map<string, { year: number; yield: number }>()
      for (const y of yields.data ?? []) {
        const row = y as {
          field_id: string
          crop_year: number
          yield_per_acre: number | string | null
          yield_unit: string | null
        }
        const v = row.yield_per_acre == null ? null : Number(row.yield_per_acre)
        if (v == null || !Number.isFinite(v)) continue
        if (!/^bu/i.test(row.yield_unit ?? '')) continue
        const prev = best.get(row.field_id)
        if (!prev || row.crop_year > prev.year) best.set(row.field_id, { year: row.crop_year, yield: v })
      }
      for (const [fieldId, v] of best) {
        if (v.yield >= 20 && v.yield < 30) {
          touch(fieldId).hints['15'] = {
            points: 20,
            why: `${v.yield.toFixed(1)} bu/ac in ${v.year}, under a 30 bu/ac potential`,
          }
        } else if (v.yield >= 30) {
          touch(fieldId).hints['15'] = { points: 0, why: `${v.yield.toFixed(1)} bu/ac in ${v.year}` }
        }
      }
      return out
    },
    staleTime: 10 * 60_000,
  })
}
