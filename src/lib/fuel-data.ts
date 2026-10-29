/**
 * Reads and writes for the Fuel page: Fuel supplier purchases, the market
 * series, and the typed default.
 *
 * The choice of the ONE diesel price every cost uses is made in
 * hauling-data.ts (useBasics → costingDiesel), from the two small reads at the
 * bottom of this file; it lives there because that is where the trucking,
 * field-work and manure costs already get their diesel from.
 */
import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from './supabase'
import type { Json } from './database.types'
import { farmCode } from './fuel-market'
import type { FuelProduct } from './fuel-supplier-invoice'
import { latestQbPrices, readQbFuelBills, type QbFuelBill, type QbFuelLineRow } from './qb-fuel'

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
  /** The invoice line (1, 2, …) for a line read from an invoice; null when typed. */
  line_no: number | null
  /** 'Bill:123' — the QuickBooks bill whose attached PDF the line was read from. */
  qb_txn_ref: string | null
  qb_attachable_id: string | null
}

export function useFuelPurchases() {
  return useQuery({
    // 2: the QuickBooks columns (a saved offline copy without them is not reused).
    queryKey: ['fuel_purchases', 2],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('fuel_purchases')
        .select('id, supplier, invoice_no, invoice_date, product, description, litres, price_per_l, amount, checked, source, source_file, notes, line_no, qb_txn_ref, qb_attachable_id')
        .order('invoice_date', { ascending: false })
        .order('line_no', { ascending: true, nullsFirst: false })
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

/* ---------------------------------------------------- QuickBooks bills */

/**
 * Fuel supplier's lines out of the synced QuickBooks books.
 *
 * Through fuel_supplier_qb_lines() (qb_lines is finance-only, and the costing
 * price must not change with who is looking): every active user gets the lines
 * that state litres or a $/L, finance users every line. Until that function exists, a finance user's own read of
 * qb_lines stands in, and everyone else gets none: the costing then falls
 * back exactly as it did before QuickBooks.
 */
export async function fetchFuelSupplierQbLines(): Promise<QbFuelLineRow[]> {
  const db = supabase as unknown as SupabaseClient
  const rpc = await db.rpc('fuel_supplier_qb_lines')
  if (!rpc.error) return (rpc.data ?? []) as QbFuelLineRow[]
  const { data: lines, error } = await db
    .from('qb_lines')
    .select('entity, qb_id, line_no, txn_date, description, amount, account_name, entity_row_id')
    .ilike('party_name', 'power fuel%')
    .in('entity', ['Bill', 'Purchase', 'VendorCredit'])
    .order('txn_date', { ascending: false })
    .limit(1000)
  if (error || !lines?.length) return []
  const ids = [...new Set(lines.map((l) => l.entity_row_id as string))]
  const docs = new Map<string, string | null>()
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await db.from('qb_entities').select('id, doc_number').in('id', ids.slice(i, i + 200))
    for (const e of data ?? []) docs.set(e.id as string, (e.doc_number as string | null) ?? null)
  }
  const refs = [...new Set(lines.map((l) => `${l.entity}:${l.qb_id}`))]
  const files = new Map<string, string>()
  for (let i = 0; i < refs.length; i += 100) {
    const { data } = await db.from('qb_entities').select('qb_id, refs').eq('entity', 'Attachable').overlaps('refs', refs.slice(i, i + 100))
    for (const a of data ?? []) for (const r of (a.refs as string[] | null) ?? []) if (!files.has(r)) files.set(r, a.qb_id as string)
  }
  return lines.map((l) => ({
    ...l,
    doc_number: docs.get(l.entity_row_id as string) ?? null,
    attachable_id: files.get(`${l.entity}:${l.qb_id}`) ?? null,
  })) as QbFuelLineRow[]
}

/**
 * Read the Fuel supplier invoice PDFs in QuickBooks now (the nightly sync does
 * it by itself). Background: answers at once; the lines land within minutes.
 */
export function useReadFuelSupplierInvoices() {
  return useMutation({
    mutationFn: async (reread: boolean = false) => {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const res = await fetch('/api/fuel-supplier-invoices-background', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}` },
        body: JSON.stringify({ reread }),
      })
      if (!res.ok && res.status !== 202) throw new Error(`Failed: ${res.status}`)
    },
  })
}

/** Fuel supplier bills from QuickBooks, one per fuel per bill, newest first. */
export function qbFuelBillsQuery() {
  return {
    queryKey: ['qb-fuel-bills', 1],
    queryFn: async (): Promise<QbFuelLineRow[]> => fetchFuelSupplierQbLines(),
  }
}

/**
 * The rows are cached as QuickBooks returned them and read into bills at
 * render, so a change to the reading reaches a saved offline copy too.
 */
export function useQbFuelBills() {
  const q = useQuery({ ...qbFuelBillsQuery(), staleTime: 30 * 60_000 })
  const bills = useMemo<QbFuelBill[]>(() => readQbFuelBills(q.data ?? []), [q.data])
  return { ...q, bills }
}

/** Where the newest QuickBooks farm-diesel price came from, for the costing chain. */
export type QbCostingPrice = { perL: number; on: string; docNumber: string | null; litres: number | null; assumedDyed: boolean }

export function qbFarmDieselFrom(rows: QbFuelLineRow[]): QbCostingPrice | null {
  const b = latestQbPrices(readQbFuelBills(rows)).get('farm_diesel')
  return b?.perL != null ? { perL: b.perL, on: b.on, docNumber: b.docNumber, litres: b.litres, assumedDyed: b.assumedDyed } : null
}

/* ------------------------------------------------------------- for costing */

export type FuelCostingInputs = {
  invoice: { perL: number; on: string; invoiceNo: string | null } | null
  market: { perL: number; on: string } | null
  /** Optional: a copy saved offline before QuickBooks was read has none. */
  quickbooks?: QbCostingPrice | null
}

/**
 * The newest farm-diesel invoice line, the newest priced farm-diesel bill in
 * QuickBooks and the newest market farm-diesel figure: the live inputs to the
 * costing price. Small on purpose (one row each, and Fuel supplier's few
 * hundred QuickBooks lines) — this runs on every page that costs fuel.
 */
export function fuelCostingInputsQuery() {
  return {
    queryKey: ['fuel-costing'],
    queryFn: async (): Promise<FuelCostingInputs> => {
      const [inv, series, qbRows] = await Promise.all([
        supabase
          .from('fuel_purchases')
          .select('invoice_no, invoice_date, price_per_l')
          .eq('product', 'farm_diesel')
          .order('invoice_date', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase.from('market_series').select('id').eq('code', farmCode('diesel')).maybeSingle(),
        // QuickBooks is a bonus: a failure here is "no QuickBooks price", never a broken page.
        fetchFuelSupplierQbLines().catch(() => [] as QbFuelLineRow[]),
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
      return { invoice, market, quickbooks: qbFarmDieselFrom(qbRows) }
    },
  }
}

export function useFuelCostingInputs() {
  return useQuery({ ...fuelCostingInputsQuery(), staleTime: 30 * 60_000 })
}

/* ── Fuel tanks ──────────────────────────────────────────────────────────── */

/** A tank on the farm. capacity and level in litres; level is the last gauge reading, if any. */
export type FuelTank = {
  id: string
  name: string
  location: string | null
  product: FuelProduct
  capacity_l: number
  level_l: number | null
  level_on: string | null
  notes: string | null
  /** Its pin on the Fuel page map. */
  lat: number | null
  lng: number | null
  /** The TELUS gauge on it, if any; its readings then fill the level. */
  telus_device_id: number | null
  level_at: string | null
  level_source: 'typed' | 'telus' | null
  /** What the gauge says about itself at the last sync: Telus has it online, when Telus last heard from it, battery and signal. */
  gauge_online: boolean | null
  gauge_seen_at: string | null
  gauge_info: Record<string, number | string | boolean> | null
}

export function useFuelTanks() {
  return useQuery({
    queryKey: ['fuel_tanks'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('fuel_tanks')
        .select('id, name, location, product, capacity_l, level_l, level_on, notes, lat, lng, telus_device_id, level_at, level_source, gauge_online, gauge_seen_at, gauge_info')
        .order('product')
        .order('name')
      if (error) throw error
      return (data ?? []).map((t) => ({
        ...t,
        product: t.product as FuelProduct,
        capacity_l: Number(t.capacity_l),
        level_l: t.level_l == null ? null : Number(t.level_l),
        lat: t.lat == null ? null : Number(t.lat),
        lng: t.lng == null ? null : Number(t.lng),
      })) as FuelTank[]
    },
  })
}

export function useSaveFuelTank() {
  const qc = useQueryClient()
  return useMutation({
    networkMode: 'always',
    mutationFn: async ({ id, patch }: { id: string | null; patch: Partial<Omit<FuelTank, 'id'>> }) => {
      const row = { ...patch, updated_at: new Date().toISOString() }
      const { error } = id
        ? await supabase.from('fuel_tanks').update(row).eq('id', id)
        : await supabase.from('fuel_tanks').insert(row as typeof row & { name: string; capacity_l: number })
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['fuel_tanks'] }),
  })
}

export function useDeleteFuelTank() {
  const qc = useQueryClient()
  return useMutation({
    networkMode: 'always',
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('fuel_tanks').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['fuel_tanks'] }),
  })
}

/** Read the TELUS gauges now, as the signed-in manager (the same read the 15-minute job does). */
export function useSyncTelusGauges() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const res = await fetch('/api/telus-fuel-sync', { method: 'POST', headers: { Authorization: `Bearer ${session?.access_token ?? ''}` } })
      const body = (await res.json().catch(() => ({}))) as { detail?: string; error?: string }
      if (!res.ok) throw new Error(body.detail ?? body.error ?? `Failed: ${res.status}`)
      return body.detail ?? 'done'
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['fuel_tanks'] }),
  })
}
