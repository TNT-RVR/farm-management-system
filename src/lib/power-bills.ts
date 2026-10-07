import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from './supabase'
import type { BillSiteRow } from './power-bills-core'

export * from './power-bills-core'

/**
 * Power bills, read site by site (power_bills, power_bill_sites;
 * netlify/functions/power-bills*). Upload a PDF and the background reader
 * splits it into its sites and matches each to a pump by its meter. Managers
 * only, at the database. The tables are not in database.types: read through
 * an untyped handle and shaped on the way out.
 */
const db = supabase as unknown as SupabaseClient

export type PowerBill = {
  id: string
  source: 'upload' | 'quickbooks'
  storage_path: string | null
  file_name: string | null
  status: 'pending' | 'read' | 'error'
  error: string | null
  retailer: string | null
  bill_date: string | null
  period_start: string | null
  period_end: string | null
  total: number | null
  notes: string | null
  created_at: string
}

async function authedFetch(path: string, body: unknown) {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}` },
    body: JSON.stringify(body),
  })
  const out = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((out as { error?: string }).error ?? `Request failed (${res.status})`)
  return out as { queued: number }
}

export function usePowerBills() {
  return useQuery({
    queryKey: ['power-bills'],
    queryFn: async () => {
      const { data, error } = await db
        .from('power_bills')
        .select('id, source, storage_path, file_name, status, error, retailer, bill_date, period_start, period_end, total, notes, created_at')
        .order('created_at', { ascending: false })
        .limit(500)
      if (error) throw error
      return (data ?? []) as PowerBill[]
    },
    // While a bill is being read, look again every few seconds.
    refetchInterval: (q) => (q.state.data?.some((b) => b.status === 'pending') ? 5000 : false),
  })
}

/** `version` changes when a bill finishes reading, so its sites are fetched again. */
export function usePowerBillSites(version: number) {
  return useQuery({
    queryKey: ['power-bill-sites', version],
    queryFn: async () => {
      const out: BillSiteRow[] = []
      for (let from = 0; ; from += 1000) {
        const { data, error } = await db.from('power_bill_sites').select('*').range(from, from + 999)
        if (error) throw error
        out.push(...((data ?? []) as BillSiteRow[]).map((r) => ({ ...r, ...numeric(r) })))
        if (!data || data.length < 1000) break
      }
      return out
    },
  })
}

const numeric = (r: BillSiteRow) => {
  const keys = ['kwh', 'demand_kw', 'energy_charge', 'delivery_charge', 'demand_charge', 'other_charges', 'gst', 'total'] as const
  return Object.fromEntries(keys.map((k) => [k, r[k] == null ? null : Number(r[k])])) as Pick<BillSiteRow, (typeof keys)[number]>
}

/** Upload PDFs and have them read. */
export function useUploadPowerBills() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (files: File[]) => {
      const ids: string[] = []
      for (const f of files) {
        const path = `power-bills/${crypto.randomUUID()}.pdf`
        const { error: e1 } = await supabase.storage.from('invoices').upload(path, f, { contentType: 'application/pdf' })
        if (e1) throw new Error(`${f.name}: ${e1.message}`)
        const { data, error: e2 } = await db.from('power_bills').insert({ source: 'upload', storage_path: path, file_name: f.name }).select('id').single()
        if (e2) throw new Error(`${f.name}: ${e2.message}`)
        ids.push(data.id as string)
      }
      return authedFetch('/api/power-bills', { action: 'read', ids })
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['power-bills'] }),
  })
}

/** Owners and the accountant: read every power bill PDF attached in QuickBooks. */
export function useReadQbPowerBills() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => authedFetch('/api/power-bills', { action: 'from_quickbooks' }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['power-bills'] }),
  })
}

/** Read a bill again (after an error), or set the pump a site belongs to. */
export function useRereadPowerBill() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.from('power_bills').update({ status: 'pending', error: null }).eq('id', id)
      if (error) throw error
      return authedFetch('/api/power-bills', { action: 'read', ids: [id] })
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['power-bills'] }),
  })
}

export function useSetSitePump() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ siteIds, pumpId }: { siteIds: string[]; pumpId: string | null }) => {
      // A pump picked by hand is a person's word: no longer a guess.
      const { error } = await db.from('power_bill_sites').update({ pump_id: pumpId, pump_set_by_hand: true, pump_unconfirmed: false }).in('id', siteIds)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['power-bill-sites'] }),
  })
}

/** "Yes, that guess is right": the pump's guessed sites become confirmed. */
export function useConfirmSitePump() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (pumpId: string) => {
      const { error } = await db.from('power_bill_sites').update({ pump_unconfirmed: false }).eq('pump_id', pumpId).eq('pump_unconfirmed', true)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['power-bill-sites'] }),
  })
}

export function useDeletePowerBill() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (b: PowerBill) => {
      const { error } = await db.from('power_bills').delete().eq('id', b.id)
      if (error) throw error
      if (b.storage_path) await supabase.storage.from('invoices').remove([b.storage_path])
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['power-bills'] })
      qc.invalidateQueries({ queryKey: ['power-bill-sites'] })
    },
  })
}
