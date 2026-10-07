import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
import { buildRequirement, type FieldRequirement, type RecItem } from './fertilizer-plan'

/**
 * Everything the farm needs to buy, by field and in total.
 *
 * Reads the per-acre programme out of each field's assessment and multiplies it
 * by that field's acres. Acres come from the crop plan first and the drawn
 * boundary second: the plan is what is actually going in the ground, and a
 * boundary can include headland a pivot never covers.
 */
export function useRequirements(cropYear: number) {
  const { data, isLoading } = useQuery({
    queryKey: ['fertilizer_requirements', cropYear],
    queryFn: async () => {
      // Every field, including archived ones: a field retired this year can
      // still hold a soil test, and useFields() filters to active — which is
      // why three rows read "Unknown field" on the first real run.
      const [{ data: reports }, { data: plans }, { data: boundaries }, { data: fields }] =
        await Promise.all([
        supabase
          .from('soil_test_reports')
          .select('id, field_id, crop_year, crop_label, soil_test_assessments(recommendation, crop_label)')
          .eq('crop_year', cropYear),
        supabase.from('crop_plans').select('field_id, planned_acres').eq('crop_year', cropYear),
        supabase.from('field_boundaries_geojson').select('field_id, acres'),
        supabase.from('fields').select('id, name, active'),
      ])
      return {
        reports: reports ?? [],
        plans: plans ?? [],
        boundaries: boundaries ?? [],
        fields: fields ?? [],
      }
    },
  })

  const requirements = useMemo<FieldRequirement[]>(() => {
    if (!data) return []
    const fields = data.fields
    const acresByField = new Map<string, number>()
    for (const b of data.boundaries) {
      const acres = Number((b as { acres?: number }).acres ?? 0)
      if (acres > 0) acresByField.set((b as { field_id: string }).field_id, acres)
    }
    // The plan wins where it exists — it is the area actually being seeded.
    for (const p of data.plans) {
      const acres = Number((p as { planned_acres?: number }).planned_acres ?? 0)
      if (acres > 0) acresByField.set((p as { field_id: string }).field_id, acres)
    }

    const byField = new Map<string, { crop: string | null; recs: RecItem[] | null }>()
    for (const r of data.reports) {
      const row = r as {
        field_id: string
        crop_label: string | null
        soil_test_assessments?: { recommendation?: unknown; crop_label?: string | null } | null
      }
      const a = row.soil_test_assessments
      // A field sampled in halves has two reports; their programmes are
      // concatenated rather than averaged, because each half was sampled
      // separately precisely because it differs.
      const recs = Array.isArray(a?.recommendation) ? (a.recommendation as RecItem[]) : null
      const prev = byField.get(row.field_id)
      byField.set(row.field_id, {
        crop: a?.crop_label ?? row.crop_label ?? prev?.crop ?? null,
        recs: recs ? [...(prev?.recs ?? []), ...recs] : (prev?.recs ?? null),
      })
    }

    return [...byField.entries()]
      .map(([fieldId, v]) => {
        const field = fields.find((f) => f.id === fieldId)
        return buildRequirement(
          fieldId,
          field ? (field.active ? field.name : `${field.name} (archived)`) : 'Unknown field',
          v.crop,
          acresByField.get(fieldId) ?? null,
          v.recs,
        )
      })
      .sort((a, b) => a.fieldName.localeCompare(b.fieldName))
  }, [data])

  return { requirements, isLoading }
}

