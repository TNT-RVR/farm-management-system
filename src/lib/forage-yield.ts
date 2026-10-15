import type { Database } from './database.types'

// The grazing calculator's arithmetic, with no Supabase client attached, so the
// pasture move-out check on the server reads forage exactly the way the Grazing
// tab does. grazing.ts re-exports all of it; nothing outside imports this file
// except code that runs where the browser client cannot.

export type PastureRow = Database['public']['Tables']['grazing_pastures']['Row']

// ---- constants (from the spreadsheet) ----
export const ACRES_PER_HECTARE = 2.47105
export const AU_LBS_PER_DAY = 26 // 1 Animal Unit eats 26 lbs of feed/day
export const AUM_LBS = AU_LBS_PER_DAY * 30 // 780 lbs = one Animal Unit Month
export const GRASS_QUALITIES = ['Excellent', 'Good', 'Fair', 'Poor'] as const
export type GrassQuality = (typeof GRASS_QUALITIES)[number]

/** Forage Yield Estimator — lbs/acre by growing-season precip band × grass quality. */
export const FORAGE_YIELD_ESTIMATOR: {
  label: string
  lo: number
  hi: number
  yields: Record<GrassQuality, number>
}[] = [
  { label: '250–350 mm', lo: 250, hi: 350, yields: { Excellent: 700, Good: 460, Fair: 370, Poor: 230 } },
  { label: '350–450 mm', lo: 350, hi: 450, yields: { Excellent: 1150, Good: 740, Fair: 550, Poor: 370 } },
  { label: '450–550 mm', lo: 450, hi: 550, yields: { Excellent: 1850, Good: 1300, Fair: 1000, Poor: 650 } },
  { label: '550–650 mm', lo: 550, hi: 650, yields: { Excellent: 3000, Good: 2000, Fair: 1500, Poor: 1000 } },
]
/** Irrigation reference row (shown in the estimator; not used by the precip lookup). */
export const FORAGE_YIELD_IRRIGATION: Record<GrassQuality, number> = {
  Excellent: 6900,
  Good: 5150,
  Fair: 3500,
  Poor: 2300,
}

/** lbs/acre for the given growing-season precip + grass quality (clamps out-of-range precip). */
export function forageYieldPerAcre(precipMm: number, quality: string): number {
  const q = (GRASS_QUALITIES.includes(quality as GrassQuality) ? quality : 'Fair') as GrassQuality
  const band =
    FORAGE_YIELD_ESTIMATOR.find((b) => precipMm >= b.lo && precipMm <= b.hi) ??
    (precipMm < FORAGE_YIELD_ESTIMATOR[0].lo
      ? FORAGE_YIELD_ESTIMATOR[0]
      : FORAGE_YIELD_ESTIMATOR[FORAGE_YIELD_ESTIMATOR.length - 1])
  return band.yields[q]
}

export type PastureCalc = PastureRow & {
  hectares: number
  acres: number
  nativeGrassAc: number
  totalGrazeableAc: number
  foragePerAcre: number
  foragePerAcreUtil: number
  totalLbs: number
  aums: number
  auds: number
}

/** Expand a pasture's stored inputs into all the derived columns (mirrors the sheet). */
export function computePasture(p: PastureRow, precipMm: number, utilization: number): PastureCalc {
  const hectares = p.km2 * 100
  const acres = hectares * ACRES_PER_HECTARE
  const nativeGrassAc = acres - (p.non_grazeable_ac + p.irrigated_ac)
  const totalGrazeableAc = p.grazeable_irrigated_ac + nativeGrassAc
  const foragePerAcre = forageYieldPerAcre(precipMm, p.grass_quality)
  const foragePerAcreUtil = foragePerAcre * utilization
  const totalLbs = totalGrazeableAc * foragePerAcreUtil
  return {
    ...p,
    hectares,
    acres,
    nativeGrassAc,
    totalGrazeableAc,
    foragePerAcre,
    foragePerAcreUtil,
    totalLbs,
    aums: totalLbs / AUM_LBS,
    auds: totalLbs / AU_LBS_PER_DAY,
  }
}
