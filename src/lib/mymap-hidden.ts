import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Feature, Position } from 'geojson'
import { supabase } from './supabase'
import { classifyWaterName } from './cattle-water'

/**
 * Which features of the Google My Map the cattle map leaves out.
 *
 * The My Map's Water layer is mostly plumbing — mainlines, risers, pumps,
 * pivots — and drawn whole it buries the map the cattle are read on. The
 * layers themselves stay Sam's to edit in Google; this is only a list of
 * what not to draw here, keyed by feature, so a feature hidden once stays
 * hidden through every re-fetch of the map.
 */

/** The first position of any geometry, for keying. */
export function firstPosition(f: Feature): Position | null {
  const g = f.geometry
  if (!g) return null
  switch (g.type) {
    case 'Point':
      return g.coordinates
    case 'MultiPoint':
    case 'LineString':
      return g.coordinates[0] ?? null
    case 'MultiLineString':
    case 'Polygon':
      return g.coordinates[0]?.[0] ?? null
    case 'MultiPolygon':
      return g.coordinates[0]?.[0]?.[0] ?? null
    default:
      return null
  }
}

/**
 * A stable key for a My Map feature: layer, geometry type, name and where it
 * starts. Names repeat ("Abandoned Well" six times), so the position is what
 * tells them apart; five decimals is a metre.
 */
export function featureKey(f: Feature): string {
  const p = (f.properties ?? {}) as Record<string, unknown>
  const layer = String(p._layer ?? '')
  const name = String(p.name ?? p.Name ?? '').trim()
  const at = firstPosition(f)
  const where = at ? `${at[0].toFixed(5)},${at[1].toFixed(5)}` : ''
  return `${layer}|${f.geometry?.type ?? ''}|${name}|${where}`
}

export const featureName = (f: Feature): string =>
  String(((f.properties ?? {}) as Record<string, unknown>).name ?? '').trim()

export const layerOf = (f: Feature): string =>
  String(((f.properties ?? {}) as Record<string, unknown>)._layer ?? '')

/** The lease-land layer: lease polygons are named "Lease (…)", the pivots "#6 (Kellers)". */
export const isLeaseLayer = (layer: string) => /lease/i.test(layer)
export const isIrrigatedFieldFeature = (f: Feature) =>
  isLeaseLayer(layerOf(f)) && !/lease/i.test(featureName(f))

/** Water-layer plumbing: lines (pipes), and points whose name says pump, pivot, hydrant… */
export const isWaterPlumbing = (f: Feature) => {
  if (!/water/i.test(layerOf(f))) return false
  const t = f.geometry?.type
  if (t === 'LineString' || t === 'MultiLineString') return true
  if (t === 'Point' || t === 'MultiPoint') return !classifyWaterName(featureName(f)).drinkable
  return false
}

/** What the rule says before anybody has touched the feature. */
export const hiddenByDefault = (f: Feature) => isWaterPlumbing(f) || isIrrigatedFieldFeature(f)

/** Left out of the cattle map: the person's choice where there is one, else the rule. */
export function isHiddenFeature(f: Feature, overrides: Map<string, boolean> | undefined): boolean {
  const o = overrides?.get(featureKey(f))
  return o ?? hiddenByDefault(f)
}

/** The person's choices, by feature key: true hidden, false shown. */
export function useHiddenFeatures() {
  return useQuery({
    queryKey: ['mymap-hidden'],
    queryFn: async (): Promise<Map<string, boolean>> => {
      const { data, error } = await supabase.from('mymap_hidden_features').select('key, hidden')
      if (error) throw error
      return new Map((data ?? []).map((r) => [r.key as string, Boolean(r.hidden)]))
    },
    staleTime: 10 * 60_000,
  })
}

export function useHiddenFeatureMutations() {
  const qc = useQueryClient()
  const refresh = () => void qc.invalidateQueries({ queryKey: ['mymap-hidden'] })
  const set = useMutation({
    mutationFn: async (v: { features: Feature[]; hidden: boolean }) => {
      if (!v.features.length) return
      const {
        data: { user },
      } = await supabase.auth.getUser()
      const rows = v.features.map((f) => ({
        key: featureKey(f),
        layer: layerOf(f),
        name: featureName(f) || null,
        hidden: v.hidden,
        hidden_by: user?.id ?? null,
      }))
      const { error } = await supabase.from('mymap_hidden_features').upsert(rows, { onConflict: 'key' })
      if (error) throw error
    },
    onSuccess: refresh,
  })
  return { set }
}
