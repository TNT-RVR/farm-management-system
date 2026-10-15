import { useMemo } from 'react'
import { useCropPlans, useCrops } from './queries'
import { useFieldCropZones } from './cropZones'
import { useYieldHistory } from './forecast-data'
import { expectedYield } from './forecast'
import { useCropPriceMap } from './fert-savings/data'
import { SEED_DEFAULTS, type CombineCropKey } from './combine'
import { cropForVariety } from './crop-variety-settings'
import { useCropVarietySettings } from './crop-variety-settings-data'

/**
 * What a loss check needs from the field it is taken in: the crop, the yield
 * the loss is a share of, the price it is worth and the acres it runs over —
 * so the person in the field picks the field and weighs, and types nothing
 * the app already knows.
 */

const LB_PER_TONNE = 2204.62

/** The loss calculator's crop for one of the farm's crops, by name. */
export function combineCropOf(name: string | null | undefined): CombineCropKey | null {
  const n = (name ?? '').toLowerCase()
  if (/canola/.test(n)) return 'canola'
  if (/durum/.test(n)) return 'durum'
  if (/wheat/.test(n)) return 'wheat'
  if (/barley/.test(n)) return 'barley'
  if (/oat/.test(n)) return 'oats'
  if (/sainfoin/.test(n)) return 'sainfoin'
  if (/bean/.test(n)) return 'beans'
  if (/corn/.test(n) && !/silage/.test(n)) return 'corn'
  return null
}

/** Bushels in one of a crop's yield units, at its lb per bushel. Null for a unit that is not grain. */
export function bushelsPer(unit: string | null | undefined, lbPerBu: number): number | null {
  if (lbPerBu <= 0) return null
  switch ((unit ?? '').toLowerCase()) {
    case 'bu':
      return 1
    case 'lbs':
    case 'lb':
      return 1 / lbPerBu
    case 'cwt':
      return 100 / lbPerBu
    case 'mt':
    case 't':
      return LB_PER_TONNE / lbPerBu
    default:
      return null
  }
}

export type LossFieldDefaults = {
  cropName: string | null
  cropKey: CombineCropKey | null
  yieldBu: number | null
  /** Where the yield came from, in words. */
  yieldFrom: string | null
  priceBu: number | null
  acres: number | null
  /** A split field's crop areas, to choose which one the check is in. */
  areas: { id: string; cropName: string; acres: number | null }[]
  /** The area the defaults are for (the chosen one, else the biggest). */
  areaId: string | null
}

export function useLossFieldDefaults(fieldId: string, cropYear: number, zoneId: string | null = null): LossFieldDefaults | null {
  const { data: plans } = useCropPlans(cropYear)
  const { data: zones } = useFieldCropZones(fieldId || null, cropYear)
  const { data: crops } = useCrops()
  const { data: history } = useYieldHistory()
  const { data: prices } = useCropPriceMap(cropYear)
  const { data: varietySettings } = useCropVarietySettings()

  return useMemo(() => {
    if (!fieldId) return null
    const cropOf = (id: string | null | undefined) => (crops ?? []).find((c) => c.id === id)
    const mine = (plans ?? []).filter((p) => p.field_id === fieldId)
    const plan = [...mine].sort((a, b) => Number(b.planned_acres ?? 0) - Number(a.planned_acres ?? 0))[0]
    // A split field: the check is in one crop area — the chosen one, else the biggest.
    const areas = [...(zones ?? [])]
      .sort((a, b) => Number(b.acres ?? 0) - Number(a.acres ?? 0))
      .map((z) => ({ id: z.id, cropId: z.crop_id, cropName: cropOf(z.crop_id)?.name ?? 'Crop', acres: z.acres == null ? null : Number(z.acres) }))
    const area = areas.find((a) => a.id === zoneId) ?? areas[0] ?? null
    const crop = area ? cropOf(area.cropId) : plan ? cropOf(plan.crop_id) : undefined
    const cropKey = combineCropOf(crop?.name)
    const acresSum = mine.reduce((s, p) => s + Number(p.planned_acres ?? 0), 0)
    const acres = area ? area.acres : acresSum > 0 ? acresSum : null
    const base = { areas: areas.map(({ id, cropName, acres: a }) => ({ id, cropName, acres: a })), areaId: area?.id ?? null }
    if (!crop) return { cropName: null, cropKey: null, yieldBu: null, yieldFrom: null, priceBu: null, acres, ...base }

    const perBu = bushelsPer(crop.yield_unit, cropKey ? SEED_DEFAULTS[cropKey].lbPerBushel : 0)
    const inBu = (v: number | null) => (v == null || perBu == null ? null : v * perBu)

    // This season's own harvest first, then the plan's figure, then what the field or farm usually does.
    const actual = (history ?? []).find((r) => r.field_id === fieldId && r.crop_year === cropYear && r.crop_id === crop.id && r.yield_per_acre != null)
    let yieldIn: number | null
    let yieldFrom: string | null
    if (actual) {
      yieldIn = Number(actual.yield_per_acre)
      yieldFrom = `this field's ${cropYear} harvest`
    } else if (!area && plan?.yield_per_acre_override != null) {
      yieldIn = Number(plan.yield_per_acre_override)
      yieldFrom = `the ${cropYear} crop plan`
    } else {
      const e = expectedYield({ cropId: crop.id, fieldId, year: cropYear, unit: crop.yield_unit, goal: cropForVariety(crop, plan?.crop_id === crop.id ? plan.variety : null, varietySettings).default_yield_per_acre, history: history ?? [] })
      yieldIn = e.value
      yieldFrom = e.value != null ? e.label : null
    }
    const price = prices?.get(crop.id) ?? null
    return {
      cropName: crop.name,
      cropKey,
      yieldBu: inBu(yieldIn),
      yieldFrom,
      // A price per yield unit, as a price per bushel.
      priceBu: price == null || perBu == null ? null : price / perBu,
      acres,
      ...base,
    }
  }, [fieldId, zoneId, zones, plans, crops, history, prices, cropYear, varietySettings])
}
