import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'

/**
 * What the GROUND sustains, from Alberta's own book — beside what this season
 * grew, never instead of it.
 *
 * The grass rating on the Grazing tab is relative: peak canopy cover against
 * the ranch's own middle paddock. That makes the middle paddock Fair by
 * construction, so a ranch where every paddock is tired still reads as one
 * Good, some Fairs and a Poor (Sam, 12 Nov 2026). This is the absolute
 * answer: the soil map says what kind of ground a paddock is, and the Dry
 * Mixedgrass range plant community guide (Adams 2005, 1,716 vegetation plots)
 * says what that kind of ground carries, in AUM an acre.
 *
 * It is a SUSTAINABLE rate, not this year's capacity — 25-50% of total herbage
 * with the rest left as litter and root reserve, taken year after year without
 * the stand declining. A wet season grows more and carries more: Home Ranch's
 * collars grazed 84,181 AUDs in 2026, a 131% season, off ground that sustains
 * about 44,400. Both numbers are right, and the gap between them is the point
 * of showing it. Sam, 13 Nov 2026: beside it, not replacing it.
 *
 * The rate already includes utilization and the ecological carry-over, so it
 * must never be multiplied by the ranch's own utilization rate as well.
 *
 * Its animal unit is Alberta's 455 kg month, which is why the Grazing tab's
 * "eaten + wasted" setting exists — on "eaten only" the two are a fifth apart
 * and the comparison is not like for like.
 */
export type PastureEssr = {
  grazing_pasture_id: string
  paddock: string
  ranch_id: string | null
  soil_acres: number | null
  grazed_acres: number | null
  /** Sustainable animal-unit days, the range sites' middle communities. */
  essr_auds: number | null
  /** Every rated acre at its site's weakest community, and at its strongest. */
  essr_auds_low: number | null
  essr_auds_high: number | null
  /**
   * Share of the paddock's grazed acres that carries a published rate. Below
   * 100 the rest is ground the guide lists no community for (Shallow to
   * Gravel, Choppy Sandhills here) — unrated, not zero, and the screen says so
   * rather than quietly totalling it as nothing.
   */
  pct_rated: number | null
}

export type PastureRangeSite = {
  grazing_pasture_id: string
  paddock: string
  range_site: string | null
  essr_aum_ac: number | null
  essr_min: number | null
  essr_max: number | null
  communities: number | null
  grazed: boolean | null
  acres: number | null
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : (v as number)
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

/**
 * Why there is no cover-based fallback for the unrated acres.
 *
 * The guide's own canopy cover predicts its stocking rates well (r = +0.72
 * across 37 communities), so a regression looked like the obvious way to fill
 * the gaps. It cannot be fed our numbers. The guide's "Total Vegetation" is a
 * person over a quadrat counting everything with a canopy — cured grass, forbs,
 * shrubs, and the moss and lichen that run past 40% in these communities — and
 * it reads 45-90%. Ours is sat_fcover, ((NDVI - 0.15) / 0.75) squared, the
 * fractional GREEN canopy, and it reads 0.10-0.26 on the very same paddocks.
 * Two different measurements, not one on two scales. Mapping either onto the
 * other would invent precision we have not earned.
 *
 * So unrated acres are reported as unrated. A clip-and-weigh would close it
 * (pasture_biomass_calibration, still empty after the form was built for it).
 */
export const ESSR_HAS_NO_COVER_FALLBACK = true

/** Every mapped paddock's sustainable rate, by grazing_pastures.id. */
export function usePastureEssr(ranchId: string | null | undefined) {
  return useQuery({
    queryKey: ['pasture-essr', ranchId],
    enabled: Boolean(ranchId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pasture_essr')
        .select('*')
        .eq('ranch_id', ranchId!)
      if (error) throw error
      const m = new Map<string, PastureEssr>()
      for (const r of data ?? []) {
        const row = r as Record<string, unknown>
        m.set(String(row.grazing_pasture_id), {
          grazing_pasture_id: String(row.grazing_pasture_id),
          paddock: String(row.paddock ?? ''),
          ranch_id: (row.ranch_id as string) ?? null,
          soil_acres: num(row.soil_acres),
          grazed_acres: num(row.grazed_acres),
          essr_auds: num(row.essr_auds),
          essr_auds_low: num(row.essr_auds_low),
          essr_auds_high: num(row.essr_auds_high),
          pct_rated: num(row.pct_rated),
        })
      }
      return m
    },
    staleTime: 30 * 60_000,
  })
}

/** The range sites inside one paddock, biggest first. */
export function usePastureRangeSites(grazingPastureId: string | null | undefined) {
  return useQuery({
    queryKey: ['pasture-range-sites', grazingPastureId],
    enabled: Boolean(grazingPastureId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pasture_range_sites')
        .select('*')
        .eq('grazing_pasture_id', grazingPastureId!)
      if (error) throw error
      return (data ?? [])
        .map((r) => {
          const row = r as Record<string, unknown>
          return {
            grazing_pasture_id: String(row.grazing_pasture_id),
            paddock: String(row.paddock ?? ''),
            range_site: (row.range_site as string) ?? null,
            essr_aum_ac: num(row.essr_aum_ac),
            essr_min: num(row.essr_min),
            essr_max: num(row.essr_max),
            communities: num(row.communities),
            grazed: (row.grazed as boolean) ?? null,
            acres: num(row.acres),
          } as PastureRangeSite
        })
        .sort((a, b) => (b.acres ?? 0) - (a.acres ?? 0))
    },
    staleTime: 30 * 60_000,
  })
}

/** A ranch's sustainable total, and how much of it rests on published rates. */
export function essrTotals(m: Map<string, PastureEssr> | undefined | null) {
  if (!m || m.size === 0) return null
  let auds = 0
  let low = 0
  let high = 0
  let grazed = 0
  let rated = 0
  for (const r of m.values()) {
    auds += r.essr_auds ?? 0
    low += r.essr_auds_low ?? 0
    high += r.essr_auds_high ?? 0
    const g = r.grazed_acres ?? 0
    grazed += g
    rated += (g * (r.pct_rated ?? 0)) / 100
  }
  if (!(auds > 0)) return null
  return {
    auds,
    low,
    high,
    grazedAcres: grazed,
    /** 0–1: how much of the mapped ground carries a published rate. */
    ratedShare: grazed > 0 ? rated / grazed : 0,
    paddocks: m.size,
  }
}
