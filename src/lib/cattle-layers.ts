import { useCallback, useEffect, useMemo, useState } from 'react'

// Layer visibility and colour for the cattle map.
//
// The gates, fences and water came over from the crop map as whatever colours
// the Google My Map happened to give them, which is fine until two layers land
// on the same blue and the map stops distinguishing anything. So each layer
// carries a chosen colour and a visibility, and both persist — a map you have
// to re-configure every visit is one you stop configuring.

/** Layers the cattle map draws that are not the paddocks themselves. */
export type CattleLayerKey = string

export type LayerSetting = { visible: boolean; colour: string }

/**
 * A palette that stays apart on satellite imagery.
 *
 * Chosen against the basemap rather than against each other: cropland is green
 * and soil is brown, so both are avoided for anything that has to read on top.
 * Assigned round-robin by layer order so two layers never start identical,
 * which is the state the My Map colours left them in.
 */
export const LAYER_PALETTE = [
  '#0ea5e9', // sky
  '#f97316', // orange
  '#a855f7', // violet
  '#ec4899', // pink
  '#facc15', // yellow
  '#14b8a6', // teal
  '#ef4444', // red
  '#ffffff', // white
]

export function defaultColour(index: number): string {
  return LAYER_PALETTE[index % LAYER_PALETTE.length]
}

const STORAGE_KEY = 'cattle_map_layers'

/**
 * Persisted per-layer settings, keyed by layer name.
 *
 * Keyed by NAME rather than index because the My Map's layer order changes
 * whenever Sam reorders it, and settings that follow position rather than
 * identity would silently reassign colours the next time he did.
 */
export function useCattleLayerSettings(layers: string[]) {
  // Only EXPLICIT choices are stored. Defaults are derived at render time from
  // the layer list, so a new layer appearing in the My Map needs no seeding
  // pass — which is what the earlier version used an effect for, and effects
  // that setState on mount make React render twice before paint.
  const [overrides, setOverrides] = useState<Record<string, Partial<LayerSetting>>>(() => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<
        string,
        Partial<LayerSetting>
      >
    } catch {
      return {}
    }
  })

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides))
  }, [overrides])

  const settings = useMemo(() => {
    const out: Record<string, LayerSetting> = {}
    layers.forEach((name, i) => {
      out[name] = {
        visible: overrides[name]?.visible ?? true,
        colour: overrides[name]?.colour ?? defaultColour(i),
      }
    })
    return out
  }, [layers, overrides])

  const setLayer = useCallback((name: string, patch: Partial<LayerSetting>) => {
    setOverrides((prev) => ({ ...prev, [name]: { ...prev[name], ...patch } }))
  }, [])

  return { settings, setLayer }
}

/** Whether the paddock shading itself is on, and how it is shaded. */
export type PastureFill = 'ndvi' | 'photo' | 'readiness' | 'off'
