import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import { loadPastureFields } from './pasture-fields-data'
import { grazingSeason, type FieldWindow, type SprayHold } from './field-residue'
import type { PastureFieldContext } from './forage-yield'
import { useGrazingPicture } from './grazing-restrictions-hooks'
import { longest } from './grazing-restrictions'
import type { Database } from './database.types'
import type { Ranch } from './ranches'
import { RAIN_NORMAL_YEARS, rainOutlook, type SeasonNormal } from './rain-normals'
import type { GrassQuality } from './forage-yield'
import { auFor, monthDayOf, pairAUDays, weightFor, type MonthDay } from './animal-units'

// The forage arithmetic lives in forage-yield.ts (no Supabase client), so the
// server's pasture move-out check uses exactly these numbers too.
export {
  ACRES_PER_HECTARE,
  AU_LBS_PER_DAY,
  AUM_LBS,
  audsFromLb,
  computePasture,
  computePastures,
  FORAGE_YIELD_ESTIMATOR,
  FORAGE_YIELD_IRRIGATION,
  forageYieldPerAcre,
  GRASS_QUALITIES,
  type GrassQuality,
  type PastureCalc,
  type PastureFieldContext,
  type PastureRow,
  type SeasonRain,
} from './forage-yield'

/** The crop fields inside a ranch's pastures, from the farming side (pasture_field_crops). */
export function usePastureFields(ranchId: string | null | undefined) {
  const year = new Date().getFullYear()
  return useQuery({
    queryKey: ['pasture_field_crops', ranchId, year],
    enabled: Boolean(ranchId),
    staleTime: 10 * 60_000,
    queryFn: () => loadPastureFields(supabase, year, ranchId),
  })
}

/**
 * Everything computePasture needs from the farming side, for one ranch: the
 * crop fields in each pasture, each field's latest-lifting spray hold, and the
 * grazing season the totals are counted over. `ctx(window)` builds the
 * context for other dates (a Plan-tab stay); `ctx()` is the season.
 *
 * Every screen that shows a pasture's AUDs reads them through this, so the
 * Grazing tab, the Plan tab, the ranch summary and the heifer page agree.
 */
export function usePastureFieldContext(ranchId: string | null | undefined, herd: { graze_start: string | null; graze_end: string | null }[] | null | undefined) {
  const { data: rows, isLoading } = usePastureFields(ranchId)
  const { picture } = useGrazingPicture()
  return useMemo(() => {
    const season = grazingSeason(herd ?? [], new Date().getFullYear())
    const holds = new Map<string, SprayHold>()
    for (const p of picture?.places ?? []) {
      if (p.kind !== 'field') continue
      const r = longest(p.restrictions, 'graze')
      if (r?.until) holds.set(p.id, { until: r.until, product: r.product })
    }
    const spray = (fieldId: string) => holds.get(fieldId) ?? null
    const ctx = (window?: FieldWindow): PastureFieldContext | null => (rows ? { fields: rows, window: window ?? season, spray } : null)
    return { rows, loading: isLoading, season, ctx }
  }, [rows, isLoading, picture, herd])
}

// The grazing herd reads from herd_counts — the same rows the Feed tab uses — so
// head is entered once, on the Herd tab. Only the grazing window lives here.
// (grazing_herd still exists but is no longer read; see migration 20260804030000.)
export type HerdRow = Database['public']['Tables']['herd_counts']['Row']

export const GRAZEABLE_AREAS_MAP_URL =
  'https://www.google.com/maps/d/u/0/edit?mid=YOUR_MY_MAPS_ID&ll=52.41062021054227%2C-113.50237975575077&z=16'
export const CARRYING_CAPACITY_CALC_URL =
  'https://www.beefresearch.ca/tools/carrying-capacity-calculator-method-1/'

/** Pasture Rating guide (reference only). */
export const PASTURE_RATING_GUIDE: { category: string; values: Record<GrassQuality, string> }[] = [
  { category: 'Potential yield of the area', values: { Excellent: '75–100%', Good: '60–75%', Fair: '50–60%', Poor: '33–50%' } },
  { category: 'Production from desirable, adapted grass & legumes', values: { Excellent: '95%', Good: '90%', Fair: '60%', Poor: 'Less than 50%' } },
  { category: 'Production from weeds or undesirable plants', values: { Excellent: 'Less than 5%', Good: 'Less than 10%', Fair: '20% or more', Poor: '50% or more' } },
  { category: 'Fertility program', values: { Excellent: 'Average to above average', Good: 'Average', Fair: 'Below average or non-existent', Poor: 'No fertility program' } },
]

/**
 * Days on grass between two ISO dates, both ends counted: in on 1 June and out
 * on 30 June is 30 days of grazing, not 29. 0 if either is missing or the end
 * is before the start.
 */
export function daysGrazing(start: string | null, end: string | null): number {
  if (!start || !end) return 0
  const d = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86_400_000)
  return d >= 0 ? d + 1 : 0
}

export type HerdCalc = HerdRow & {
  /** AU per head actually used: weight ÷ 1,000 unless typed on purpose (animal-units.ts auFor). */
  auPerHead: number
  totalAU: number
  /** The dates counted: the class's own (month and day, in this year), or the season assumed. */
  start: string | null
  end: string | null
  /** True when the class has no grazing dates and is counted over the ranch's grazing season. */
  assumedSeason: boolean
  /** True for the calves class when its calves ride at side (counted in the cows' row). */
  withCows: boolean
  days: number
  /** AU-days the calves at side eat with this (cow) class; 0 for other classes. */
  calfAuds: number
  audsRequired: number
}

/** How calves at side ride with the cows: when they are born and weaned, and how many a cow. */
export type PairContext = { calving: MonthDay; weaning: MonthDay | null; calvesPerCow: number }

/**
 * A class's grazing dates read as month and day in `year`: dates typed for an
 * earlier season (bulls 15 May – 15 Dec 2025) still mean this year's turnout.
 * An end before the start runs into the next year. Null without both dates.
 */
export function datesInYear(start: string | null, end: string | null, year: number): { start: string; end: string } | null {
  if (!start || !end) return null
  const s = `${year}-${start.slice(5, 10)}`
  const e = `${year}-${end.slice(5, 10)}`
  return { start: s, end: e < s ? `${year + 1}-${end.slice(5, 10)}` : e }
}

/** One class's need over `window` (its own dates when no window is given). */
export function computeHerd(h: HerdRow, pairs?: PairContext | null, window?: { start: string; end: string; assumed?: boolean } | null): HerdCalc {
  const auPerHead = auFor(h)
  const totalAU = auPerHead * h.head_count
  const start = window ? window.start : h.graze_start
  const end = window ? window.end : h.graze_end
  const days = daysGrazing(start, end)
  // A cow class on grass carries its calves until weaning, each counted by its age (pairAU).
  const calfAuds =
    pairs && h.feed_class === 'cow' && days > 0 && start && end
      ? pairAUDays({ cowLb: weightFor(h).lb, from: start, to: end, calving: pairs.calving, weaning: pairs.weaning, calvesPerCow: pairs.calvesPerCow }).calfAud * h.head_count
      : 0
  return { ...h, auPerHead, totalAU, start, end, assumedSeason: Boolean(window?.assumed), withCows: false, days, calfAuds, audsRequired: totalAU * days + calfAuds }
}

/** The ranch's calves class: the one with backgrounding head, else the one named for calves. */
function calvesRow(herd: HerdRow[]): HerdRow | undefined {
  return herd.find((h) => h.background_head != null) ?? herd.find((h) => /calf|calves/i.test(h.class_name))
}

/**
 * The calves-at-side context for a ranch's herd: calving from the feed plan,
 * weaning from the ranch, calves per cow from the herd counts (at most one).
 * Null when the calves are on grass as their own class (they'd be counted
 * twice) or there are no calves.
 */
export function pairContext(herd: HerdRow[], calving: MonthDay | null, weaningIso: string | null | undefined): PairContext | null {
  if (!calving) return null
  const cows = herd.filter((h) => h.feed_class === 'cow').reduce((a, h) => a + h.head_count, 0)
  const calves = calvesRow(herd)
  if (!calves || cows <= 0 || calves.head_count <= 0) return null
  if (calves.graze_start && calves.graze_end) return null
  return { calving, weaning: monthDayOf(weaningIso), calvesPerCow: Math.min(1, calves.head_count / cows) }
}

/**
 * Every class's grazing need, the cows carrying their calves at side.
 *
 * A class with no grazing dates is on grass all the same (3 Nov 2026: leaving
 * it out showed a surplus while the Herd page had the herd over the grass). It
 * is counted over the ranch's grazing season — the one the land capacity is
 * counted over (grazingSeason) — and flagged assumedSeason. The calves riding
 * at side are the exception: they are in the cows' row.
 */
export function computeHerds(herd: HerdRow[], calving: MonthDay | null, weaningIso: string | null | undefined, year = new Date().getFullYear()): HerdCalc[] {
  const pairs = pairContext(herd, calving, weaningIso)
  const atSide = pairs ? calvesRow(herd) : undefined
  const season = grazingSeason(herd, year)
  return herd.map((h) => {
    if (h.id === atSide?.id) return { ...computeHerd(h, null, { start: '', end: '' }), start: null, end: null, withCows: true }
    const own = datesInYear(h.graze_start, h.graze_end, year)
    return computeHerd(h, pairs, own ?? { start: season.from, end: season.to, assumed: true })
  })
}

/** The grass against the herd: one sum for the Grazing tab and the Herd page. */
export type GrassBalance = {
  /** The pastures' AUDs for the season. */
  supply: number
  /** Every class's AUDs required. */
  need: number
  surplus: number
  /** AUDs every class but the cows needs. */
  others: number
  /** AUDs one cow and her calf at side need; null with no cows on grass. */
  perCow: number | null
  /** Days the cows are counted on grass. */
  cowDays: number
  /** Cows the grass carries once the other classes have eaten; null with no cows. */
  capacityCows: number | null
}

const isCowClass = (h: HerdCalc) => h.feed_class === 'cow' || (!h.feed_class && /cow/i.test(h.class_name))

/**
 * Surplus and the cows the grass carries, from the same rows: the cows over
 * the grass (cows − capacityCows) is the shortfall ÷ what one cow needs.
 */
export function grassBalance(supply: number, herd: HerdCalc[]): GrassBalance {
  const need = herd.reduce((a, h) => a + h.audsRequired, 0)
  const cows = herd.filter(isCowClass)
  const cowHead = cows.reduce((a, h) => a + h.head_count, 0)
  const cowNeed = cows.reduce((a, h) => a + h.audsRequired, 0)
  const perCow = cowHead > 0 && cowNeed > 0 ? cowNeed / cowHead : null
  const others = need - cowNeed
  return {
    supply,
    need,
    surplus: supply - need,
    others,
    perCow,
    cowDays: cows[0]?.days ?? 0,
    capacityCows: perCow == null ? null : Math.max(0, (supply - others) / perCow),
  }
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

export type SeasonFactor = {
  grazing_pasture_id: string
  name: string
  source: string | null
  looks: number | null
  normal_years: number | null
  cover_now: number | null
  cover_normal: number | null
  grazed_this_year: boolean
  /** NULL means fall back to rainfall for this paddock. */
  factor: number | null
}

/**
 * How this season has actually gone, per paddock, measured rather than modelled.
 *
 * Peak canopy cover so far against the same calendar window in earlier years
 * (pasture_season_factor). A paddock grazed this year comes back NULL, because
 * cattle eat the green and from orbit a used paddock and a poor one look the
 * same. Those keep planning on rainfall, which grazing does not disturb.
 */
export function usePastureSeasonFactors(ranchId: string | null | undefined) {
  return useQuery({
    queryKey: ['pasture_season_factor', ranchId],
    enabled: Boolean(ranchId),
    // Three growing seasons of observations behind every row, and it moves
    // only when a new look lands — which is twice a day at best.
    staleTime: 60 * 60_000,
    queryFn: async (): Promise<SeasonFactor[]> => {
      const { data, error } = await supabase.from('pasture_season_factor').select('*')
      if (error) throw error
      return (data ?? []).map((r) => ({
        grazing_pasture_id: r.grazing_pasture_id as string,
        name: r.name as string,
        source: (r.source as string | null) ?? null,
        looks: r.looks == null ? null : Number(r.looks),
        normal_years: r.normal_years == null ? null : Number(r.normal_years),
        cover_now: r.cover_now == null ? null : Number(r.cover_now),
        cover_normal: r.cover_normal == null ? null : Number(r.cover_normal),
        grazed_this_year: Boolean(r.grazed_this_year),
        factor: r.factor == null ? null : Number(r.factor),
      }))
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
