import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import type { Database } from './database.types'

// Grain contracts, and the position they leave behind.
//
// The question this exists to answer is "how much have I still got to sell",
// which nothing in the app could answer before: the contracts table has been
// there, and empty, since it was created.

export type Contract = {
  id: string
  crop_year: number
  crop_id: string | null
  buyer_contact_id: string | null
  contract_number: string | null
  bushels: number | null
  price_per_unit: number | null
  delivery_start: string | null
  delivery_end: string | null
  delivered_bu: number | null
  status: string | null
  notes_md: string | null
}

const num = (v: number | string | null | undefined): number | null => {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

export function useContracts(cropYear: number) {
  return useQuery({
    queryKey: ['contracts', cropYear],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('contracts')
        .select('*')
        .eq('crop_year', cropYear)
        .order('delivery_start', { nullsFirst: false })
      if (error) throw error
      return (data ?? []).map((c) => ({
        ...c,
        bushels: num(c.bushels),
        price_per_unit: num(c.price_per_unit),
        delivered_bu: num(c.delivered_bu),
      })) as Contract[]
    },
  })
}

export function useSaveContract() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (
      row: Database['public']['Tables']['contracts']['Insert'] & { id?: string },
    ) => {
      const { id, ...rest } = row
      const { error } = id
        ? await supabase.from('contracts').update(rest).eq('id', id)
        : await supabase.from('contracts').insert(rest)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['contracts'] }),
  })
}

export function useDeleteContract() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('contracts').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['contracts'] }),
  })
}

// ── Position ────────────────────────────────────────────────────────────────

export type CropPosition = {
  cropId: string
  cropName: string
  /** Acres planned, and the yield used — an estimate until it is in the bin. */
  acres: number
  yieldPerAcre: number | null
  expectedBu: number | null
  contractedBu: number
  deliveredBu: number
  /** Expected minus contracted. Null when there is no yield to expect from. */
  unsoldBu: number | null
  /** Weighted average of what the contracted bushels were sold for. */
  avgContractPrice: number | null
  /** Today's bid, per bushel, when the market carries one. */
  todayBid: number | null
  /** What the unsold bushels are worth at that bid. */
  unsoldValue: number | null
}

/**
 * What is grown, what is sold, and what is left.
 *
 * Expected production is planned acres times yield, so it is a forecast and is
 * labelled as one everywhere it appears. Contracted and delivered are facts.
 * Unsold is the difference, and it is null rather than zero when there is no
 * yield figure — "nothing left to sell" and "we do not know what we will grow"
 * are very different things to tell someone.
 */
export function cropPositions(input: {
  plans: { crop_id: string | null; planned_acres: number | null; yield_per_acre_override: number | null }[]
  crops: { id: string; name: string; default_yield_per_acre: number | null }[]
  contracts: Contract[]
  bidPerBushel: Map<string, number>
}): CropPosition[] {
  const { plans, crops, contracts, bidPerBushel } = input
  const byCrop = new Map<string, CropPosition>()

  for (const c of crops) {
    byCrop.set(c.id, {
      cropId: c.id,
      cropName: c.name,
      acres: 0,
      yieldPerAcre: c.default_yield_per_acre,
      expectedBu: null,
      contractedBu: 0,
      deliveredBu: 0,
      unsoldBu: null,
      avgContractPrice: null,
      todayBid: bidPerBushel.get(c.id) ?? null,
      unsoldValue: null,
    })
  }

  // Acres and expected bushels, honouring a per-field yield override.
  for (const p of plans) {
    if (!p.crop_id) continue
    const pos = byCrop.get(p.crop_id)
    if (!pos) continue
    const acres = p.planned_acres ?? 0
    const y = p.yield_per_acre_override ?? pos.yieldPerAcre
    pos.acres += acres
    if (y != null && acres > 0) pos.expectedBu = (pos.expectedBu ?? 0) + acres * y
  }

  for (const k of contracts) {
    if (!k.crop_id) continue
    const pos = byCrop.get(k.crop_id)
    if (!pos) continue
    pos.contractedBu += k.bushels ?? 0
    pos.deliveredBu += k.delivered_bu ?? 0
  }

  // Weighted average contract price, by bushel.
  for (const pos of byCrop.values()) {
    const mine = contracts.filter((k) => k.crop_id === pos.cropId && k.price_per_unit != null && k.bushels)
    const bu = mine.reduce((s, k) => s + (k.bushels ?? 0), 0)
    pos.avgContractPrice =
      bu > 0 ? mine.reduce((s, k) => s + (k.bushels ?? 0) * (k.price_per_unit ?? 0), 0) / bu : null
    if (pos.expectedBu != null) {
      pos.unsoldBu = Math.max(0, pos.expectedBu - pos.contractedBu)
      pos.unsoldValue = pos.todayBid != null ? pos.unsoldBu * pos.todayBid : null
    }
  }

  return [...byCrop.values()]
    .filter((p) => p.acres > 0 || p.contractedBu > 0)
    .sort((a, b) => b.acres - a.acres || a.cropName.localeCompare(b.cropName))
}

/**
 * What we actually got for a crop, against what the market averaged that year.
 *
 * The only honest way to judge a marketing decision after the fact: beating the
 * average means the timing was good, not that the price was.
 */
export function realisedVsMarket(
  avgContractPrice: number | null,
  marketPricesThatYear: number[],
): { market: number; diff: number; pct: number } | null {
  if (avgContractPrice == null || marketPricesThatYear.length < 3) return null
  const market =
    marketPricesThatYear.reduce((s, v) => s + v, 0) / marketPricesThatYear.length
  if (market <= 0) return null
  return {
    market,
    diff: avgContractPrice - market,
    pct: ((avgContractPrice - market) / market) * 100,
  }
}
