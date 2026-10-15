import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import type { Database } from './database.types'
import type { SummaryRow } from './water-concerns'

export type WqStation = Database['public']['Tables']['water_quality_stations']['Row']
export type WqSample = Database['public']['Tables']['water_quality_samples']['Row']

/** The parameters shown, in the order a reader wants them. */
export const WQ_PARAMS: { key: string; label: string; unit: string; digits: number }[] = [
  { key: 'so4_mg_l', label: 'Sulphate', unit: 'mg/L', digits: 0 },
  { key: 'no3n_mg_l', label: 'Nitrate-N', unit: 'mg/L', digits: 3 },
  { key: 'ec_us_cm', label: 'EC', unit: 'µS/cm', digits: 0 },
  { key: 'sar', label: 'SAR', unit: '', digits: 2 },
]

/** lb S per acre-inch from sulphate mg/L: × (32/96) S in SO4 × 0.2266 lb/ac-in per mg/L. */
export const soToLbSPerInch = (so4: number) => Math.round(so4 * 0.0756 * 100) / 100

/** Every station, and each one's newest reading of the shown parameters. */
export function useWaterQualityLatest() {
  return useQuery({
    queryKey: ['water_quality', 'latest'],
    queryFn: async () => {
      const since = new Date()
      since.setFullYear(since.getFullYear() - 3)
      const [st, sm] = await Promise.all([
        supabase.from('water_quality_stations').select('*').eq('active', true),
        supabase
          .from('water_quality_samples')
          .select('station_id, sampled_at, parameter, value, below_dl')
          .in('parameter', WQ_PARAMS.map((p) => p.key))
          .gte('sampled_at', since.toISOString())
          .order('sampled_at', { ascending: false })
          .limit(5000),
      ])
      if (st.error) throw st.error
      if (sm.error) throw sm.error
      const latest = new Map<string, Map<string, { value: number; below: boolean; at: string }>>()
      for (const r of sm.data ?? []) {
        const m = latest.get(r.station_id) ?? new Map()
        if (!m.has(r.parameter)) m.set(r.parameter, { value: Number(r.value), below: r.below_dl, at: r.sampled_at })
        latest.set(r.station_id, m)
      }
      return { stations: (st.data ?? []) as WqStation[], latest }
    },
    staleTime: 60 * 60_000,
  })
}

/**
 * Five seasons per station and parameter, from the water_quality_summary view
 * — what the concern list is judged on. Paged: nine stations × ~270 things
 * tested is more than one request returns.
 */
export function useWaterQualitySummary() {
  return useQuery({
    queryKey: ['water_quality', 'summary'],
    queryFn: async () => {
      const rows: SummaryRow[] = []
      for (let from = 0; from < 20_000; from += 1000) {
        const { data, error } = await supabase
          .from('water_quality_summary')
          .select('*')
          .order('station_id')
          .order('parameter')
          .range(from, from + 999)
        if (error) throw error
        rows.push(...((data ?? []) as SummaryRow[]))
        if ((data ?? []).length < 1000) break
      }
      return rows
    },
    staleTime: 60 * 60_000,
  })
}

/** A manager's "pull now". The worker is a background function: 202 means started. */
export function usePullWaterQuality() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const res = await fetch('/api/water-quality-background', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token ?? ''}` },
      })
      if (res.status !== 202 && !res.ok) throw new Error(`Pull failed (${res.status})`)
    },
    onSuccess: () => {
      // The pull takes a few seconds to land; look again shortly.
      setTimeout(() => {
        void qc.invalidateQueries({ queryKey: ['water_quality'] })
        void qc.invalidateQueries({ queryKey: ['water_s_credit'] })
      }, 20_000)
    },
  })
}
