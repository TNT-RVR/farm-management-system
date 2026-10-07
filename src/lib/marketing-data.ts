import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import type { Database } from './database.types'
import type { Position, Target, Unit } from './marketing'
import { boardPriceIn, type BoardPrice } from './board-price'

export type CropPositionRow = Database['public']['Views']['crop_position']['Row']
export type CropBasisRow = Database['public']['Views']['crop_basis']['Row']
export type CashBid = Database['public']['Tables']['cash_bids']['Row']
export type MarketingTarget = Database['public']['Tables']['marketing_targets']['Row']

/** PostgREST hands numerics back as strings often enough to be worth one helper. */
const num = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
const numOrNull = (v: unknown): number | null => {
  if (v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export function toPosition(r: CropPositionRow): Position {
  return {
    cropId: r.crop_id,
    cropName: r.crop_name ?? 'Unnamed crop',
    cropYear: r.crop_year,
    unit: (r.yield_unit ?? 'bu') as Unit,
    category: r.crop_category,
    acres: num(r.acres),
    expected: num(r.expected),
    contracted: num(r.contracted),
    contractedValue: num(r.contracted_value),
    delivered: num(r.delivered),
    onhand: num(r.onhand),
    cleanAcres: num(r.clean_acres),
    preCleanAcres: num(r.pre_clean_acres),
  }
}

/** The whole position, every year. Small enough to fetch once and filter locally. */
export function useCropPosition() {
  return useQuery({
    queryKey: ['crop_position'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('crop_position')
        .select('*')
        .order('crop_year', { ascending: false })
      if (error) throw error
      return (data ?? []).map(toPosition)
    },
    staleTime: 60_000,
  })
}

/** Contracts, for the cash-flow projection and the position detail. */
export function useContracts() {
  return useQuery({
    queryKey: ['contracts_marketing'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('contracts')
        .select('*')
        .order('delivery_start', { ascending: true })
      if (error) throw error
      return data ?? []
    },
    staleTime: 60_000,
  })
}

export function useCashBids() {
  return useQuery({
    queryKey: ['crop_basis'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('crop_basis')
        .select('*')
        .order('bid_on', { ascending: false })
      if (error) throw error
      return (data ?? []).map((r) => ({
        ...r,
        price_per_unit: num(r.price_per_unit),
        futures_value: numOrNull(r.futures_value),
        basis: numOrNull(r.basis),
      }))
    },
    staleTime: 60_000,
  })
}

export function useSaveCashBid() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (bid: Database['public']['Tables']['cash_bids']['Insert']) => {
      const { error } = await supabase.from('cash_bids').insert(bid)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['crop_basis'] }),
  })
}

/** Correct a recorded bid (Sam, 7 Oct 2026); its basis follows in the crop_basis view. */
export function useUpdateCashBid() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...patch }: { id: string } & Database['public']['Tables']['cash_bids']['Update']) => {
      const { error } = await supabase.from('cash_bids').update(patch).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['crop_basis'] }),
  })
}

export function useDeleteCashBid() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('cash_bids').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['crop_basis'] }),
  })
}

export function useMarketingTargets() {
  return useQuery({
    queryKey: ['marketing_targets'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('marketing_targets')
        .select('*')
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []).map(
        (t): Target & { seriesId: string | null; hitAt: string | null } => ({
          id: t.id,
          cropId: t.crop_id,
          cropYear: t.crop_year,
          mode: t.mode,
          value: num(t.value),
          quantity: numOrNull(t.quantity),
          note: t.note,
          active: t.active,
          seriesId: t.series_id,
          hitAt: t.hit_at,
        }),
      )
    },
    staleTime: 60_000,
  })
}

export function useSaveTarget() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (t: Database['public']['Tables']['marketing_targets']['Insert']) => {
      const { error } = await supabase.from('marketing_targets').insert(t)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['marketing_targets'] }),
  })
}

export function useUpdateTarget() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      ...patch
    }: { id: string } & Database['public']['Tables']['marketing_targets']['Update']) => {
      const { error } = await supabase.from('marketing_targets').update(patch).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['marketing_targets'] }),
  })
}

export function useDeleteTarget() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('marketing_targets').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['marketing_targets'] }),
  })
}

/**
 * Budgeted input cost per acre, by crop and year.
 *
 * This is the planned side — what the crop budget says. The actual side comes
 * from applications priced off invoices, and the breakeven view shows both
 * rather than picking one: early in a season only the budget exists, and late
 * in one only the actuals are true.
 */
export function useCropInputs() {
  return useQuery({
    queryKey: ['crop_inputs'],
    queryFn: async () => {
      const { data, error } = await supabase.from('crop_inputs').select('*')
      if (error) throw error
      const byCropYear = new Map<string, { category: string; costPerAcre: number }[]>()
      for (const r of data ?? []) {
        const key = `${r.crop_year}:${r.crop_id}`
        const list = byCropYear.get(key) ?? []
        list.push({ category: r.category, costPerAcre: num(r.cost_per_acre) })
        byCropYear.set(key, list)
      }
      return byCropYear
    },
    staleTime: 60_000,
  })
}

export type CropBoard = BoardPrice & { seriesId: string; name: string; on: string }

/**
 * The newest quote on every crop series, for pricing the open position —
 * already converted into the crop's own unit.
 *
 * The series behind this are $/tonne (StatCan farm gate, Alberta elevator
 * bids) while positions are in bushels, pounds or hundredweight, so `value` is
 * the converted price and `raw`/`seriesUnit` keep what the series said. A
 * series that cannot be put in the crop's unit (US dollars, no bushel weight)
 * is left out rather than shown unconverted.
 */
export function useLatestCropPrices() {
  return useQuery({
    // Versioned: the entries changed shape when the unit conversion went in.
    queryKey: ['latest_crop_prices', 'v2'],
    queryFn: fetchLatestCropPrices,
    staleTime: 5 * 60_000,
  })
}

/** What useLatestCropPrices reads, for a report made outside React. */
export async function fetchLatestCropPrices() {
  const [series, prices, crops] = await Promise.all([
    supabase.from('market_series').select('*').eq('kind', 'crop'),
    supabase
      .from('market_prices')
      .select('series_id, observed_on, value')
      .order('observed_on', { ascending: false })
      .limit(2000),
    supabase.from('crops').select('id, name, yield_unit, test_weight_lb_per_bu'),
  ])
  if (series.error) throw series.error
  if (prices.error) throw prices.error
  if (crops.error) throw crops.error
  const cropById = new Map((crops.data ?? []).map((c) => [c.id, c]))

  const latest = new Map<string, { value: number; on: string }>()
  for (const p of prices.data ?? []) {
    // Ordered newest first, so the first sighting of a series is its latest.
    if (latest.has(p.series_id)) continue
    const v = numOrNull(p.value)
    if (v != null) latest.set(p.series_id, { value: v, on: p.observed_on })
  }

  const byCrop = new Map<string, CropBoard>()
  for (const s of series.data ?? []) {
    if (!s.crop_id) continue
    const l = latest.get(s.id)
    const crop = cropById.get(s.crop_id)
    if (!l || !crop) continue
    const price = boardPriceIn(l.value, s.unit, {
      name: crop.name,
      unit: crop.yield_unit,
      testWeightLbPerBu: crop.test_weight_lb_per_bu,
    })
    if (!price) continue
    const seen = byCrop.get(s.crop_id)
    if (!seen || l.on > seen.on)
      byCrop.set(s.crop_id, { ...price, seriesId: s.id, name: s.name, on: l.on })
  }
  return { byCrop, series: series.data ?? [] }
}
