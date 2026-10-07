import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import type { Database } from './database.types'

export type CattleRow = Database['public']['Tables']['cattle']['Row']
export type CattleSex = NonNullable<CattleRow['sex']>
export type CattleStatus = CattleRow['status']
export type CattleGroupRow = Database['public']['Tables']['cattle_groups']['Row']
export type CattleEventRow = Database['public']['Tables']['cattle_events']['Row']
export type CattleEventType = CattleEventRow['event_type']

export const CATTLE_SEXES: CattleSex[] = ['cow', 'bull', 'steer', 'heifer', 'calf']
export const CATTLE_STATUSES: CattleStatus[] = ['active', 'sold', 'died', 'culled']
export const CATTLE_EVENT_TYPES: CattleEventType[] = [
  'calving',
  'vaccination',
  'treatment',
  'weight',
  'movement',
  'breeding',
  'preg_check',
  'weaning',
  'branding',
  'sale',
  'death',
  'other',
]

export function ageFromBirth(birth: string | null): string {
  if (!birth) return '—'
  const days = Math.floor((Date.now() - new Date(birth).getTime()) / 86400000)
  if (days < 0) return '—'
  if (days < 60) return `${days}d`
  const months = Math.floor(days / 30.4)
  if (months < 24) return `${months}mo`
  return `${Math.floor(days / 365.25)}y`
}

/** Animals, optionally scoped to one ranch (omit ranchId for every ranch). */
export function cattleQuery(ranchId?: string | null) {
  return {
    queryKey: ['cattle', ranchId ?? 'all'],
    queryFn: async () => {
      let q = supabase.from('cattle').select('*').order('tag', { nullsFirst: false })
      if (ranchId) q = q.eq('ranch_id', ranchId)
      const { data, error } = await q
      if (error) throw error
      return data
    },
  }
}

export function useCattle(ranchId?: string | null) {
  return useQuery(cattleQuery(ranchId))
}

/** Herds/groups, optionally scoped to one ranch. */
export function useCattleGroups(ranchId?: string | null) {
  return useQuery({
    queryKey: ['cattle_groups', ranchId ?? 'all'],
    queryFn: async () => {
      let q = supabase.from('cattle_groups').select('*').order('name')
      if (ranchId) q = q.eq('ranch_id', ranchId)
      const { data, error } = await q
      if (error) throw error
      return data
    },
  })
}

export function useCattleEvents(cattleId: string | undefined) {
  return useQuery({
    queryKey: ['cattle_events', cattleId],
    enabled: Boolean(cattleId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cattle_events')
        .select('*')
        .eq('cattle_id', cattleId!)
        .order('event_date', { ascending: false })
      if (error) throw error
      return data
    },
  })
}

export function useRecentCattleEvents() {
  return useQuery({
    queryKey: ['cattle_events', 'recent'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cattle_events')
        .select('*')
        .order('event_date', { ascending: false })
        .limit(50)
      if (error) throw error
      return data
    },
  })
}

export function useCattleMutations() {
  const queryClient = useQueryClient()
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['cattle'] })
  const create = useMutation({
    mutationFn: async (c: Database['public']['Tables']['cattle']['Insert']) => {
      const { data, error } = await supabase.from('cattle').insert(c).select('id').single()
      if (error) throw error
      return data.id
    },
    onSuccess: invalidate,
  })
  const update = useMutation({
    mutationFn: async ({
      id,
      patch,
    }: {
      id: string
      patch: Database['public']['Tables']['cattle']['Update']
    }) => {
      const { error } = await supabase.from('cattle').update(patch).eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('cattle').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
  return { create, update, remove }
}

export function useCattleGroupMutations() {
  const queryClient = useQueryClient()
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['cattle_groups'] })
  const create = useMutation({
    mutationFn: async (g: Database['public']['Tables']['cattle_groups']['Insert']) => {
      const { error } = await supabase.from('cattle_groups').insert(g)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
  const update = useMutation({
    mutationFn: async ({
      id,
      patch,
    }: {
      id: string
      patch: Database['public']['Tables']['cattle_groups']['Update']
    }) => {
      const { error } = await supabase.from('cattle_groups').update(patch).eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('cattle_groups').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
  return { create, update, remove }
}

export function useCattleEventMutations() {
  const queryClient = useQueryClient()
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['cattle_events'] })
  const create = useMutation({
    mutationFn: async (e: Database['public']['Tables']['cattle_events']['Insert']) => {
      const { data: auth } = await supabase.auth.getUser()
      const { error } = await supabase.from('cattle_events').insert({ ...e, created_by: auth.user!.id })
      if (error) throw error
    },
    onSuccess: invalidate,
  })
  // Managers only, by the table's update policy: a logged event is corrected
  // rather than deleted and logged again (Sam, 7 Oct 2026).
  const update = useMutation({
    mutationFn: async ({
      id,
      patch,
    }: {
      id: string
      patch: Database['public']['Tables']['cattle_events']['Update']
    }) => {
      const { error } = await supabase.from('cattle_events').update(patch).eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('cattle_events').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
  return { create, update, remove }
}

/** Plain words for an animal's sex/class, status and an event type ("preg_check" → "preg check"). */
export const cattleWord = (s: string | null | undefined) => (s ? s.replace(/_/g, ' ') : '—')

/**
 * The animals list on the Herd page: search by tag, name, breed or group, and
 * sold/died/culled animals left out unless asked for. Tags sort as numbers
 * where they are numbers ("9" before "10"), which is how an ear tag is read.
 */
export function filterAnimals<T extends Pick<CattleRow, 'tag' | 'name' | 'breed' | 'status' | 'group_id'>>(
  rows: T[],
  opts: { search?: string; showGone?: boolean; groupName?: (id: string | null) => string },
): T[] {
  const q = (opts.search ?? '').trim().toLowerCase()
  const out = rows.filter((r) => {
    if (!opts.showGone && r.status !== 'active') return false
    if (!q) return true
    const hay = [r.tag, r.name, r.breed, opts.groupName?.(r.group_id)].filter(Boolean).join(' ').toLowerCase()
    return hay.includes(q)
  })
  return out.sort((a, b) => {
    if (a.tag == null && b.tag == null) return (a.name ?? '').localeCompare(b.name ?? '')
    if (a.tag == null) return 1
    if (b.tag == null) return -1
    return a.tag.localeCompare(b.tag, 'en-CA', { numeric: true })
  })
}

// ---- ranches: rename and delete (Sam, 7 Oct 2026) -------------------------

/** What a ranch still holds, for deciding whether it can be deleted. */
export type RanchUse = {
  animals: number
  herdCounts: number
  feedRecords: number
  feedInventory: number
  pastures: number
  sales: number
}

/**
 * Why a ranch cannot be deleted, in words, or an empty list when it can.
 * Deleting a ranch CASCADES to its head counts, feed sheets, yard ledger and
 * rations, and leaves its animals and pastures without a ranch — so anything
 * that is a record of the farm blocks it, and the person is told what to move
 * or remove first rather than losing a winter of feed sheets to one click.
 */
export function ranchDeleteBlockers(use: RanchUse): string[] {
  const n = (k: number, one: string, many = `${one}s`) => `${k.toLocaleString('en-CA')} ${k === 1 ? one : many}`
  const out: string[] = []
  if (use.animals) out.push(n(use.animals, 'tagged animal'))
  if (use.herdCounts) out.push(n(use.herdCounts, 'head-count group'))
  if (use.feedRecords) out.push(n(use.feedRecords, 'feed record'))
  if (use.feedInventory) out.push(n(use.feedInventory, 'feed yard entry', 'feed yard entries'))
  if (use.pastures) out.push(n(use.pastures, 'pasture'))
  if (use.sales) out.push(n(use.sales, 'recorded sale'))
  return out
}

export async function loadRanchUse(ranch: { id: string; name: string }): Promise<RanchUse> {
  const byId = async (table: 'cattle' | 'herd_counts' | 'feed_records' | 'feed_inventory' | 'grazing_pastures') => {
    const { count, error } = await supabase.from(table).select('id', { count: 'exact', head: true }).eq('ranch_id', ranch.id)
    if (error) throw error
    return count ?? 0
  }
  const { count: sales, error } = await supabase.from('cattle_sales').select('id', { count: 'exact', head: true }).eq('ranch', ranch.name)
  if (error) throw error
  const [animals, herdCounts, feedRecords, feedInventory, pastures] = await Promise.all([
    byId('cattle'),
    byId('herd_counts'),
    byId('feed_records'),
    byId('feed_inventory'),
    byId('grazing_pastures'),
  ])
  return { animals, herdCounts, feedRecords, feedInventory, pastures, sales: sales ?? 0 }
}

/**
 * Rename a ranch, and its place in the two tables that hold the ranch by name
 * (sales and cow costs) so their history stays with it. Not one transaction:
 * if the second step fails the error says so and the rename can be run again.
 */
export function useEditRanch() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      oldName,
      patch,
    }: {
      id: string
      oldName: string
      patch: { name: string; latitude: number | null; longitude: number | null }
    }) => {
      const { error } = await supabase.from('ranches').update(patch).eq('id', id)
      if (error) throw error
      if (patch.name !== oldName) {
        for (const table of ['cattle_sales', 'cattle_cost_assumptions'] as const) {
          const { error: e } = await supabase.from(table).update({ ranch: patch.name }).eq('ranch', oldName)
          if (e) throw new Error(`Renamed, but ${table === 'cattle_sales' ? 'the recorded sales' : 'the cow costs'} still say "${oldName}": ${e.message}`)
        }
      }
    },
    onSuccess: () => {
      for (const k of ['ranches', 'cattle-sales', 'cattle-costs', 'grazing_settings']) void qc.invalidateQueries({ queryKey: [k] })
    },
  })
}

export function useDeleteRanch() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('ranches').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['ranches'] }),
  })
}

// ---- herd counts (plain head-per-class inventory, per ranch) ----------------
export type HerdCountRow = Database['public']['Tables']['herd_counts']['Row']

/**
 * Herd counts for one ranch, or for every ranch when `ranchId` is empty.
 *
 * The empty string is the "All" selection rather than "not loaded yet" —
 * undefined still means the picker has not resolved, and the query stays off
 * for that. Conflating the two would show an empty herd for a moment on every
 * load, which reads as a herd that has been sold.
 */
export function useHerdCounts(ranchId: string | undefined) {
  const allRanches = ranchId === ''
  return useQuery({
    queryKey: ['herd_counts', ranchId ?? 'unset'],
    enabled: ranchId !== undefined,
    queryFn: async () => {
      let q = supabase.from('herd_counts').select('*')
      if (!allRanches) q = q.eq('ranch_id', ranchId!)
      const { data, error } = await q
        .order('sort_order')
      if (error) throw error
      return data
    },
  })
}

export function useHerdCountMutations(ranchId: string | undefined) {
  const queryClient = useQueryClient()
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['herd_counts', ranchId] })
  const add = useMutation({
    mutationFn: async ({ class_name, head_count }: { class_name: string; head_count: number }) => {
      const { error } = await supabase
        .from('herd_counts')
        .insert({ ranch_id: ranchId!, class_name, head_count, sort_order: 99 })
      if (error) throw error
    },
    onSuccess: invalidate,
  })
  const update = useMutation({
    mutationFn: async ({
      id,
      patch,
    }: {
      id: string
      patch: Database['public']['Tables']['herd_counts']['Update']
    }) => {
      const { error } = await supabase
        .from('herd_counts')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('herd_counts').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
  return { add, update, remove }
}
