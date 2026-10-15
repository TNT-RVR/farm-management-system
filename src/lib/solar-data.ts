import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import { fetchAll } from './reports/framework'
import type { SolarDailyRow, SolarLatestRow, SolarSiteRow } from './solar'

/**
 * The Solar page's reads, and its "Update now".
 *
 * solar_latest is a live reading and is in LIVE_ONLY (src/lib/offline.ts):
 * "the panels are making 124 kW" restored from last week's cache is a lie.
 * The plants and their days are records, and are kept offline like any other.
 */

export const solarSitesQuery = () => ({
  queryKey: ['solar_sites'],
  queryFn: async () => {
    const { data, error } = await supabase
      .from('solar_sites')
      .select('id, name, label, capacity_kwp, sort_order, solis_station_id')
      .order('sort_order', { ascending: true, nullsFirst: false })
    if (error) throw error
    return (data ?? []) as SolarSiteRow[]
  },
  staleTime: 10 * 60_000,
})
export const useSolarSites = () => useQuery(solarSitesQuery())

export function useSolarLatest() {
  return useQuery({
    queryKey: ['solar_latest'],
    queryFn: async () => {
      const { data, error } = await supabase.from('solar_latest').select('site_id, power_kw, today_kwh, year_kwh, state, reading_at')
      if (error) throw error
      return (data ?? []) as SolarLatestRow[]
    },
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  })
}

/** Every stored day of one year, all plants. About 1,800 rows a year for five plants, so paged. */
export const solarDailyQuery = (year: number) => ({
  queryKey: ['solar_daily', year],
  queryFn: () =>
    fetchAll<SolarDailyRow>((from, to) =>
      supabase
        .from('solar_daily')
        .select('site_id, day, produced_kwh')
        .gte('day', `${year}-01-01`)
        .lte('day', `${year}-12-31`)
        .order('day')
        .order('site_id')
        .range(from, to),
    ),
  staleTime: 10 * 60_000,
})
export const useSolarDaily = (year: number) => useQuery(solarDailyQuery(year))

/** The watchdog's row for the feed: has it ever worked, and what went wrong last. */
export function useSolarHealth() {
  return useQuery({
    // integration_health is LIVE_ONLY, so this is never restored from the device.
    queryKey: ['integration_health', 'solar_solis'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('integration_health')
        .select('status, detail, last_success_at, last_checked_at, enabled')
        .eq('source_key', 'solar_solis')
        .maybeSingle()
      if (error) throw error
      return data
    },
    staleTime: 60_000,
  })
}

/**
 * "Update now": starts solar-sync-background as the signed-in manager. A
 * background function answers 202 at once and does the work after, so the
 * screen re-reads a few times while it runs.
 */
export function useSolarRefresh() {
  const qc = useQueryClient()
  const [state, setState] = useState<string | null>(null)
  const refetch = () => {
    for (const key of [['solar_sites'], ['solar_latest'], ['solar_daily'], ['integration_health']]) void qc.invalidateQueries({ queryKey: key })
  }
  const start = async () => {
    setState('Asking SolisCloud…')
    const {
      data: { session },
    } = await supabase.auth.getSession()
    const r = await fetch('/.netlify/functions/solar-sync-background', {
      method: 'POST',
      headers: { Authorization: `Bearer ${session?.access_token ?? ''}`, 'content-type': 'application/json' },
      body: '{}',
    }).catch(() => null)
    if (!r || !(r.ok || r.status === 202)) {
      setState(`Couldn't start (${r?.status ?? 'no connection'})`)
      return
    }
    for (const ms of [10_000, 30_000, 75_000]) setTimeout(refetch, ms)
    setTimeout(() => setState(null), 76_000)
  }
  return { start, state, busy: state === 'Asking SolisCloud…' }
}
