import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import type { Database } from './database.types'

export type GrainMovementRow = Database['public']['Tables']['grain_movements']['Row']
export type GrainMovementType = GrainMovementRow['movement_type']
export type BinOnhandRow = Database['public']['Views']['bin_grain_onhand']['Row']
export type InputItemRow = Database['public']['Tables']['input_items']['Row']
export type InputMovementRow = Database['public']['Tables']['input_movements']['Row']
export type InputMovementType = InputMovementRow['movement_type']
export type InputOnhandRow = Database['public']['Views']['input_onhand']['Row']

export const GRAIN_MOVEMENT_TYPES: { value: GrainMovementType; label: string; inflow: boolean }[] = [
  { value: 'harvest_in', label: 'Harvest in', inflow: true },
  { value: 'transfer_in', label: 'Transfer in', inflow: true },
  { value: 'transfer_out', label: 'Transfer out', inflow: false },
  { value: 'delivery_out', label: 'Delivery out', inflow: false },
  { value: 'shrink', label: 'Shrink', inflow: false },
  { value: 'adjustment', label: 'Adjustment (±)', inflow: true },
]

export const INPUT_MOVEMENT_TYPES: { value: InputMovementType; label: string }[] = [
  { value: 'purchase', label: 'Purchase' },
  { value: 'use', label: 'Use' },
  { value: 'adjustment', label: 'Adjustment (±)' },
]

export function useGrainMovements(cropYear: number) {
  return useQuery({
    queryKey: ['grain_movements', cropYear],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('grain_movements')
        .select('*')
        .eq('crop_year', cropYear)
        .order('moved_at', { ascending: false })
      if (error) throw error
      return data
    },
  })
}

export function useBinOnhand() {
  return useQuery({
    queryKey: ['bin_grain_onhand'],
    queryFn: async () => {
      const { data, error } = await supabase.from('bin_grain_onhand').select('*')
      if (error) throw error
      return data
    },
  })
}

/** Every screen that reads a bin's movements or what they add up to. */
function refreshMovements(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: ['grain_movements'] })
  void queryClient.invalidateQueries({ queryKey: ['bin_grain_onhand'] })
  void queryClient.invalidateQueries({ queryKey: ['bins', 'onhand'] })
  void queryClient.invalidateQueries({ queryKey: ['bin_detail'] })
}

export function useGrainMovementMutations(cropYear: number) {
  const queryClient = useQueryClient()
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['grain_movements', cropYear] })
    refreshMovements(queryClient)
  }
  const create = useMutation({
    mutationFn: async (m: Database['public']['Tables']['grain_movements']['Insert']) => {
      const { error } = await supabase.from('grain_movements').insert(m)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('grain_movements').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
  return { create, remove }
}

/** Movements that could be the other half of a transfer, for findTransferPartner. */
export function useTransferCandidates(m: GrainMovementRow | null) {
  const isTransfer = !!m && (m.movement_type === 'transfer_in' || m.movement_type === 'transfer_out')
  return useQuery({
    queryKey: ['grain_movements', 'transfer-of', m?.id],
    enabled: isTransfer,
    queryFn: () => transferCandidates(m!),
    staleTime: 30_000,
  })
}

async function transferCandidates(m: GrainMovementRow): Promise<GrainMovementRow[]> {
  const { data, error } = await supabase
    .from('grain_movements')
    .select('*')
    .eq('movement_type', m.movement_type === 'transfer_in' ? 'transfer_out' : 'transfer_in')
    .eq('moved_at', m.moved_at)
    .eq('bushels', m.bushels)
    .neq('bin_id', m.bin_id)
  if (error) throw error
  return data ?? []
}

/**
 * Correct or delete a movement by hand (Sam, 7 Oct 2026). Which movements
 * may be changed, and how, is movementSource in record-edits: a load's mirror
 * is changed at the load, a transfer as both its halves, anything else
 * directly. `partnerId` is the other half of a transfer, when there is one.
 *
 * A harvest-in edit can change a field's scale yield (the field_yield trigger),
 * so the yield screens are read again too.
 */
export function useEditGrainMovement(onYield?: () => void) {
  const queryClient = useQueryClient()
  const done = () => {
    refreshMovements(queryClient)
    onYield?.()
  }
  const update = useMutation({
    mutationFn: async ({
      id,
      partnerId,
      patch,
    }: {
      id: string
      partnerId?: string | null
      patch: Database['public']['Tables']['grain_movements']['Update']
    }) => {
      const { error } = await supabase.from('grain_movements').update(patch).eq('id', id)
      if (error) throw error
      if (partnerId) {
        // Only what the two halves share; the partner keeps its own bin and direction.
        const shared = { bushels: patch.bushels, moved_at: patch.moved_at, notes: patch.notes }
        const { error: e2 } = await supabase.from('grain_movements').update(shared).eq('id', partnerId)
        if (e2) throw new Error(`${e2.message}. The other bin's half of the move was not changed — check it.`)
      }
    },
    onSuccess: done,
  })
  const remove = useMutation({
    mutationFn: async ({ id, partnerId }: { id: string; partnerId?: string | null }) => {
      const ids = partnerId ? [id, partnerId] : [id]
      const { error } = await supabase.from('grain_movements').delete().in('id', ids)
      if (error) throw error
    },
    onSuccess: done,
  })
  return { update, remove }
}

export function useInputItems() {
  return useQuery({
    queryKey: ['input_items'],
    queryFn: async () => {
      const { data, error } = await supabase.from('input_items').select('*').order('name')
      if (error) throw error
      return data
    },
  })
}

export function useInputOnhand() {
  return useQuery({
    queryKey: ['input_onhand'],
    queryFn: async () => {
      const { data, error } = await supabase.from('input_onhand').select('*')
      if (error) throw error
      return data
    },
  })
}

export function useInputMovements(itemId: string | undefined) {
  return useQuery({
    queryKey: ['input_movements', itemId],
    enabled: Boolean(itemId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('input_movements')
        .select('*')
        .eq('input_item_id', itemId!)
        .order('moved_at', { ascending: false })
      if (error) throw error
      return data
    },
  })
}

export function useInputMutations() {
  const queryClient = useQueryClient()
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['input_items'] })
    void queryClient.invalidateQueries({ queryKey: ['input_onhand'] })
    void queryClient.invalidateQueries({ queryKey: ['input_movements'] })
  }
  const createItem = useMutation({
    mutationFn: async (i: Database['public']['Tables']['input_items']['Insert']) => {
      const { data, error } = await supabase.from('input_items').insert(i).select('id').single()
      if (error) throw error
      return data.id
    },
    onSuccess: invalidate,
  })
  const removeItem = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('input_items').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
  const addMovement = useMutation({
    mutationFn: async (m: Database['public']['Tables']['input_movements']['Insert']) => {
      const { error } = await supabase.from('input_movements').insert(m)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
  return { createItem, removeItem, addMovement }
}
