import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'

// Reading the market tables.
//
// Both the crop and cattle tabs sit on this, because both ask the same three
// questions: what is it worth now, what has it been worth, and what does the
// forward market think.

export type MarketSeries = {
  id: string
  code: string
  kind: 'crop' | 'cattle' | 'fx' | 'index' | 'fertilizer' | 'fuel'
  name: string
  commodity: string
  unit: string
  region: string | null
  source: string
  crop_id: string | null
  derived: boolean
  /** Hidden from the picker — a commodity we do not grow. History is kept. */
  archived: boolean
  notes: string | null
}

export type MarketPoint = {
  series_id: string
  observed_on: string
  value: number | null
  low: number | null
  high: number | null
}

export type FuturesPoint = {
  series_id: string
  quote_on: string
  contract_month: string
  value: number
}

/** PostgREST hands numerics back as strings often enough to matter. */
const num = (v: number | string | null | undefined): number | null => {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

/**
 * Archive a commodity, or bring it back.
 *
 * Applied to every series for that commodity at once — a commodity is archived
 * as a thing you do not grow, not as one particular price feed for it.
 */
export function useArchiveCommodity() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      commodity,
      kind,
      archived,
    }: {
      commodity: string
      kind: MarketSeries['kind']
      archived: boolean
    }) => {
      const { error } = await supabase
        .from('market_series')
        .update({ archived })
        .eq('commodity', commodity)
        .eq('kind', kind)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['market-series'] }),
  })
}

export function useMarketSeries(kind?: MarketSeries['kind'] | MarketSeries['kind'][]) {
  const kinds = kind == null ? null : Array.isArray(kind) ? kind : [kind]
  return useQuery({
    queryKey: ['market-series', kinds],
    queryFn: async () => {
      let q = supabase.from('market_series').select('*').order('commodity')
      if (kinds) q = q.in('kind', kinds)
      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as unknown as MarketSeries[]
    },
    staleTime: 30 * 60_000,
  })
}

/** Every observation for a set of series, oldest first. */
export function useMarketPrices(seriesIds: string[]) {
  const key = [...seriesIds].sort().join(',')
  return useQuery({
    queryKey: ['market-prices', key],
    enabled: seriesIds.length > 0,
    queryFn: async () => {
      // Paged: the API returns at most 1,000 rows a request, and four auction
      // markets' weekly feeder classes pass that in a few months. Unpaged, the
      // NEWEST weeks were the ones cut off, because the order is oldest first.
      const data: { series_id: unknown; observed_on: unknown; value: unknown; low: unknown; high: unknown }[] = []
      const PAGE = 1000
      for (let from = 0; ; from += PAGE) {
        const { data: page, error } = await supabase
          .from('market_prices')
          .select('series_id, observed_on, value, low, high')
          .in('series_id', seriesIds)
          .order('observed_on')
          .order('id')
          .range(from, from + PAGE - 1)
        if (error) throw error
        data.push(...(page ?? []))
        if (!page || page.length < PAGE) break
      }
      return data.map((r) => ({
        series_id: r.series_id as string,
        observed_on: r.observed_on as string,
        value: num(r.value as number | string | null),
        low: num(r.low as number | string | null),
        high: num(r.high as number | string | null),
      })) as MarketPoint[]
    },
    staleTime: 30 * 60_000,
  })
}

/**
 * The most recent forward curve for a series.
 *
 * Only the newest quote date: a curve is a snapshot, and mixing two weeks'
 * quotes into one line would draw a shape the market never had.
 */
export function useFuturesCurve(seriesId: string | null | undefined) {
  return useQuery({
    queryKey: ['futures-curve', seriesId],
    enabled: Boolean(seriesId),
    queryFn: async () => {
      const { data: latest } = await supabase
        .from('market_futures')
        .select('quote_on')
        .eq('series_id', seriesId!)
        .order('quote_on', { ascending: false })
        .limit(1)
      const on = latest?.[0]?.quote_on as string | undefined
      if (!on) return { quoteOn: null, points: [] as FuturesPoint[] }
      const { data, error } = await supabase
        .from('market_futures')
        .select('series_id, quote_on, contract_month, value')
        .eq('series_id', seriesId!)
        .eq('quote_on', on)
        .order('contract_month')
      if (error) throw error
      return {
        quoteOn: on,
        points: (data ?? []).map((r) => ({
          series_id: r.series_id as string,
          quote_on: r.quote_on as string,
          contract_month: r.contract_month as string,
          value: num(r.value as number | string) ?? 0,
        })),
      }
    },
    staleTime: 30 * 60_000,
  })
}

/** How one contract month has been quoted over time — the lock-in question. */
export function useContractHistory(seriesId: string | null | undefined, contractMonth: string | null) {
  return useQuery({
    queryKey: ['contract-history', seriesId, contractMonth],
    enabled: Boolean(seriesId && contractMonth),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('market_futures')
        .select('quote_on, value')
        .eq('series_id', seriesId!)
        .eq('contract_month', contractMonth!)
        .order('quote_on')
      if (error) throw error
      return (data ?? []).map((r) => ({
        on: r.quote_on as string,
        value: num(r.value as number | string) ?? 0,
      }))
    },
    staleTime: 30 * 60_000,
  })
}

// ── Shaping ─────────────────────────────────────────────────────────────────

export type Seasonal = { month: number; avg: number; min: number; max: number; n: number }

/**
 * The average shape of a year, by calendar month.
 *
 * Prices are indexed to each year's own mean before averaging. Otherwise 2022's
 * $1,078 canola would swamp 1987's $250 and the "seasonal pattern" would just be
 * a picture of which years were dear — the opposite of what it is for.
 */
export function seasonality(points: MarketPoint[], years = 10): Seasonal[] {
  const byYear = new Map<number, MarketPoint[]>()
  for (const p of points) {
    if (p.value == null) continue
    const y = Number(p.observed_on.slice(0, 4))
    const list = byYear.get(y) ?? []
    list.push(p)
    byYear.set(y, list)
  }
  const recent = [...byYear.keys()].sort((a, b) => b - a).slice(0, years)
  const byMonth = new Map<number, number[]>()
  for (const y of recent) {
    const pts = byYear.get(y) ?? []
    const mean = pts.reduce((s, p) => s + (p.value ?? 0), 0) / (pts.length || 1)
    if (!mean) continue
    for (const p of pts) {
      const m = Number(p.observed_on.slice(5, 7))
      const rel = ((p.value ?? 0) / mean - 1) * 100
      const list = byMonth.get(m) ?? []
      list.push(rel)
      byMonth.set(m, list)
    }
  }
  const out: Seasonal[] = []
  for (let m = 1; m <= 12; m++) {
    const vals = byMonth.get(m)
    if (!vals?.length) continue
    out.push({
      month: m,
      avg: vals.reduce((s, v) => s + v, 0) / vals.length,
      min: Math.min(...vals),
      max: Math.max(...vals),
      n: vals.length,
    })
  }
  return out
}

/** Where a price sits against its own history, as a percentile 0-100. */
export function percentileOf(value: number, points: MarketPoint[]): number | null {
  const vals = points.map((p) => p.value).filter((v): v is number => v != null)
  if (vals.length < 12) return null
  const below = vals.filter((v) => v <= value).length
  return Math.round((below / vals.length) * 100)
}

/** Points from the last `years` years, for the zoom control. */
export function sinceYears(points: MarketPoint[], years: number | null): MarketPoint[] {
  if (years == null) return points
  const cutoff = new Date()
  cutoff.setFullYear(cutoff.getFullYear() - years)
  const iso = cutoff.toISOString().slice(0, 10)
  return points.filter((p) => p.observed_on >= iso)
}

export const TONNE_PER_BU: Record<string, number> = {
  // Bushel weights, for reading a $/tonne series in the units a farm talks in.
  wheat: 36.744,
  'durum wheat': 36.744,
  barley: 45.93,
  oats: 64.842,
  canola: 44.092,
  flaxseed: 39.368,
  'dry peas': 36.744,
  corn: 39.368,
}

/** $/tonne to $/bushel, where the crop has a standard bushel weight. */
export function perBushel(perTonne: number, commodity: string): number | null {
  const buPerT = TONNE_PER_BU[commodity.toLowerCase()]
  return buPerT ? perTonne / buPerT : null
}

/** Group points by series for charting. */
export function bySeries(points: MarketPoint[]): Map<string, MarketPoint[]> {
  const m = new Map<string, MarketPoint[]>()
  for (const p of points) {
    const list = m.get(p.series_id) ?? []
    list.push(p)
    m.set(p.series_id, list)
  }
  return m
}

/** The series for one commodity, newest observation first. */
export function useCommodityView(commodity: string | null) {
  const { data: allSeries } = useMarketSeries(['crop', 'cattle'])
  const series = useMemo(
    () => (allSeries ?? []).filter((s) => s.commodity === commodity),
    [allSeries, commodity],
  )
  const ids = useMemo(() => series.map((s) => s.id), [series])
  const { data: points, isLoading } = useMarketPrices(ids)
  return { series, points: points ?? [], isLoading }
}

// ── Price watches ───────────────────────────────────────────────────────────

export type MarketAlert = {
  id: string
  series_id: string
  direction: 'above' | 'below'
  threshold: number
  label: string | null
  active: boolean
  armed: boolean
  last_fired_at: string | null
  last_fired_value: number | null
}

export function useMarketAlerts() {
  return useQuery({
    queryKey: ['market-alerts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('market_alerts')
        .select('*')
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []).map((a) => ({
        ...a,
        threshold: num(a.threshold as number | string) ?? 0,
        last_fired_value: num(a.last_fired_value as number | string | null),
      })) as MarketAlert[]
    },
  })
}

export function useSaveMarketAlert() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (row: {
      id?: string
      series_id: string
      direction: 'above' | 'below'
      threshold: number
      label?: string | null
      active?: boolean
      /** Set again when a watch's line is moved (watchNeedsRearm). */
      armed?: boolean
    }) => {
      const { id, ...rest } = row
      const { error } = id
        ? await supabase.from('market_alerts').update(rest).eq('id', id)
        : // A new watch starts armed, so the very next reading can fire it.
          await supabase.from('market_alerts').insert({ ...rest, armed: true })
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['market-alerts'] }),
  })
}

export function useDeleteMarketAlert() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('market_alerts').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['market-alerts'] }),
  })
}
