import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Feature, Geometry } from 'geojson'
import { supabase } from './supabase'

/**
 * The farm's own map layers (map_layers / map_features, migration
 * 20261007020000): folders copied out of the Google My Map, then owned and
 * edited in the app. Read as GeoJSON through map_features_geojson; written
 * through save_map_feature / import_map_layer. Managers edit; everyone reads.
 */
const db = supabase as unknown as SupabaseClient

export type FarmLayer = { id: string; name: string; source: string | null; sort_order: number }
export type FarmFeature = {
  id: string
  layer_id: string
  label: string | null
  properties: Record<string, unknown>
  geojson: Geometry
  updated_at: string
}

/** The My Map folder a layer was copied from ('mymap:Water' → 'Water'). */
export const myMapFolderOf = (l: Pick<FarmLayer, 'source'>) => (l.source?.startsWith('mymap:') ? l.source.slice(6) : null)

export function useFarmLayers() {
  return useQuery({
    queryKey: ['farm_layers'],
    queryFn: async (): Promise<FarmLayer[]> => {
      const { data, error } = await db.from('map_layers').select('id, name, source, sort_order').order('sort_order').order('name')
      if (error) throw error
      return (data ?? []) as FarmLayer[]
    },
  })
}

export function useFarmFeatures(layerIds: string[]) {
  return useQuery({
    enabled: layerIds.length > 0,
    queryKey: ['farm_features', [...layerIds].sort()],
    queryFn: async (): Promise<FarmFeature[]> => {
      const out: FarmFeature[] = []
      // Paged: a busy layer can pass the 1,000-row read limit.
      for (let from = 0; ; from += 1000) {
        const { data, error } = await db
          .from('map_features_geojson')
          .select('id, layer_id, label, properties, geojson, updated_at')
          .in('layer_id', layerIds)
          .order('id')
          .range(from, from + 999)
        if (error) throw error
        out.push(...((data ?? []) as FarmFeature[]))
        if ((data ?? []).length < 1000) break
      }
      return out
    },
  })
}

function invalidate(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ['farm_features'] })
  void qc.invalidateQueries({ queryKey: ['farm_layers'] })
  // Checklist places that follow a feature move with it (database trigger).
  void qc.invalidateQueries({ queryKey: ['checklist_template_locations'] })
}

export function useSaveFeature() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (f: { id?: string; layer_id: string; label: string | null; properties?: Record<string, unknown>; geojson: Geometry }) => {
      const { data, error } = await db.rpc('save_map_feature', {
        p_id: f.id ?? null,
        p_layer: f.layer_id,
        p_label: f.label,
        p_properties: f.properties ?? null,
        p_geojson: f.geojson,
      })
      if (error) throw error
      return data as string
    },
    onSuccess: () => invalidate(qc),
  })
}

export function useDeleteFeature() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.from('map_features').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => invalidate(qc),
  })
}

/** Copy a My Map folder into the app (once). */
export function useImportMyMapFolder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ folder, features }: { folder: string; features: Feature[] }) => {
      const clean = features
        .filter((f) => f.geometry && ['Point', 'LineString', 'Polygon'].includes(f.geometry.type))
        .map((f) => ({
          type: 'Feature',
          // Only what's worth keeping: name, description and how Google styled it.
          properties: Object.fromEntries(
            Object.entries(f.properties ?? {}).filter(([k]) => ['name', 'description', 'stroke', 'stroke-width', 'fill', 'icon-color', 'icon'].includes(k)),
          ),
          geometry: f.geometry,
        }))
      const { data, error } = await db.rpc('import_map_layer', { p_name: folder, p_source: `mymap:${folder}`, p_features: clean })
      if (error) throw error
      return data as string
    },
    onSuccess: () => invalidate(qc),
  })
}
