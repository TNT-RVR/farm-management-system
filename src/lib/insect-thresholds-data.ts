import { useMemo } from 'react'
import { useCropPlans, useCropPrices, useCrops } from './queries'

/**
 * What a scouting pin needs to know about the field it is on before a
 * threshold means anything: which crop is in it, and what that crop is worth.
 *
 * The crop comes from the year's plan rather than from the crop history,
 * because a pin is dropped during the season it describes and the plan is what
 * exists then. A field with no plan gets a null crop and the threshold card
 * stays away, which is right: the same count of lygus is a decision in canola,
 * a different decision in alfalfa seed, and no decision at all in a crop
 * nobody has recorded.
 */
export function useFieldPestCrop(fieldId: string | null | undefined, cropYear: number) {
  const plans = useCropPlans(cropYear)
  const crops = useCrops()
  const prices = useCropPrices(cropYear)

  return useMemo(() => {
    if (!fieldId) return { cropName: null, pricePerBushel: null }
    const plan = (plans.data ?? []).find((p) => p.field_id === fieldId)
    if (!plan) return { cropName: null, pricePerBushel: null }
    const crop = (crops.data ?? []).find((c) => c.id === plan.crop_id)
    const price = (prices.data ?? []).find((p) => p.crop_id === plan.crop_id)
    const n = price ? Number(price.price_per_unit) : NaN
    return {
      cropName: crop?.name ?? null,
      pricePerBushel: Number.isFinite(n) && n > 0 ? n : null,
    }
  }, [fieldId, plans.data, crops.data, prices.data])
}
