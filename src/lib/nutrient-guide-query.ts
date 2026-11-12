import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
import { guideCropFor, guideSoil, type GuideCrop, type GuideSample, type GuideSoil } from './nutrient-guide'

/**
 * Each field's soil test, in the units Alberta's rate tables are indexed by.
 *
 * Separate from useRequirements, which reads the lab's written programme: this
 * reads the analyses the programme was written from, so the province's table
 * can be looked up against the same numbers.
 *
 * A field sampled in halves has two reports, and their samples are pooled here
 * rather than kept apart. guideSoil already averages sites, so two halves are
 * simply more sites and the answer is the field average — which is the right
 * grain for a column read beside a whole-field rate. The halves are still
 * separate everywhere they are looked at on their own.
 */
export type FieldGuideSoil = {
  fieldId: string
  cropLabel: string | null
  crop: GuideCrop | null
  soil: GuideSoil
  samples: number
}

export function useGuideSoil(cropYear: number) {
  return useQuery({
    queryKey: ['nutrient_guide_soil', cropYear],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Map<string, FieldGuideSoil>> => {
      const { data, error } = await supabase
        .from('soil_test_reports')
        .select(
          'id, field_id, crop_label, soil_test_samples(sample_code, depth_top_in, depth_bottom_in, no3n_lb_ac, p_bicarb_ppm, k_ppm, so4s_ppm, zn_ppm), soil_test_assessments(crop_label)',
        )
        .eq('crop_year', cropYear)
      if (error) throw error

      const pooled = new Map<string, { samples: GuideSample[]; cropLabel: string | null }>()
      for (const r of data ?? []) {
        const row = r as unknown as {
          id: string
          field_id: string
          crop_label: string | null
          soil_test_samples: GuideSample[]
          soil_test_assessments:
            | { crop_label: string | null }
            | { crop_label: string | null }[]
            | null
        }
        const a = Array.isArray(row.soil_test_assessments)
          ? row.soil_test_assessments[0]
          : row.soil_test_assessments
        const prev = pooled.get(row.field_id)
        pooled.set(row.field_id, {
          // Sample codes repeat between a field's two halves ('1A' in both), so
          // each report's codes carry its report id to keep the halves' sites
          // apart — pooled without it, two halves would read as one site and
          // their layers would add instead of averaging.
          samples: [
            ...(prev?.samples ?? []),
            ...row.soil_test_samples.map((s) => ({
              ...s,
              sample_code: `${row.id.slice(0, 8)}-${s.sample_code}`,
            })),
          ],
          cropLabel: prev?.cropLabel ?? a?.crop_label ?? row.crop_label ?? null,
        })
      }

      const out = new Map<string, FieldGuideSoil>()
      for (const [fieldId, v] of pooled) {
        out.set(fieldId, {
          fieldId,
          cropLabel: v.cropLabel,
          crop: guideCropFor(v.cropLabel),
          soil: guideSoil(v.samples),
          samples: v.samples.length,
        })
      }
      return out
    },
  })
}
