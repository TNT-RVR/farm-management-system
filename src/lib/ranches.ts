import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useFarmSettings } from './farm-setup'
import { supabase } from './supabase'
import type { Database } from './database.types'

export type Ranch = Database['public']['Tables']['ranches']['Row']

/** The ranches the Cattle section is scoped by (Home Ranch, East Ranch). */
export function ranchesQuery() {
  return {
    queryKey: ['ranches'],
    queryFn: async () => {
      const { data, error } = await supabase.from('ranches').select('*').order('sort_order')
      if (error) throw error
      return data
    },
  }
}

export function useRanches() {
  return useQuery(ranchesQuery())
}

/** The farm's main ranch: the one farm setup names, else the first by sort order. */
export function useMainRanch() {
  const { data } = useRanches()
  const { mainRanchId } = useFarmSettings()
  return useMemo(() => {
    const list = [...(data ?? [])].sort((a, b) => a.sort_order - b.sort_order)
    return list.find((r) => r.id === mainRanchId) ?? list[0] ?? null
  }, [data, mainRanchId])
}

/** Patch any ranch column (grazing knobs, coordinates, precip config). */
export function useSetRanch() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      patch,
    }: {
      id: string
      patch: Database['public']['Tables']['ranches']['Update']
    }) => {
      const { error } = await supabase.from('ranches').update(patch).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['ranches'] })
      void qc.invalidateQueries({ queryKey: ['grazing_settings'] })
    },
  })
}

/**
 * Add a ranch. A farm installed from the shared copy starts with none, and
 * every Cattle route is scoped by ranch, so this is the first thing the Cattle
 * section asks for. New ranches go to the end of the sort order so adding a
 * second one never reshuffles the picker a farm is already used to.
 */
export function useAddRanch() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      name,
      latitude,
      longitude,
    }: {
      name: string
      latitude?: number | null
      longitude?: number | null
    }) => {
      const { data: last, error: readErr } = await supabase
        .from('ranches')
        .select('sort_order')
        .order('sort_order', { ascending: false })
        .limit(1)
      if (readErr) throw readErr
      const sort_order = (last?.[0]?.sort_order ?? -1) + 1
      const { error } = await supabase
        .from('ranches')
        .insert({ name, sort_order, latitude: latitude ?? null, longitude: longitude ?? null })
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['ranches'] })
    },
  })
}
