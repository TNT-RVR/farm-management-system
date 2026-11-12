import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import type { Database } from './database.types'

export type FeedPlan = Database['public']['Tables']['feed_plans']['Row']

export const LB_PER_TONNE = 2204.62 // metric tonne
export const LB_PER_TON = 2000 // US short ton

/** One persisted winter-feed plan per ranch (seeded by migration, so it exists). */
export function useFeedPlan(ranchId: string | null | undefined) {
  return useQuery({
    queryKey: ['feed_plan', ranchId],
    enabled: Boolean(ranchId),
    queryFn: async (): Promise<FeedPlan> => {
      const { data, error } = await supabase
        .from('feed_plans')
        .select('*')
        .eq('ranch_id', ranchId!)
        .single()
      if (error) throw error
      return data
    },
  })
}

export function useSetFeedPlan() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      patch,
    }: {
      id: string
      patch: Database['public']['Tables']['feed_plans']['Update']
    }) => {
      const { error } = await supabase
        .from('feed_plans')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['feed_plan'] }),
  })
}

/**
 * Feeding days from recurring month/day endpoints. Uses a fixed non-leap
 * reference year, and wraps the end into the following year when it falls
 * before the start (winter feeding spans the New Year, e.g. Dec 1 â†’ Apr 15).
 */
export function feedDays(
  startMonth: number | null,
  startDay: number | null,
  endMonth: number | null,
  endDay: number | null,
): number {
  if (!startMonth || !startDay || !endMonth || !endDay) return 0
  const Y = 2001 // non-leap reference so Feb 29 never skews the count
  const start = new Date(Y, startMonth - 1, startDay)
  let end = new Date(Y, endMonth - 1, endDay)
  if (end.getTime() <= start.getTime()) end = new Date(Y + 1, endMonth - 1, endDay)
  return Math.round((end.getTime() - start.getTime()) / 86_400_000)
}

export type FeedRationRow = Database['public']['Tables']['feed_ration']['Row']

/** A ranch's winter ration: the share of dry matter each home-grown feed supplies. */
export function useFeedRation(ranchId: string | null | undefined) {
  return useQuery({
    queryKey: ['feed_ration', ranchId],
    enabled: Boolean(ranchId),
    queryFn: async (): Promise<FeedRationRow[]> => {
      const { data, error } = await supabase.from('feed_ration').select('*').eq('ranch_id', ranchId!).order('sort_order')
      if (error) throw error
      return data
    },
  })
}

/**
 * Edits to the ration. Any edit marks the plan's ration as the farm's own
 * (no longer the starting guess), and the rotation re-reads its feed acres.
 */
export function useFeedRationMutations(ranchId: string | null | undefined, planId: string | undefined) {
  const qc = useQueryClient()
  const done = async () => {
    if (planId) await supabase.from('feed_plans').update({ ration_confirmed: true }).eq('id', planId)
    void qc.invalidateQueries({ queryKey: ['feed_ration', ranchId] })
    void qc.invalidateQueries({ queryKey: ['feed_plan'] })
    void qc.invalidateQueries({ queryKey: ['rotation-context'] })
  }
  const setShare = useMutation({
    mutationFn: async ({ id, pct }: { id: string; pct: number }) => {
      const { error } = await supabase.from('feed_ration').update({ dm_share_pct: pct, updated_at: new Date().toISOString() }).eq('id', id)
      if (error) throw error
    },
    onSuccess: done,
  })
  const add = useMutation({
    mutationFn: async ({ cropId, sortOrder }: { cropId: string; sortOrder: number }) => {
      const { error } = await supabase.from('feed_ration').insert({ ranch_id: ranchId!, crop_id: cropId, dm_share_pct: 0, sort_order: sortOrder })
      if (error) throw error
    },
    onSuccess: done,
  })
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('feed_ration').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: done,
  })
  const confirm = useMutation({ mutationFn: async () => undefined, onSuccess: done })
  const setDryMatter = useMutation({
    mutationFn: async ({ cropId, pct }: { cropId: string; pct: number | null }) => {
      const { error } = await supabase.from('crops').update({ feed_dm_pct: pct }).eq('id', cropId)
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['crops'] })
      void qc.invalidateQueries({ queryKey: ['rotation-context'] })
    },
  })
  return { setShare, add, remove, confirm, setDryMatter }
}
