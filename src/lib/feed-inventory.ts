import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import type { Database } from './database.types'

export type FeedInventoryRow = Database['public']['Tables']['feed_inventory']['Row']
export type FeedInventoryKind = FeedInventoryRow['kind']

/**
 * What is left of each feed, after the cattle have eaten.
 *
 * Two halves that used to be one. The feeding side was already recorded on the
 * feed sheets; what was missing was what got put up in the first place, so the
 * app could say what had been eaten and not what remained — and "how much green
 * feed is left" is the question that decides whether to buy in February or in
 * April.
 *
 * EVERYTHING IN POUNDS, because a pile counted in rounds and fed out in pounds
 * cannot be subtracted otherwise. A bale with no weight recorded is NOT counted
 * as zero — it lands in `unweighedLines`, so a missing bale weight reads as a
 * gap rather than quietly shrinking the pile, which would make this number
 * worse than no number at all.
 */
export type FeedOnHand = {
  ranch_id: string
  feed_type_id: string
  feed_name: string
  default_unit: 'lb' | 'big_square' | 'round'
  default_lb_per_bale: number | null
  is_bedding: boolean
  put_up_lb: number
  fed_lb: number
  remaining_lb: number
  unweighed_lines: number
}

export function feedOnHandQuery(ranchId: string | null) {
  return {
    queryKey: ['feed_on_hand', ranchId],
    queryFn: async (): Promise<FeedOnHand[]> => {
      let q = supabase.from('feed_on_hand').select('*')
      if (ranchId) q = q.eq('ranch_id', ranchId)
      const { data, error } = await q
      if (error) throw error
      const num = (v: unknown) => (v == null ? 0 : Number(v))
      return (data ?? [])
        .map((r) => {
          const row = r as unknown as Record<string, unknown>
          return {
            ranch_id: String(row.ranch_id),
            feed_type_id: String(row.feed_type_id),
            feed_name: String(row.feed_name),
            default_unit: row.default_unit as FeedOnHand['default_unit'],
            default_lb_per_bale:
              row.default_lb_per_bale == null ? null : Number(row.default_lb_per_bale),
            is_bedding: Boolean(row.is_bedding),
            put_up_lb: num(row.put_up_lb),
            fed_lb: num(row.fed_lb),
            remaining_lb: num(row.remaining_lb),
            unweighed_lines: num(row.unweighed_lines),
          }
        })
        .sort((a, b) => b.fed_lb - a.fed_lb || a.feed_name.localeCompare(b.feed_name))
    },
  }
}

export function useFeedOnHand(ranchId: string | null) {
  return useQuery(feedOnHandQuery(ranchId))
}

export function useFeedInventory(ranchId: string | null) {
  return useQuery({
    queryKey: ['feed_inventory', ranchId],
    queryFn: async (): Promise<FeedInventoryRow[]> => {
      let q = supabase.from('feed_inventory').select('*').order('moved_on', { ascending: false })
      if (ranchId) q = q.eq('ranch_id', ranchId)
      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as unknown as FeedInventoryRow[]
    },
  })
}

export function useSaveFeedInventory() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: Database['public']['Tables']['feed_inventory']['Insert']) => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      const { error } = await supabase
        .from('feed_inventory')
        .insert({ ...v, updated_by: user?.id ?? null })
      if (error) {
        // The table refuses a purchase that reduces the pile, which is a typo
        // rather than a purchase. Said in words rather than as a constraint name.
        if ((error as { code?: string }).code === '23514') {
          throw new Error(
            'That amount goes the wrong way for what it is — feed put up or bought should be positive, sold or spoiled negative.',
          )
        }
        throw error
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['feed_inventory'] })
      void qc.invalidateQueries({ queryKey: ['feed_on_hand'] })
    },
  })
}

/** Correct one ledger entry (Sam, 7 Oct 2026: counts get edit and delete). */
export function useUpdateFeedInventory() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Database['public']['Tables']['feed_inventory']['Update'] }) => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      const { error } = await supabase
        .from('feed_inventory')
        .update({ ...patch, updated_at: new Date().toISOString(), updated_by: user?.id ?? null })
        .eq('id', id)
      if (error) {
        if ((error as { code?: string }).code === '23514') {
          throw new Error('That amount goes the wrong way for what it is — feed put up or bought should be positive, sold or spoiled negative.')
        }
        throw error
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['feed_inventory'] })
      void qc.invalidateQueries({ queryKey: ['feed_on_hand'] })
    },
  })
}

/**
 * The stored quantity for an entry: the sign follows the kind, so a sale is
 * typed as 30 and saved as -30. A correction keeps whatever sign was typed.
 */
export function signedQuantity(kind: FeedInventoryKind, typed: number): number {
  const sign = KIND_SIGN[kind]
  return sign === 0 ? typed : Math.abs(typed) * sign
}

export function useDeleteFeedInventory() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('feed_inventory').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['feed_inventory'] })
      void qc.invalidateQueries({ queryKey: ['feed_on_hand'] })
    },
  })
}

export const KIND_LABEL: Record<FeedInventoryKind, string> = {
  opening: 'Counted on hand',
  harvested: 'Put up',
  purchased: 'Bought',
  sold: 'Sold',
  shrink: 'Spoiled or wasted',
  adjustment: 'Correction',
}

/** Which direction each kind moves the pile, so the form can say so. */
export const KIND_SIGN: Record<FeedInventoryKind, 1 | -1 | 0> = {
  opening: 1,
  harvested: 1,
  purchased: 1,
  sold: -1,
  shrink: -1,
  adjustment: 0,
}

/**
 * Pounds as the yard counts them: bales where the feed is baled, pounds where
 * it is not.
 *
 * Returns null for a bale with no weight, rather than a bale count computed
 * from a weight nobody recorded.
 */
export function inNaturalUnits(f: FeedOnHand, lb: number): string | null {
  if (f.default_unit === 'lb') return `${Math.round(lb).toLocaleString('en-CA')} lb`
  if (!f.default_lb_per_bale) return null
  const bales = lb / f.default_lb_per_bale
  const word = f.default_unit === 'round' ? 'round' : 'big square'
  const n = Math.round(bales * 10) / 10
  return `${n.toLocaleString('en-CA')} ${word}${Math.abs(n) === 1 ? '' : 's'}`
}

/**
 * How long the remaining feed lasts at the rate it has been going out.
 *
 * Measured against what this feed has ACTUALLY been fed at rather than a ration
 * on paper, because the sheets are the only record of what really went in the
 * bunk. Null where nothing has been fed yet — a rate of zero divides into
 * anything and would report a pile lasting forever.
 */
export function daysOfFeedLeft(remainingLb: number, fedLb: number, daysFed: number): number | null {
  if (daysFed <= 0 || fedLb <= 0 || remainingLb <= 0) return null
  return Math.round(remainingLb / (fedLb / daysFed))
}
