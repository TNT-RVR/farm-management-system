import { useMemo } from 'react'
import { useLandDeals } from './land-deals-data'
import { useFixedAreas, useFixedPerAcre, useLandSharePerAcre } from './farm-costs'
import { useProductResolver } from './products'
import { useFields } from './queries'
import { farmBooks, seasonsFrom, useFarmData } from './profit-loss-farm'
import { useOperatingCostLines } from './operating-costs'
import { useSeasonFuelOps } from './hauling-data'

/**
 * Every field's books for a crop year: what the farm Profit / Loss map colours
 * by, and what the Compare view's Profit / Loss panes use. One place, so the
 * two can never disagree on a field's net.
 */
export function useFarmBooks(cropYear: number, priceMode: 'target' | 'actual') {
  const { data: fields } = useFields()
  const { data, isLoading, error } = useFarmData(cropYear)
  const resolve = useProductResolver()
  const { data: deals } = useLandDeals()
  const fixed = useFixedPerAcre(cropYear)
  const fixedAreas = useFixedAreas(cropYear)
  const { data: landSharePerAcre } = useLandSharePerAcre(cropYear)
  // Fuel and trucking per field, priced the same as each field's own page.
  const { data: fuelOps } = useSeasonFuelOps(cropYear)
  const operatingLines = useOperatingCostLines(cropYear, fuelOps)

  const seasons = useMemo(() => (data ? seasonsFrom(data, priceMode) : new Map()), [data, priceMode])
  const books = useMemo(() => {
    if (!data || !fields || !resolve) return []
    return farmBooks({
      cropYear,
      fields: fields.map((f) => ({ id: f.id, name: f.name })),
      seasons,
      ops: data.ops,
      layers: data.layers,
      saved: data.saved,
      resolve,
      priceSource: priceMode,
      deals: deals ?? [],
      fixedPerAcre: fixed.perAcre,
      fixedFrom: fixed.carriedFrom,
      fixedAreas,
      landSharePerAcre: landSharePerAcre ?? null,
      extraLines: operatingLines,
    })
  }, [data, fields, resolve, cropYear, priceMode, seasons, deals, fixed.perAcre, fixed.carriedFrom, fixedAreas, landSharePerAcre, operatingLines])
  return { books, seasons, fixed, isLoading, error }
}
