/**
 * Reads and writes for the Fuel page: Fuel supplier purchases, the market
 * series, and the typed default.
 *
 * The choice of the ONE diesel price every cost uses is made in
 * hauling-data.ts (useBasics → costingDiesel), from the two small reads at the
 * bottom of this file; it lives there because that is where the trucking,
 * field-work and manure costs already get their diesel from.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import type { Json } from './database.types'
import { farmCode } from './fuel-market'
import type { FuelProduct } from './fuel-supplier-invoice'

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

export type FuelPurchase = {
  id: string
  supplier: string
  invoice_no: string | null
  invoice_date: string
  product: FuelProduct
  description: string | null
  litres: number
  price_per_l: number
  amount: number | null
  checked: boolean
  source: 'invoice' | 'typed'
  source_file: string | null
  notes: string | null
}

export function useFuelPurchases() {
  return useQuery({
    queryKey: ['fuel_purchases'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('fuel_purchases')
        .select('id, supplier, invoice_no, invoice_date, product, description, litres, price_per_l, amount, checked, source, source_file, notes')
        .order('invoice_date', { ascending: false })
        .limit(2000)
      if (error) throw error
      return (data ?? []).map((r) => ({
        ...r,
        litres: Number(r.litres),
        price_per_l: Number(r.price_per_l),
        amount: num(r.amount),
      })) as FuelPurchase[]
    },
    staleTime: 10 * 60_000,
  })
}

export function useSaveFuelPurchase() {
  const qc = useQueryClient()
  return useMutation({
    networkMode: 'always',
    mutationFn: async (v: { invoice_date: string; product: FuelProduct; litres: number; price_per_l: number; invoice_no?: string | null; notes?: string | null }) => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      const { error } = await supabase.from('fuel_purchases').insert({
        supplier: 'Fuel supplier',
        invoice_no: v.invoice_no?.trim() || null,
        invoice_date: v.invoice_date,
        product: v.product,
        litres: v.litres,
        price_per_l: v.price_per_l,
        amount: fuelLineAmount(v.litres, v.price_per_l),
        source: 'typed',
        notes: v.notes ?? null,
        created_by: user?.id ?? null,
      })
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['fuel_purchases'] })
      void qc.invalidateQueries({ queryKey: ['fuel-costing'] })
    },
  })
}

/** A line's amount from its litres and price, to the cent. */
export function fuelLineAmount(litres: number, pricePerL: number): number {
  return Math.round(litres * pricePerL * 100) / 100
}

/**
 * Correct a hand-typed line (Sam, 7 Oct 2026: every row can be opened and
 * edited). Invoice lines are left to the filer, which would put them back.
 */
export function useUpdateFuelPurchase() {
  const qc = useQueryClient()
  return useMutation({
    networkMode: 'always',
    mutationFn: async (v: {
      id: string
      invoice_date: string
      product: FuelProduct
      litres: number
      price_per_l: number
      supplier: string
      invoice_no: string | null
      description: string | null
      notes: string | null
    }) => {
      const { id, ...rest } = v
      const { error } = await supabase
        .from('fuel_purchases')
        .update({ ...rest, supplier: rest.supplier.trim() || 'Fuel supplier', amount: fuelLineAmount(v.litres, v.price_per_l) })
        .eq('id', id)
        .eq('source', 'typed')
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['fuel_purchases'] })
      void qc.invalidateQueries({ queryKey: ['fuel-costing'] })
    },
  })
}

export function useDeleteFuelPurchase() {
  const qc = useQueryClient()
  return useMutation({
    networkMode: 'always',
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('fuel_purchases').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['fuel_purchases'] })
      void qc.invalidateQueries({ queryKey: ['fuel-costing'] })
    },
  })
}

/** Ask NRCan again now (the daily run does this by itself). */
export function useRefreshFuelMarket() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const res = await fetch('/api/market-fuel-sync', { method: 'POST', headers: { Authorization: `Bearer ${session?.access_token ?? ''}` } })
      const body = (await res.json().catch(() => ({}))) as { detail?: string; error?: string }
      if (!res.ok) throw new Error(body.error ?? body.detail ?? `Failed: ${res.status}`)
      return body.detail ?? 'done'
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['market-series'] })
      void qc.invalidateQueries({ queryKey: ['market-prices'] })
      void qc.invalidateQueries({ queryKey: ['fuel-costing'] })
    },
  })
}

/** The typed fallback, saved under its own key with who and when. */
export function useSaveTypedFuelDefault() {
  const qc = useQueryClient()
  return useMutation({
    networkMode: 'always',
    mutationFn: async (v: { perL: number; by: string | null }) => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      const value = { perL: v.perL, product: 'farm_diesel', by: v.by, on: new Date().toISOString().slice(0, 10) }
      const { error } = await supabase
        .from('operating_settings')
        .upsert({ key: 'fuel_default_per_l', value: value as unknown as Json, updated_by: user?.id ?? null, updated_at: new Date().toISOString() }, { onConflict: 'key' })
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['operating_settings'] }),
  })
}

export type TypedFuelDefault = { perL: number; on: string | null; by: string | null }

export function typedDefaultOf(v: unknown): TypedFuelDefault | null {
  const o = v as { perL?: unknown; on?: unknown; by?: unknown } | null | undefined
  const perL = num(o?.perL)
  return perL != null ? { perL, on: typeof o?.on === 'string' ? o.on : null, by: typeof o?.by === 'string' ? o.by : null } : null
}

/* ------------------------------------------------------------- for costing */

export type FuelCostingInputs = {
  invoice: { perL: number; on: string; invoiceNo: string | null } | null
  market: { perL: number; on: string } | null
}

/**
 * The newest farm-diesel invoice line and the newest market farm-diesel
 * figure: the two live inputs to the costing price. Small on purpose — this
 * runs on every page that costs fuel.
 */
export function fuelCostingInputsQuery() {
  return {
    queryKey: ['fuel-costing'],
    queryFn: async (): Promise<FuelCostingInputs> => {
      const [inv, series] = await Promise.all([
        supabase
          .from('fuel_purchases')
          .select('invoice_no, invoice_date, price_per_l')
          .eq('product', 'farm_diesel')
          .order('invoice_date', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase.from('market_series').select('id').eq('code', farmCode('diesel')).maybeSingle(),
      ])
      // A missing table (the migration not yet applied) is "no invoice", not a broken page.
      const invoice = inv.data
        ? { perL: Number(inv.data.price_per_l), on: inv.data.invoice_date as string, invoiceNo: (inv.data.invoice_no as string | null) ?? null }
        : null
      let market: { perL: number; on: string } | null = null
      if (series.data?.id) {
        const { data } = await supabase
          .from('market_prices')
          .select('observed_on, value')
          .eq('series_id', series.data.id)
          .order('observed_on', { ascending: false })
          .limit(1)
          .maybeSingle()
        const v = num(data?.value)
        if (data && v != null) market = { perL: v, on: data.observed_on }
      }
      return { invoice, market }
    },
  }
}

export function useFuelCostingInputs() {
  return useQuery({ ...fuelCostingInputsQuery(), staleTime: 30 * 60_000 })
}
