import { useCallback, useMemo } from 'react'
import { useRequirements } from '@/lib/requirements'
import { useCropPlans, useCrops, useFields } from '@/lib/queries'
import { useCropHistoryAll, useIrrigatedFields, useManureWithTimes } from '@/lib/fert-savings/data'

/**
 * What the 4R / NERP record pack reads besides its own queries: the fields,
 * the season's plans and recommendations, yield history, manure and which
 * fields are irrigated.
 *
 * The Savings tab gets these from its shared context, which loads twenty
 * tools' worth of data; the Reports page needs only these, so it asks for
 * only these. buildNerpPack itself is the same function either way.
 */
export function useNerpInputs(cropYear: number) {
  const { requirements, isLoading: reqLoading } = useRequirements(cropYear)
  const history = useCropHistoryAll()
  const irrigated = useIrrigatedFields()
  const fields = useFields()
  const crops = useCrops()
  const plans = useCropPlans(cropYear)
  const manure = useManureWithTimes()

  const queries = [history, irrigated, fields, crops, plans, manure]
  const error = (queries.find((q) => q.error)?.error as Error | undefined) ?? null
  const ready = !reqLoading && queries.every((q) => q.data !== undefined)

  const planFor = useCallback((fieldId: string) => (plans.data ?? []).find((p) => p.field_id === fieldId) ?? null, [plans.data])
  const cropOf = useCallback((cropId: string | null | undefined) => (crops.data ?? []).find((c) => c.id === cropId) ?? null, [crops.data])

  const inputs = useMemo(
    () => ({
      fields: fields.data ?? [],
      requirements,
      history: history.data ?? [],
      manure: manure.data ?? [],
      irrigated: irrigated.data ?? new Set<string>(),
      planFor,
      cropOf,
    }),
    [fields.data, requirements, history.data, manure.data, irrigated.data, planFor, cropOf],
  )

  // The season's planned fields with a crop, as the Savings tab lists them.
  const planned = useMemo(
    () =>
      (plans.data ?? [])
        .filter((p) => p.crop_year === cropYear && p.field_id && p.crop_id)
        .flatMap((p) => {
          const field = (fields.data ?? []).find((f) => f.id === p.field_id)
          return field && cropOf(p.crop_id) ? [{ fieldId: field.id, name: field.name }] : []
        })
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
    [plans.data, fields.data, cropOf, cropYear],
  )

  return { ready, error, inputs, planned }
}
