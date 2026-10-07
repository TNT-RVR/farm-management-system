import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import type { Database } from './database.types'

export type IntegrationStatus = Database['public']['Views']['integration_status_v']['Row']
export type BinReadingRow = Database['public']['Tables']['bin_readings']['Row']

export type JdOrgOption = { id: string; name: string | null; needsConnection: boolean }

/** Organizations this John Deere login can see, and which one we sync. */
export function useJdOrgs(enabled: boolean) {
  return useQuery({
    queryKey: ['jd_orgs'],
    enabled,
    retry: false,
    queryFn: () =>
      authedFetch('/api/jd-orgs') as Promise<{
        orgs: JdOrgOption[]
        selectedId: string | null
        connectionsUrl: string | null
      }>,
  })
}

/** Choose which John Deere organization the sync pulls from. */
export function useSetJdOrg() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (orgId: string) =>
      authedFetch('/api/jd-orgs', { method: 'POST', body: JSON.stringify({ orgId }) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['integrations'] })
      void queryClient.invalidateQueries({ queryKey: ['jd_orgs'] })
    },
  })
}

/**
 * One-shot read-only probe of the live John Deere org, so the mapping work is
 * written against real payload shapes rather than assumptions.
 */
export function useJdExplore() {
  return useMutation({
    mutationFn: () =>
      authedFetch('/api/jd-explore') as Promise<{
        org: string
        summary: string[]
        probes: unknown[]
      }>,
  })
}

export function useIntegrations() {
  return useQuery({
    queryKey: ['integrations'],
    queryFn: async () => {
      const { data, error } = await supabase.from('integration_status_v').select('*')
      if (error) throw error
      return data
    },
  })
}

async function authedFetch(path: string, init?: RequestInit) {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const res = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session?.access_token ?? ''}`,
      ...(init?.headers ?? {}),
    },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`)
  return body
}

/** Start John Deere OAuth — returns the authorize URL to redirect to. */
/** `from: 'setup'` brings the sign-in back to Farm setup's keys card instead of Integrations. */
export async function jdConnect(from?: 'setup'): Promise<string> {
  const body = (await authedFetch(`/api/jd-connect${from ? `?from=${from}` : ''}`)) as { authorizeUrl: string }
  return body.authorizeUrl
}

export function useJdSync() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => authedFetch('/api/jd-sync', { method: 'POST' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['integrations'] })
      void queryClient.invalidateQueries({ queryKey: ['fields'] })
      void queryClient.invalidateQueries({ queryKey: ['boundaries'] })
    },
  })
}

export function useBinReadings(binId: string | undefined) {
  return useQuery({
    queryKey: ['bin_readings', binId],
    enabled: Boolean(binId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bin_readings')
        .select('*')
        .eq('bin_id', binId!)
        .order('reading_at', { ascending: false })
      if (error) throw error
      return data
    },
  })
}

export function useAddBinReading() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (rows: Database['public']['Tables']['bin_readings']['Insert'][]) => {
      const { data: auth } = await supabase.auth.getUser()
      const withUser = rows.map((r) => ({ ...r, created_by: auth.user!.id }))
      const { error } = await supabase.from('bin_readings').insert(withUser)
      if (error) throw error
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['bin_readings'] }),
  })
}
