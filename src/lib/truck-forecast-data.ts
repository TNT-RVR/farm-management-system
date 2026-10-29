import { useMemo } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import { useAuth } from './auth'
import { boundariesForYear, useAllBoundaries, useCropPlans, useCrops, useFields } from './queries'
import { useAllCropZones } from './cropZones'
import { useYieldCuts } from './yield-cuts'
import { useCropVarietySettings } from './crop-variety-settings-data'
import { applyVarietyToCrop, varietyLookup } from './crop-variety-settings'
import { planYieldEstimate, plansWithZones, productionToBushels } from './bins'
import { isOpenLoad, testWeightFor, useBinLoads, useHaulUnits } from './bin-loads'
import { averageLoad, truckForecast, weighedFrom, type AverageLoad, type ForecastLoad, type TruckForecast } from './truck-forecast'

/** One field (one crop on it) in the truck forecast. */
export type FieldTruckForecast = {
  fieldId: string
  fieldName: string
  cropId: string
  cropName: string
  forecastBu: number | null
  lbPerBu: number | null
  average: AverageLoad | null
  forecast: TruckForecast | null
  /** Why there is no forecast, when there is none. */
  why: string | null
}

/**
 * Every planned field's truck forecast for the season (src/lib/truck-forecast.ts),
 * from the same plans, crop areas, yield cuts, varieties and mapped acres the
 * Bin estimator sizes bins from, so the two agree on a field's bushels. Only
 * crops weighed at the scale.
 */
export function useTruckForecasts(cropYear: number) {
  const { data: plans } = useCropPlans(cropYear)
  const { data: crops } = useCrops()
  const { data: fields } = useFields()
  const { data: zones } = useAllCropZones()
  const { data: cuts } = useYieldCuts(cropYear)
  const { data: varieties } = useCropVarietySettings()
  const { data: boundaries } = useAllBoundaries()
  const { data: loads } = useBinLoads()
  const { data: units } = useHaulUnits()

  return useMemo(() => {
    if (!plans || !crops || !loads || !units) return { rows: [] as FieldTruckForecast[], ready: false }
    const activeTrucks = new Set(units.trucks.map((t) => t.name))
    const acres = new Map((boundaries ? boundariesForYear(boundaries, cropYear) : []).map((b) => [b.field_id, b.acres]))
    const varietyOf = varietyLookup(varieties ?? undefined)
    const fl: ForecastLoad[] = loads.map((l) => ({ ...l, open: isOpenLoad(l) }))
    const rows: FieldTruckForecast[] = []
    for (const p of plansWithZones(plans, zones ?? [], cropYear)) {
      const crop = crops.find((c) => c.id === p.crop_id)
      if (!crop || crop.active === false || crop.weighed === false || crop.needs_bins === false) continue
      const vc = applyVarietyToCrop(crop, varietyOf(crop.id, p.variety))
      const a = p.planned_acres ?? acres.get(p.field_id) ?? null
      const y = planYieldEstimate(p, vc, cuts ?? undefined).expected
      const forecastBu = a && y ? productionToBushels(vc, a * y).bushels : null
      const lbPerBu = testWeightFor(vc)
      const average = averageLoad(fl, activeTrucks, crop.id)
      const w = weighedFrom(fl, p.field_id, crop.id, cropYear)
      const forecast = truckForecast({ forecastBu, lbPerBu, average, ...w })
      rows.push({
        fieldId: p.field_id,
        fieldName: fields?.find((f) => f.id === p.field_id)?.name ?? '—',
        cropId: crop.id,
        cropName: crop.name,
        forecastBu,
        lbPerBu,
        average,
        forecast,
        why: forecast
          ? null
          : !a
            ? 'no acres'
            : !y
              ? 'no forecast yield'
              : forecastBu == null
                ? 'yield not in bushels'
                : !lbPerBu
                  ? 'no test weight'
                  : 'no loads weighed yet to average',
      })
    }
    rows.sort((x, z) => x.fieldName.localeCompare(z.fieldName, undefined, { numeric: true }))
    return { rows, ready: true }
  }, [plans, crops, fields, zones, cuts, varieties, boundaries, loads, units, cropYear])
}

/** Whether you see the truck forecast (Settings and the Stats tab switch it). */
export function useShowTruckForecast() {
  const { profile } = useAuth()
  const qc = useQueryClient()
  const set = useMutation({
    mutationFn: async (on: boolean) => {
      if (!profile?.id) throw new Error('Sign in first')
      const { error } = await supabase.from('users').update({ show_truck_forecast: on }).eq('id', profile.id)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['profile'] }),
  })
  return { on: profile?.show_truck_forecast !== false, set }
}
