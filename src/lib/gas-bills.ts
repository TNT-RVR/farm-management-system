import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import { fetchAll } from './reports/framework'
import type { GasBillRow, GasPlaceRow, GasSiteRow, PlaceKind } from './gas-bills-core'

export * from './gas-bills-core'

/**
 * Natural gas bills (gas_bills, gas_bill_sites, gas_sites), read out of
 * QuickBooks by netlify/shared/gas-bills-qb-read.ts. Managers only, at the
 * database.
 */

const BILL_COLS = 'id, source, status, file_name, account_number, bill_date, period_start, period_end, total, budget_plan, adjusted, error, notes, qb_txn_ref'
const SITE_COLS =
  'id, bill_id, site_id, address, legal_land, meter_number, period_start, period_end, gj, energy_charge, admin_fee, delivery_fixed, delivery_variable, riders, carbon_levy, other_charges, rebilled_start, rebilled_end, rebilled_charges, gst, total'

export const gasBillsQuery = () => ({
  queryKey: ['gas-bills'] as const,
  queryFn: async (): Promise<GasBillRow[]> =>
    fetchAll<GasBillRow>((from, to) => supabase.from('gas_bills').select(BILL_COLS).order('bill_date', { ascending: false }).range(from, to)),
})

export const gasBillSitesQuery = () => ({
  queryKey: ['gas-bill-sites'] as const,
  queryFn: async (): Promise<GasSiteRow[]> => fetchAll<GasSiteRow>((from, to) => supabase.from('gas_bill_sites').select(SITE_COLS).order('period_end', { ascending: false }).range(from, to)),
})

export const gasSitesQuery = () => ({
  queryKey: ['gas-sites'] as const,
  queryFn: async (): Promise<GasPlaceRow[]> => {
    const { data, error } = await supabase.from('gas_sites').select('id, site_id, place, place_kind, address, legal_land, meter_number, place_set_by_hand').order('site_id')
    if (error) throw error
    return (data ?? []) as GasPlaceRow[]
  },
})

export const useGasBills = () => useQuery(gasBillsQuery())
export const useGasBillSites = () => useQuery(gasBillSitesQuery())
export const useGasSites = () => useQuery(gasSitesQuery())

/** Name the farm place a gas site is: a person's word, kept for every bill of it. */
export function useNameGasSite() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ siteId, place, kind }: { siteId: string; place: string | null; kind: PlaceKind | null }) => {
      const { error } = await supabase
        .from('gas_sites')
        .update({ place: place?.trim() || null, place_kind: kind, place_set_by_hand: true, updated_at: new Date().toISOString() })
        .eq('site_id', siteId)
      if (error) throw error
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['gas-sites'] }),
  })
}

/** Read the gas bill PDFs in QuickBooks now (owners and the accountant): a background job of up to 15 minutes. */
export function useReadQbGasBills() {
  return useMutation({
    mutationFn: async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const res = await fetch('/.netlify/functions/gas-bills-qb-background', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token ?? ''}`, 'content-type': 'application/json' },
        body: '{}',
      })
      if (!res.ok && res.status !== 202) throw new Error(`Could not start the reading (${res.status})`)
      return true
    },
  })
}
