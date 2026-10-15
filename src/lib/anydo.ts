import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { useAuth } from './auth'

/**
 * Each person's own Any.do link (migration 20261013160000). The row says
 * whether they are connected; the keys live server-side only.
 */
const db = supabase as unknown as SupabaseClient

export type AnydoConnection = {
  user_id: string
  status: 'pending' | 'connected' | 'error'
  connected_at: string | null
  last_sync_at: string | null
  last_error: string | null
  tools: { name?: string }[] | null
  list_name: string | null
  marker: string
}

async function authedFetch(path: string, init?: RequestInit) {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}`, ...(init?.headers ?? {}) },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`)
  return body
}

export function useMyAnydo() {
  const { profile } = useAuth()
  return useQuery({
    queryKey: ['anydo_connection', profile?.id],
    enabled: Boolean(profile?.id),
    queryFn: async (): Promise<AnydoConnection | null> => {
      const { data, error } = await db.from('anydo_connections').select('*').eq('user_id', profile!.id).maybeSingle()
      if (error) throw error
      return (data as AnydoConnection | null) ?? null
    },
  })
}

/** Any.do's sign-in address for the person at the keyboard (opened in a new tab). */
export async function anydoSignInUrl(): Promise<string> {
  const { authorizeUrl } = (await authedFetch('/api/anydo-connect')) as { authorizeUrl: string }
  return authorizeUrl
}

/**
 * Finish the link from the address Any.do sent the browser to. Any.do only
 * returns sign-ins to localhost, a page that does not load; its address
 * holds the one-time code.
 */
export function useAnydoFinish() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (url: string) => authedFetch('/api/anydo-finish', { method: 'POST', body: JSON.stringify({ url }) }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['anydo_connection'] }),
  })
}

export function useAnydoDisconnect() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => authedFetch('/api/anydo-disconnect', { method: 'POST' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['anydo_connection'] }),
  })
}

/** Sync this person now (the server also syncs everyone every 10 minutes). */
export function useAnydoSyncNow() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => authedFetch('/api/anydo-sync-background', { method: 'POST' }) as Promise<{ result?: { sent: number; received: number; ticked: number } }>,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['anydo_connection'] })
      void qc.invalidateQueries({ queryKey: ['tasks'] })
    },
  })
}
