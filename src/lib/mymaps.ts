import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { kml } from '@tmcw/togeojson'
import type { Feature, FeatureCollection } from 'geojson'
import { supabase } from './supabase'

export type LayeredMyMap = { fc: FeatureCollection; layers: string[] }

/**
 * Which My Maps layers belong to the cattle side rather than the crop side.
 *
 * Pastures and gates are useless on the crop map and cluttered it; they belong
 * with the herd. Matching on the layer NAME is admittedly crude, but the layers
 * come from a Google My Map that Sam edits directly — there is no id to key
 * on, and hard-coding a list would go stale the first time a layer is renamed.
 *
 * Extend the list rather than the regex if a layer ends up on the wrong map;
 * that is the part meant to be edited.
 */
export const CATTLE_LAYER_WORDS = ['pasture', 'gate', 'paddock', 'corral', 'fence', 'water']

export function isCattleLayer(layerName: string): boolean {
  const n = layerName.toLowerCase()
  return CATTLE_LAYER_WORDS.some((w) => n.includes(w))
}

/** Split a map's layers by which map should show them. */
export function splitLayers(layers: string[]): { crop: string[]; cattle: string[] } {
  return {
    crop: layers.filter((l) => !isCattleLayer(l)),
    cattle: layers.filter(isCattleLayer),
  }
}

export type LegendEntry = { label: string; color: string }

/** Google-blue, the same fallback the map layers use when the KML says nothing. */
const MYMAP_DEFAULT = '#1a73e8'

/** The colour the map actually draws a feature in. */
function featureColor(f: Feature): string {
  const p = (f.properties ?? {}) as Record<string, unknown>
  const pick = (...keys: string[]) => {
    for (const k of keys) {
      const v = p[k]
      if (typeof v === 'string' && v.trim()) return v
    }
    return null
  }
  if (f.geometry?.type === 'Point' || f.geometry?.type === 'MultiPoint') {
    return pick('icon-color', 'stroke') ?? MYMAP_DEFAULT
  }
  if (f.geometry?.type === 'Polygon' || f.geometry?.type === 'MultiPolygon') {
    return pick('fill', 'stroke') ?? MYMAP_DEFAULT
  }
  return pick('stroke') ?? MYMAP_DEFAULT
}

/**
 * What is inside one My Maps layer, as a legend.
 *
 * Deduped on name AND colour: a layer of thirty oil wells all drawn the same
 * way is one legend entry, not thirty, but two wells drawn in different colours
 * are a distinction the map is making and the legend should keep. Unnamed
 * features fall back to their layer name so a colour never appears blank.
 */
export function layerLegend(fc: FeatureCollection, layer: string): LegendEntry[] {
  const seen = new Map<string, LegendEntry>()
  for (const f of fc.features) {
    if ((f.properties as Record<string, unknown> | null)?._layer !== layer) continue
    const name = (f.properties as Record<string, unknown> | null)?.name
    const label = typeof name === 'string' && name.trim() ? name.trim() : layer
    const color = featureColor(f)
    const key = `${label}|${color}`
    if (!seen.has(key)) seen.set(key, { label, color })
  }
  return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label, 'en-CA'))
}

/**
 * Convert My Maps KML to GeoJSON while preserving its layers. My Maps layers are
 * KML <Folder>s (togeojson flattens them), so each folder's placemarks are
 * converted separately — with the document's <Style>/<StyleMap> defs injected so
 * colours and icons still resolve — and tagged with `_layer`.
 */
/**
 * Layers we do not take from My Maps.
 *
 * The legal land descriptions are drawn from the survey grid now, live and at
 * every zoom, so the hand-drawn copy is a second version of the same thing that
 * can disagree with the first. Skipping it at parse time rather than hiding it
 * in the UI also avoids converting several thousand placemarks nobody will see.
 */
const SKIP_LAYER = /legal\s*land|^llds?$/i

export function isSkippedLayer(name: string): boolean {
  return SKIP_LAYER.test(name.trim())
}

function parseLayeredKml(text: string): LayeredMyMap {
  const dom = new DOMParser().parseFromString(text, 'text/xml')
  const doc = dom.getElementsByTagName('Document')[0] ?? dom.documentElement
  const ser = new XMLSerializer()
  const kids = (parent: Element | Document, tag: string) =>
    Array.from(parent.childNodes).filter((n) => n.nodeName === tag) as Element[]

  const styleXml = Array.from(doc.childNodes)
    .filter((n) => n.nodeName === 'Style' || n.nodeName === 'StyleMap')
    .map((n) => ser.serializeToString(n))
    .join('')

  const features: Feature[] = []
  const layers: string[] = []
  const build = (name: string, placemarks: Element[]) => {
    if (!placemarks.length) return
    const pm = placemarks.map((p) => ser.serializeToString(p)).join('')
    const mini = `<kml xmlns="http://www.opengis.net/kml/2.2"><Document>${styleXml}${pm}</Document></kml>`
    const sub = kml(new DOMParser().parseFromString(mini, 'text/xml'))
    for (const f of sub.features) {
      if (!f.geometry) continue
      f.properties = { ...(f.properties ?? {}), _layer: name }
      features.push(f as Feature)
    }
    if (!layers.includes(name)) layers.push(name)
  }

  for (const folder of kids(doc, 'Folder')) {
    const nm = kids(folder, 'name')[0]?.textContent?.trim() || 'Layer'
    if (isSkippedLayer(nm)) continue
    build(nm, kids(folder, 'Placemark'))
  }
  build('Map', kids(doc, 'Placemark')) // placemarks not inside any folder
  return { fc: { type: 'FeatureCollection', features }, layers }
}

/** Pull the map id (`mid`) out of any Google My Maps URL (edit/view/embed). */
export function extractMid(url: string | null | undefined): string | null {
  if (!url) return null
  const m = url.match(/[?&]mid=([^&]+)/)
  return m ? decodeURIComponent(m[1]) : null
}

export function useMyMapUrl() {
  return useQuery({
    queryKey: ['mymaps_url'],
    queryFn: async () => {
      // maybeSingle: a new install has no farm row until Farm setup or a first field makes one.
      const { data, error } = await supabase.from('farms').select('id, mymaps_url').limit(1).maybeSingle()
      if (error) throw error
      return data
    },
  })
}

export function useSetMyMapUrl() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, mymaps_url }: { id: string | null | undefined; mymaps_url: string | null }) => {
      let farmId = id
      if (!farmId) {
        const made = await supabase.rpc('ensure_farm')
        if (made.error) throw made.error
        farmId = made.data as string
      }
      const { error } = await supabase.from('farms').update({ mymaps_url }).eq('id', farmId)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['mymaps_url'] }),
  })
}

/**
 * Live GeoJSON of a shared Google My Map (KML via the proxy, parsed with
 * togeojson). Refetches every few minutes so edits on My Maps appear. Throws
 * 'not_shared' when the map isn't publicly viewable.
 */
export function useMyMapGeo(url: string | null | undefined, enabled: boolean) {
  const mid = extractMid(url)
  return useQuery({
    queryKey: ['mymaps_geo', mid],
    enabled: Boolean(mid) && enabled,
    refetchInterval: 5 * 60_000,
    staleTime: 60_000,
    queryFn: async (): Promise<LayeredMyMap> => {
      const res = await fetch(`/api/mymaps-kml?mid=${encodeURIComponent(mid!)}`)
      if (!res.ok) {
        const b = await res.json().catch(() => ({}))
        throw new Error((b as { error?: string }).error === 'not_shared' ? 'not_shared' : 'fetch_failed')
      }
      return parseLayeredKml(await res.text())
    },
  })
}
