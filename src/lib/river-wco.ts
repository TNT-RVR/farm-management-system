import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
import type { Database } from './database.types'

/**
 * The water conservation objective for our reach of the Oldman.
 *
 * The river page shows flow. Flow on its own does not say whether a dry year
 * is a delivery risk, because what the district can divert is not the flow --
 * it is the flow less what the segment has to keep. That number is published:
 * Schedule 1 of the Oldman River water conservation objective for Segment 4
 * (LNID weir to the Rocky Coulee confluence, 2013), which the research library
 * holds.
 *
 * It is a lookup, not a figure. For each seven-day period from April 2 to
 * November 26 the objective is a step function of the segment's NATURAL flow
 * -- the flow there would be without human use -- so a wet year carries a
 * higher instream requirement than a dry one. December 3 to April 1 is a flat
 * 7.15 m3/s.
 *
 * Natural flow is modelled by the province, not read off a gauge, and the app
 * has no feed for it. What a gauge gives is flow AFTER diversions, which is at
 * or below natural flow; because the objective rises with natural flow,
 * looking a gauge reading up in the schedule returns an objective at or below
 * the week's real one. Every number this module derives that way is labelled a
 * lower bound, and the page says so -- a figure that is honestly a floor is
 * worth more than one that looks exact and is not.
 */

export type WcoSegment = Database['public']['Tables']['river_wco_segments']['Row']
export type WcoBand = Database['public']['Tables']['river_wco_bands']['Row']

const num = (v: number | string | null | undefined): number | null => {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** MM-DD of a date in local time (the schedule is keyed by calendar day). */
export function monthDay(d: Date): string {
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * The seven-day period a date falls in, or null for the winter window.
 *
 * The schedule's periods run from April 2 to November 26 and each covers the
 * seven days from its own start, so the period for a date is simply the latest
 * one at or before it. Anything earlier than the first period, or from
 * December 3 on, is the flat winter objective, which the schedule states as a
 * note rather than a row.
 */
export function periodFor(periods: string[], md: string): string | null {
  if (!periods.length) return null
  const sorted = [...periods].sort()
  const last = sorted[sorted.length - 1]
  // Seven days past the last period start is December 3, where winter begins.
  if (md < sorted[0]) return null
  if (md >= '12-03') return null
  return sorted.filter((p) => p <= md).pop() ?? last
}

export type WcoLookup = {
  /** The period the objective was read in, or null in the winter window. */
  periodMd: string | null
  winter: boolean
  /** The objective in the driest natural-flow band of the period, m3/s. */
  floorCms: number | null
  /** The objective in the wettest band of the period, m3/s. */
  ceilingCms: number | null
  /**
   * The objective the measured flow lands in -- a LOWER BOUND on the week's
   * real objective, since measured flow is at or below natural flow.
   */
  impliedCms: number | null
  /** The natural-flow threshold of the band the measured flow landed in. */
  impliedBandCms: number | null
}

/**
 * The objective for a date, and the band a measured flow falls in.
 *
 * The schedule's own note: where identical natural-flow values occur in a
 * weekly column, the objective for the first occurring value is the one to
 * use. Bands are therefore walked in `band_seq` order and the first match of a
 * tied threshold wins, which is what taking the LOWEST qualifying band does.
 */
export function lookupWco(
  segment: WcoSegment | null | undefined,
  bands: WcoBand[] | undefined,
  dateISO: string,
  flowCms: number | null,
): WcoLookup {
  const empty: WcoLookup = {
    periodMd: null,
    winter: false,
    floorCms: null,
    ceilingCms: null,
    impliedCms: null,
    impliedBandCms: null,
  }
  if (!segment) return empty
  const md = monthDay(new Date(`${dateISO.slice(0, 10)}T12:00:00`))
  const periods = [...new Set((bands ?? []).map((b) => b.period_md))]
  const period = periodFor(periods, md)

  if (!period) {
    const w = num(segment.winter_wco_cms)
    return { ...empty, winter: true, floorCms: w, ceilingCms: w, impliedCms: w }
  }

  const inPeriod = (bands ?? [])
    .filter((b) => b.period_md === period)
    .sort((a, b) => a.band_seq - b.band_seq)
  if (!inPeriod.length) return { ...empty, periodMd: period }

  const wcos = inPeriod.map((b) => num(b.wco_cms)).filter((x): x is number => x != null)
  const floorCms = wcos.length ? Math.min(...wcos) : null
  const ceilingCms = wcos.length ? Math.max(...wcos) : null

  let implied: WcoBand | null = null
  if (flowCms != null) {
    // Walk up in band order; the last band whose threshold the flow reaches
    // is the one that applies, and a tied threshold keeps the earlier band.
    for (const b of inPeriod) {
      const t = num(b.natural_flow_cms)
      if (t == null) {
        implied = implied ?? b // the "<" row: the driest band, no threshold
        continue
      }
      if (flowCms >= t) implied = b
    }
  }

  return {
    periodMd: period,
    winter: false,
    floorCms,
    ceilingCms,
    impliedCms: implied ? num(implied.wco_cms) : null,
    impliedBandCms: implied ? num(implied.natural_flow_cms) : null,
  }
}

export type SupplyVerdict = 'below' | 'tight' | 'ok' | 'unknown'

/**
 * How much room there is above the objective.
 *
 * Measured against the lower-bound objective, so "below" is certain and "ok"
 * is the one that could be optimistic -- which is the right way round for a
 * risk the farm would rather see early. "Tight" is less than half again the
 * objective: the app's own line, not the province's.
 */
export const TIGHT_MULTIPLE = 1.5

export function supplyVerdict(flowCms: number | null, wcoCms: number | null): SupplyVerdict {
  if (flowCms == null || wcoCms == null || wcoCms <= 0) return 'unknown'
  if (flowCms < wcoCms) return 'below'
  if (flowCms < wcoCms * TIGHT_MULTIPLE) return 'tight'
  return 'ok'
}

export const SUPPLY_LABEL: Record<SupplyVerdict, string> = {
  below: 'Below the objective',
  tight: 'Close to the objective',
  ok: 'Room above the objective',
  unknown: 'No reading',
}
export const SUPPLY_COLOR: Record<SupplyVerdict, string> = {
  below: 'bg-red-100 text-red-800',
  tight: 'bg-amber-100 text-amber-900',
  ok: 'bg-green-100 text-green-800',
  unknown: 'bg-gray-100 text-gray-600',
}

/** "16 July" from an MM-DD, for naming the schedule's seven-day period. */
export function periodLabel(md: string | null): string | null {
  if (!md) return null
  const [m, d] = md.split('-').map(Number)
  if (!m || !d) return null
  return new Date(2001, m - 1, d).toLocaleDateString('en-CA', { month: 'long', day: 'numeric' })
}

/** The segment and its whole schedule. Published 2013 — cached for the session. */
export function useWcoSegment(slug: string) {
  return useQuery({
    queryKey: ['river_wco', slug],
    staleTime: 60 * 60 * 1000,
    queryFn: async () => {
      const seg = await supabase.from('river_wco_segments').select('*').eq('slug', slug).maybeSingle()
      if (seg.error) throw seg.error
      if (!seg.data) return { segment: null as WcoSegment | null, bands: [] as WcoBand[] }
      const bands = await supabase
        .from('river_wco_bands')
        .select('*')
        .eq('segment_id', seg.data.id)
        .order('period_md')
        .order('band_seq')
      if (bands.error) throw bands.error
      return { segment: seg.data, bands: bands.data }
    },
  })
}
