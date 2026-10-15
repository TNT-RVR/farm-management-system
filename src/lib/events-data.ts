import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import type { Database } from './database.types'
import type { FarmEvent } from './events'

export type EventRow = Database['public']['Tables']['events']['Row']

export function useEvents() {
  return useQuery({
    queryKey: ['events'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('events')
        .select('*')
        // Undated events sort last rather than first, which is where a nulls-
        // first default would put them.
        .order('starts_on', { ascending: true, nullsFirst: false })
      if (error) throw error
      return (data ?? []) as FarmEvent[]
    },
    staleTime: 5 * 60_000,
  })
}

export function useSaveEvent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (e: Database['public']['Tables']['events']['Insert']) => {
      const { error } = await supabase.from('events').insert(e)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['events'] }),
  })
}

export function useUpdateEvent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...patch }: { id: string } & Record<string, unknown>) => {
      const { error } = await supabase
        .from('events')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['events'] }),
  })
}

export function useDeleteEvent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('events').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['events'] }),
  })
}

/**
 * Ask for a fresh search now, rather than waiting for Monday.
 *
 * A Netlify background function: it answers 202 straight away and keeps working
 * for up to fifteen minutes, because a web search across a dozen event sites
 * takes far longer than an HTTP request should. So there is nothing to await —
 * the list is refetched a couple of times as results land.
 */
export function usePullEvents() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const res = await fetch('/api/events-pull-background', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token ?? ''}` },
      })
      if (res.status >= 400 && res.status !== 202)
        throw new Error(
          res.status === 501
            ? 'The search needs an ANTHROPIC_API_KEY set on the site before it can run.'
            : 'Could not start the search',
        )
    },
    onSuccess: () => {
      setTimeout(() => qc.invalidateQueries({ queryKey: ['events'] }), 45_000)
      setTimeout(() => qc.invalidateQueries({ queryKey: ['events'] }), 150_000)
    },
  })
}
