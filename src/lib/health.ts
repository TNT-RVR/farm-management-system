import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import type { Database } from './database.types'

export type HealthRow = Database['public']['Tables']['integration_health']['Row']
export type HealthStatus = 'ok' | 'stale' | 'error' | 'unknown'

/** All monitored feeds/jobs/integrations, refreshed every minute. */
export function useIntegrationHealth() {
  return useQuery({
    queryKey: ['integration_health'],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('integration_health')
        .select('*')
        .order('category')
        .order('source_key')
      if (error) throw error
      return data
    },
  })
}

export function useSetIntegrationHealth() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      patch,
    }: {
      id: string
      patch: Database['public']['Tables']['integration_health']['Update']
    }) => {
      const { error } = await supabase.from('integration_health').update(patch).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['integration_health'] }),
  })
}

/** Manager-triggered immediate health check (otherwise runs hourly on a schedule). */
export function useRunHealthCheck() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const res = await fetch('/api/integration-health', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token ?? ''}` },
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error((body as { error?: string }).error ?? 'Health check failed')
      return body as { checked: number; ran_at: string }
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['integration_health'] }),
  })
}

/** When the monitor itself last ran = the newest check across all sources. */
export function monitorLastRun(rows: HealthRow[] | undefined): string | null {
  let latest: number | null = null
  for (const r of rows ?? []) {
    if (r.last_checked_at) {
      const t = new Date(r.last_checked_at).getTime()
      if (latest == null || t > latest) latest = t
    }
  }
  return latest == null ? null : new Date(latest).toISOString()
}

/** The monitor is considered down if it hasn't run within `withinMin` (default ~2 h). */
export function monitorIsStale(lastRun: string | null, withinMin = 130): boolean {
  if (!lastRun) return true
  return (Date.now() - new Date(lastRun).getTime()) / 60000 > withinMin
}

export function relativeAge(iso: string | null): string {
  if (!iso) return 'never'
  const mins = (Date.now() - new Date(iso).getTime()) / 60000
  if (mins < 1) return 'just now'
  if (mins < 60) return `${Math.round(mins)} min ago`
  const hrs = mins / 60
  if (hrs < 48) return `${Math.round(hrs)} h ago`
  return `${Math.round(hrs / 24)} d ago`
}
