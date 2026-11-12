import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import type { Database } from './database.types'
import { pairKey, type LeaseLimit } from './grazing-plan'
import { loadDispositions } from './grazing-leases-data'
import { rebuildBands } from './cattle-water'

// The grazing planner's reads and writes. The arithmetic is in grazing-plan.ts.

export type PlanRow = Database['public']['Tables']['grazing_plan']['Row']
export type PlanInsert = Database['public']['Tables']['grazing_plan']['Insert']
export type PlanPatch = Database['public']['Tables']['grazing_plan']['Update']
export type GateRow = Database['public']['Tables']['pasture_gates']['Row']

const PLAN_KEY = 'grazing_plan'

/** Every planned stay for a ranch and year, all groups, in plan order. */
export function useGrazingPlan(ranchId: string | null | undefined, year: number) {
  return useQuery({
    queryKey: [PLAN_KEY, ranchId, year],
    enabled: Boolean(ranchId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('grazing_plan')
        .select('*')
        .eq('ranch_id', ranchId!)
        .eq('plan_year', year)
        .order('sort_order')
        .order('start_date')
      if (error) throw error
      return data as PlanRow[]
    },
  })
}

export function usePlanMutations() {
  const qc = useQueryClient()
  const invalidate = () => void qc.invalidateQueries({ queryKey: [PLAN_KEY] })
  const add = useMutation({
    mutationFn: async (rows: PlanInsert[]) => {
      if (!rows.length) return
      const { error } = await supabase.from('grazing_plan').insert(rows)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
  /** Several rows at once: a cascade or a reorder touches every later stay. */
  const update = useMutation({
    mutationFn: async (changes: { id: string; patch: PlanPatch }[]) => {
      const now = new Date().toISOString()
      const results = await Promise.all(
        changes.map((c) => supabase.from('grazing_plan').update({ ...c.patch, updated_at: now }).eq('id', c.id)),
      )
      const bad = results.find((r) => r.error)
      if (bad?.error) throw bad.error
    },
    onSuccess: invalidate,
  })
  const remove = useMutation({
    mutationFn: async (ids: string[]) => {
      if (!ids.length) return
      const { error } = await supabase.from('grazing_plan').delete().in('id', ids)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
  return { add, update, remove }
}

/** Every recorded gate, keyed by pair. */
export function usePastureGates() {
  return useQuery({
    queryKey: ['pasture_gates'],
    queryFn: async () => {
      const { data, error } = await supabase.from('pasture_gates').select('*')
      if (error) throw error
      return data as GateRow[]
    },
    staleTime: 10 * 60_000,
  })
}

export function useGateMutations() {
  const qc = useQueryClient()
  const invalidate = () => void qc.invalidateQueries({ queryKey: ['pasture_gates'] })
  const add = useMutation({
    mutationFn: async ({ a, b, at, note }: { a: string; b: string; at?: [number, number] | null; note?: string | null }) => {
      const [pa, pb] = a < b ? [a, b] : [b, a]
      const { error } = await supabase.from('pasture_gates').upsert(
        {
          pasture_a: pa,
          pasture_b: pb,
          gate_geom: at ? `SRID=4326;POINT(${at[0]} ${at[1]})` : null,
          note: note ?? null,
          source: 'manual',
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'pasture_a,pasture_b' },
      )
      if (error) throw error
    },
    onSuccess: invalidate,
  })
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('pasture_gates').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
  return { add, remove }
}

/**
 * Opening and shutting gates, one or all of them.
 *
 * A gate's state is not bookkeeping: an open gate carries the neighbouring
 * paddock's water through it, so every toggle changes the distance-from-water
 * shading. The bands are prebuilt, and a database trigger marks both paddocks
 * stale, so each toggle has to ask for a rebuild before the map will agree
 * with it — several rounds for a ranch-wide toggle, which can dirty more
 * paddocks than one rebuild call will take.
 */
export function useGateOpenMutations() {
  const qc = useQueryClient()
  const refresh = async (rounds: number) => {
    await rebuildBands(rounds)
    for (const k of ['pasture_gates', 'water-reach', 'water-reach-acres'])
      void qc.invalidateQueries({ queryKey: [k] })
  }
  const setOne = useMutation({
    mutationFn: async ({ id, open }: { id: string; open: boolean }) => {
      const { error } = await supabase
        .from('pasture_gates')
        .update({ is_open: open, updated_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => refresh(1),
  })
  const setAll = useMutation({
    mutationFn: async ({ open, ranchId }: { open: boolean; ranchId?: string | null }) => {
      const { data, error } = await supabase.rpc('set_gates_open', {
        p_open: open,
        p_ranch: ranchId ?? undefined,
      })
      if (error) throw error
      return Number(data ?? 0)
    },
    // Every paddock on the ranch can go stale at once; six a round.
    onSuccess: () => refresh(6),
  })
  return { setOne, setAll }
}

/** Each pasture's minimum rest between grazings, days. */
export function usePastureRest() {
  return useQuery({
    queryKey: ['pastures', 'min_rest_days'],
    queryFn: async () => {
      const { data, error } = await supabase.from('pastures').select('id, min_rest_days')
      if (error) throw error
      return new Map((data ?? []).map((r) => [r.id as string, (r.min_rest_days as number | null) ?? 0]))
    },
    staleTime: 10 * 60_000,
  })
}

/** Pasture pairs that share a fence, as pair keys. */
export function usePastureNeighbours() {
  return useQuery({
    queryKey: ['pasture_adjacency'],
    queryFn: async () => {
      const { data, error } = await supabase.from('pasture_adjacency').select('pasture_a, pasture_b')
      if (error) throw error
      return new Set((data ?? []).map((r) => pairKey(r.pasture_a, r.pasture_b)))
    },
    staleTime: 30 * 60_000,
  })
}

/** The ranch's leases, as the limits the planner checks against. */
export function useLeaseLimits(ranchId: string | null | undefined) {
  return useQuery({
    queryKey: ['grazing_dispositions', 'limits', ranchId],
    enabled: Boolean(ranchId),
    queryFn: async (): Promise<LeaseLimit[]> => {
      const all = await loadDispositions()
      return all
        .filter((d) => d.active && d.ranch_id === ranchId)
        .map((d) => ({
          id: d.id,
          disposition_no: d.disposition_no,
          pasture_ids: d.pasture_ids,
          max_grazing_days: d.max_grazing_days ?? null,
          capacity_aum: d.capacity_aum,
          billable_aum: d.billable_aum,
          season_start_md: d.season_start_md ?? null,
          season_end_md: d.season_end_md ?? null,
        }))
    },
  })
}

export type ActualRow = {
  pasture_id: string
  turned_in_on: string
  moved_out_on: string | null
  head_count: number | null
  avg_animal_weight_lb: number | null
  mob: string | null
}

/** The year's recorded stays (collar imports and hand entries), with the mob they were. */
export function useActualGrazing(year: number) {
  return useQuery({
    queryKey: ['grazing_events', 'plan', year],
    queryFn: async (): Promise<ActualRow[]> => {
      const { data, error } = await supabase
        .from('grazing_events')
        .select('pasture_id, turned_in_on, moved_out_on, head_count, avg_animal_weight_lb, eshepherd_activations(mob)')
        .gte('turned_in_on', `${year}-01-01`)
        .lte('turned_in_on', `${year}-12-31`)
        .order('turned_in_on')
      if (error) throw error
      return ((data ?? []) as unknown as (Omit<ActualRow, 'mob'> & { eshepherd_activations: { mob: string | null } | null })[]).map((r) => ({
        pasture_id: r.pasture_id,
        turned_in_on: r.turned_in_on,
        moved_out_on: r.moved_out_on,
        head_count: r.head_count,
        avg_animal_weight_lb: r.avg_animal_weight_lb == null ? null : Number(r.avg_animal_weight_lb),
        mob: r.eshepherd_activations?.mob ?? null,
      }))
    },
  })
}
