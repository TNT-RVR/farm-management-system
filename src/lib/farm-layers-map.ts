import type maplibregl from 'maplibre-gl'

/** The farm layers' clickable map layers (src/pages/map/FarmLayers.tsx). */
export const FARM_CLICK_LAYERS = ['farm-fill', 'farm-line', 'farm-point'] as const

/** Busy drawing or reshaping: the map page's own clicks (open a field) stand down. */
let busy = false
export const farmLayersBusy = () => busy
export const setFarmLayersBusy = (b: boolean) => void (busy = b)

/** Did a click land on one of the farm's own items? The page uses this to not also open the field under it. */
export function hitsFarmFeature(map: maplibregl.Map, point: maplibregl.PointLike): boolean {
  const present = FARM_CLICK_LAYERS.filter((l) => map.getLayer(l))
  return present.length > 0 && map.queryRenderedFeatures(point, { layers: [...present] }).length > 0
}
