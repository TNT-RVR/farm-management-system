import { supabase } from '@/lib/supabase'
import { fuelCostingInputsQuery } from '@/lib/fuel-data'
import {
  abDefaultsQuery,
  allFuelOpsQuery,
  basicsFrom,
  fieldEntriesQuery,
  fieldPointsQuery,
  fuelSettingsFrom,
  operatingSettingsQuery,
  placesFrom,
  roadRoutesQuery,
  sitesQuery,
  tripsFrom,
  truckSettingsFrom,
} from '@/lib/hauling-data'
import { fuelModelFrom } from '@/lib/operating-costs'
import { fetchAll } from './framework'

/**
 * Everything the fuel and trucking reports cost with, read once, outside
 * React: the same queries the Travel & trucking page makes, resolved by the
 * same functions its hooks call (the diesel price chain, the farm's fuel and
 * truck settings over the defaults, the shop and bins, every distance), so a
 * report's litres and dollars are the page's.
 */
export async function loadOperating() {
  const [settings, ab, fuel, routes, points, sites, entries, boundaries, logged] = await Promise.all([
    operatingSettingsQuery().queryFn(),
    abDefaultsQuery().queryFn(),
    fuelCostingInputsQuery().queryFn(),
    roadRoutesQuery().queryFn(),
    fieldPointsQuery().queryFn(),
    sitesQuery().queryFn(),
    fieldEntriesQuery().queryFn(),
    fetchAll<{ field_id: string; valid_to: string | null; acres: number | string | null }>((a, b) =>
      supabase.from('field_boundaries_geojson').select('field_id, valid_to, acres').order('field_id').order('valid_from').range(a, b),
    ),
    allFuelOpsQuery().queryFn(),
  ])
  const basics = basicsFrom(settings, ab, fuel)
  const { shop, bins, pit } = placesFrom(settings)
  const trip = tripsFrom({ routes, points, sites, entries, shop, bins, pit })
  const model = fuelModelFrom({ settings: fuelSettingsFrom(settings, basics.dieselPerL), boundaries, logged, trip, ready: true })
  return { basics, model, trip, sites, truck: truckSettingsFrom(settings), places: { shop, bins } }
}

export type Operating = Awaited<ReturnType<typeof loadOperating>>
