/**
 * Reads for the Calculator's Operation cost and Irrigation cost tabs. The
 * arithmetic is in operation-cost.ts and irrigation-cost.ts; everything here
 * goes through RLS as the person looking (duplicates hidden, finance-only rows
 * simply absent).
 */
import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
import type { HandRecord, HistoryOp } from './operation-cost'
import type { InvPurchase } from './chem-inventory'
import type { YearAllotment } from './water-allocation'

export type CalcOp = HistoryOp & {
  field_id: string | null
  crop_season: number | null
  started_at: string | null
}

const OP_COLS =
  'id, jd_id, field_id, operation_type, crop_season, started_at, ended_at, machine_id, machine_vin, work_minutes, fuel_l, fuel_read_at, sessions, applied_area_ha, cost_acres_override, not_ours, products, as_applied'

/** Every Deere pass (all seasons) and every hand-entered field work record with hours. */
export function useOpCostHistory() {
  return useQuery({
    queryKey: ['op-cost-history', 'v1'],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const ops: CalcOp[] = []
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase.from('jd_field_operations').select(OP_COLS).order('id').range(from, from + 999)
        if (error) throw error
        ops.push(...((data ?? []) as unknown as CalcOp[]))
        if ((data ?? []).length < 1000) break
      }
      const { data: recs, error } = await supabase
        .from('field_work_records')
        .select('work_type, machine_ids, hours, acres, started_at, finished_at')
        .not('acres', 'is', null)
      if (error) throw error
      return { ops, records: (recs ?? []) as HandRecord[] }
    },
  })
}

/**
 * Invoice lines, for the pack each product was last bought in ("4.6 jugs").
 * An empty list rather than an error if the reader cannot see them.
 */
export function useProductPacks() {
  return useQuery({
    queryKey: ['op-cost-packs', 'v1'],
    staleTime: 30 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('product_purchases')
        .select('product_id, invoice_no, invoice_date, description, amount, price_per_canonical, quantity, pack_size, pack_unit, canonical_unit')
        .eq('is_product', true)
        .not('product_id', 'is', null)
      if (error) return [] as (InvPurchase & { product_id: string })[]
      return (data ?? []) as unknown as (InvPurchase & { product_id: string })[]
    },
  })
}

/** What a product's label says about rates and water volume, as written. */
export function useLabelHints(registration: string | null | undefined) {
  return useQuery({
    queryKey: ['op-cost-label', 'v1', registration],
    enabled: Boolean(registration),
    staleTime: 60 * 60_000,
    queryFn: async () => {
      const [crops, label] = await Promise.all([
        supabase.from('chemical_label_crops').select('crop, rate').eq('registration_number', registration!).not('rate', 'is', null).limit(40),
        supabase.from('chemical_labels').select('water_volume').eq('registration_number', registration!).maybeSingle(),
      ])
      const rates = new Map<string, string[]>()
      for (const r of (crops.data ?? []) as { crop: string; rate: string | null }[]) {
        if (!r.rate) continue
        const list = rates.get(r.rate) ?? []
        if (!list.includes(r.crop)) list.push(r.crop)
        rates.set(r.rate, list)
      }
      return {
        rates: [...rates.entries()].map(([rate, cropList]) => ({ rate, crops: cropList })),
        waterVolume: (label.data as { water_volume: string | null } | null)?.water_volume ?? null,
      }
    },
  })
}

/** SMRID's allotment by year, and the gross depth FieldNET logged on a field this season. */
export function useIrrigationSeason(fieldId: string | null, year: number) {
  return useQuery({
    queryKey: ['irrigation-cost-season', 'v1', fieldId, year],
    enabled: Boolean(fieldId),
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const [allot, events] = await Promise.all([
        supabase.from('water_allotments').select('year, inches, contract_inches').eq('source', 'smrid').order('year'),
        supabase.from('irrigation_events').select('gross_mm, net_mm').eq('field_id', fieldId!).gte('date', `${year}-01-01`).lte('date', `${year}-12-31`),
      ])
      if (allot.error) throw allot.error
      if (events.error) throw events.error
      const mm = (events.data ?? []).reduce((s, e) => s + Number(e.gross_mm ?? e.net_mm ?? 0), 0)
      return { allotments: (allot.data ?? []) as YearAllotment[], usedIn: mm / 25.4, events: (events.data ?? []).length }
    },
  })
}
