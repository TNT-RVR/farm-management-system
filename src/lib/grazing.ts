import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import type { Database } from './database.types'
import type { Ranch } from './ranches'
import { RAIN_NORMAL_YEARS, rainOutlook, type SeasonNormal } from './rain-normals'
import type { GrassQuality } from './forage-yield'

// The forage arithmetic lives in forage-yield.ts (no Supabase client), so the
// server's pasture move-out check uses exactly these numbers too.
export {
  ACRES_PER_HECTARE,
  AU_LBS_PER_DAY,
  AUM_LBS,
  computePasture,
  FORAGE_YIELD_ESTIMATOR,
  FORAGE_YIELD_IRRIGATION,
  forageYieldPerAcre,
  GRASS_QUALITIES,
  type GrassQuality,
  type PastureCalc,
  type PastureRow,
} from './forage-yield'

// The grazing herd reads from herd_counts — the same rows the Feed tab uses — so
// head is entered once, on the Herd tab. Only the grazing window lives here.
// (grazing_herd still exists but is no longer read; see migration 20260804030000.)
export type HerdRow = Database['public']['Tables']['herd_counts']['Row']

export const GRAZEABLE_AREAS_MAP_URL =
  'https://www.google.com/maps/d/u/0/edit?mid=YOUR_MY_MAPS_ID&ll=52.41062021054227%2C-108.70237975575077&z=16'
export const CARRYING_CAPACITY_CALC_URL =
  'https://www.beefresearch.ca/tools/carrying-capacity-calculator-method-1/'

/** Pasture Rating guide (reference only). */
export const PASTURE_RATING_GUIDE: { category: string; values: Record<GrassQuality, string> }[] = [
  { category: 'Potential yield of the area', values: { Excellent: '75–100%', Good: '60–75%', Fair: '50–60%', Poor: '33–50%' } },
  { category: 'Production from desirable, adapted grass & legumes', values: { Excellent: '95%', Good: '90%', Fair: '60%', Poor: 'Less than 50%' } },
  { category: 'Production from weeds or undesirable plants', values: { Excellent: 'Less than 5%', Good: 'Less than 10%', Fair: '20% or more', Poor: '50% or more' } },
  { category: 'Fertility program', values: { Excellent: 'Average to above average', Good: 'Average', Fair: 'Below average or non-existent', Poor: 'No fertility program' } },
]

/** Whole-number days between two ISO dates (end − start); 0 if either is missing. */
export function daysGrazing(start: string | null, end: string | null): number {
  if (!start || !end) return 0
  const d = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86_400_000)
  return d > 0 ? d : 0
}

export type HerdCalc = HerdRow & { totalAU: number; days: number; audsRequired: number }

export function computeHerd(h: HerdRow): HerdCalc {
  const totalAU = h.au_equivalent * h.head_count
  const days = daysGrazing(h.graze_start, h.graze_end)
  return { ...h, totalAU, days, audsRequired: totalAU * days }
}

// ---- data hooks (all scoped to one ranch) ----
export function useGrazingPastures(ranchId: string | null | undefined) {
  return useQuery({
    queryKey: ['grazing_pastures', ranchId],
    enabled: Boolean(ranchId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('grazing_pastures')
        .select('*')
        .eq('ranch_id', ranchId!)
        .order('sort_order')
      if (error) throw error
      return data
    },
  })
}

/**
 * The ranch's herd classes for the grazing calculator, read from herd_counts so
 * head is never entered twice. Classes are added/removed on the Herd tab; only
 * the grazing window (and the modelling knobs) are editable from Grazing.
 */
export function useGrazingHerd(ranchId: string | null | undefined) {
  return useQuery({
    queryKey: ['herd_counts', ranchId],
    enabled: Boolean(ranchId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('herd_counts')
        .select('*')
        .eq('ranch_id', ranchId!)
        .order('sort_order')
      if (error) throw error
      return data
    },
  })
}

export type GrazingSettings = {
  id: string
  grazing_utilization_rate: number | null
  grazing_precip_mm: number | null
}

/** Per-ranch grazing knobs (utilization + precip) — live on the ranch row. */
export function useGrazingSettings(ranchId: string | null | undefined) {
  return useQuery({
    queryKey: ['grazing_settings', ranchId],
    enabled: Boolean(ranchId),
    queryFn: async (): Promise<GrazingSettings> => {
      const { data, error } = await supabase
        .from('ranches')
        .select('id, grazing_utilization_rate, grazing_precip_mm')
        .eq('id', ranchId!)
        .single()
      if (error) throw error
      return data
    },
  })
}

export type RanchPrecip = {
  total_mm: number
  days: number
  through: string
  series: { t: string; mm: number }[]
  /** The same season over the last ten whole years; null if the archive failed. */
  normal?: SeasonNormal | null
}

export type GrazingRain = {
  /** The rain the forage forecast is planned on, mm. */
  forecastMm: number
  forecastSource: 'normal' | 'manual'
  /** This season so far, when measured. */
  toDateMm: number | null
  /** The 10-year average to the same day. */
  normalToDateMm: number | null
  pctOfNormal: number | null
  /** This year so far plus a normal rest of season. */
  projectedMm: number | null
}

/**
 * Which rain the grazing numbers use (Sam, 1 Oct 2026).
 *
 * The forecast is the 10-year average SEASON total, not this year's total to
 * date — read in May, a to-date total said there was almost no grass, because
 * the season had barely begun. This year's rain is kept beside it (as a % of
 * normal and a projected season) for in-season decisions. Manual mode, or no
 * archive, falls back to the typed figure.
 */
export function grazingRain(ranch: Pick<Ranch, 'precip_auto' | 'grazing_precip_mm'>, measured: RanchPrecip | null | undefined): GrazingRain {
  const normal = measured?.normal ?? null
  const auto = ranch.precip_auto && normal != null
  const outlook = measured && normal ? rainOutlook(measured.total_mm, normal) : null
  return {
    forecastMm: auto ? normal!.avg_season_mm : ranch.grazing_precip_mm,
    forecastSource: auto ? 'normal' : 'manual',
    toDateMm: measured?.total_mm ?? null,
    normalToDateMm: normal?.avg_to_date_mm ?? null,
    pctOfNormal: outlook?.pctOfNormal ?? null,
    projectedMm: outlook?.projectedSeasonMm ?? null,
  }
}

/** Measured growing-season rainfall (mm) to date for a ranch, with the 10-year normal. */
export function useRanchPrecip(ranch: Ranch | null | undefined) {
  const hasCoords = ranch?.latitude != null && ranch?.longitude != null
  return useQuery({
    queryKey: ['ranch_precip', ranch?.id, ranch?.precip_start_month, ranch?.precip_end_month, 'normals10'],
    enabled: Boolean(hasCoords),
    staleTime: 60 * 60_000,
    refetchInterval: 6 * 60 * 60_000,
    queryFn: async (): Promise<RanchPrecip> => {
      const now = new Date()
      const year = now.getFullYear()
      const start = `${year}-${String(ranch!.precip_start_month).padStart(2, '0')}-01`
      // End at today, but never past the growing season's last day.
      const seasonEnd = new Date(year, ranch!.precip_end_month, 0) // day 0 of next month = last day of end month
      const endDate = now < seasonEnd ? now : seasonEnd
      const end = endDate.toLocaleDateString('en-CA')
      const res = await fetch(
        `/api/ranch-precip?lat=${ranch!.latitude}&lon=${ranch!.longitude}&start=${start}&end=${end}` +
          `&normals=${RAIN_NORMAL_YEARS}&end_month=${ranch!.precip_end_month}`,
      )
      if (!res.ok) throw new Error('Rainfall data unavailable')
      return res.json()
    },
  })
}

export function useSetGrazingSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      ...patch
    }: {
      id: string
      grazing_utilization_rate?: number
      grazing_precip_mm?: number
    }) => {
      const { error } = await supabase.from('ranches').update(patch).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['grazing_settings'] }),
  })
}

export function usePastureMutations() {
  const qc = useQueryClient()
  const invalidate = () => void qc.invalidateQueries({ queryKey: ['grazing_pastures'] })
  const create = useMutation({
    mutationFn: async (p: Database['public']['Tables']['grazing_pastures']['Insert']) => {
      const { error } = await supabase.from('grazing_pastures').insert(p)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
  const update = useMutation({
    mutationFn: async ({
      id,
      patch,
    }: {
      id: string
      patch: Database['public']['Tables']['grazing_pastures']['Update']
    }) => {
      const { error } = await supabase.from('grazing_pastures').update(patch).eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('grazing_pastures').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
  return { create, update, remove }
}

/**
 * Edits to a herd class from the Grazing tab. Writes to herd_counts, so a change
 * here shows up on Feed too — that's the point of option A. Adding and removing
 * classes stays on the Herd tab, so there is no create/remove here.
 */
export function useHerdMutations() {
  const qc = useQueryClient()
  const update = useMutation({
    mutationFn: async ({
      id,
      patch,
    }: {
      id: string
      patch: Database['public']['Tables']['herd_counts']['Update']
    }) => {
      const { error } = await supabase.from('herd_counts').update(patch).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['herd_counts'] })
      void qc.invalidateQueries({ queryKey: ['feed_plan'] })
    },
  })
  return { update }
}
