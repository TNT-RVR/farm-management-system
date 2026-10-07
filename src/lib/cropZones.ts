import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { MultiPolygon } from 'geojson'
import { supabase } from './supabase'
import type { Database, Json } from './database.types'

export type CropZoneRow = Database['public']['Tables']['field_crop_zones']['Row']

/** Crop zones for one field in one year. */
export function useFieldCropZones(fieldId: string | null | undefined, cropYear: number) {
  return useQuery({
    queryKey: ['field_crop_zones', fieldId, cropYear],
    enabled: Boolean(fieldId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('field_crop_zones')
        .select('*')
        .eq('field_id', fieldId!)
        .eq('crop_year', cropYear)
        .order('created_at')
      if (error) throw error
      return data
    },
  })
}

/** All crop zones (small table) — used for map overlays + rotation totals. */
export function allCropZonesQuery() {
  return {
    queryKey: ['field_crop_zones', 'all'],
    queryFn: async () => {
      const { data, error } = await supabase.from('field_crop_zones').select('*')
      if (error) throw error
      return data
    },
  }
}

export function useAllCropZones() {
  return useQuery(allCropZonesQuery())
}

export function useCropZoneMutations() {
  const qc = useQueryClient()
  const invalidate = () => void qc.invalidateQueries({ queryKey: ['field_crop_zones'] })
  const add = useMutation({
    mutationFn: async (z: {
      field_id: string
      crop_year: number
      crop_id: string
      acres: number | null
      geojson: MultiPolygon | null
      source?: string
    }) => {
      const { error } = await supabase
        .from('field_crop_zones')
        .insert({ ...z, geojson: (z.geojson as unknown as Json) ?? null })
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
      patch: Database['public']['Tables']['field_crop_zones']['Update']
    }) => {
      const { error } = await supabase.from('field_crop_zones').update(patch).eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('field_crop_zones').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
  return { add, update, remove }
}
