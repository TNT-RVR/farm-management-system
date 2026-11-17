import { useEffect, useRef, useState, type DependencyList, type RefObject } from 'react'
import maplibregl, {
  type GeoJSONSource,
  type ControlPosition,
  type GeolocateControlOptions,
  type LngLatBoundsLike,
  type MapOptions,
  type NavigationControlOptions,
  type StyleSpecification,
} from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { GeoJSON } from 'geojson'
import { SATELLITE_STYLE } from '@/lib/geo/map-style'
import { farmMapCenter } from '@/lib/farm-setup'

export type FarmMapOptions = {
  /** [lng, lat]. Defaults to the farm's own centre (Farm setup). */
  center?: [number, number]
  zoom?: number
  /** Framed once the style has loaded, with no animation. */
  bounds?: LngLatBoundsLike | null
  fitPadding?: number
  /**
   * Controls, all top-right except the scale bar (bottom-left). The zoom
   * buttons are on by default without the compass; pass `{}` for the compass,
   * `false` for none. `navAt` puts the zoom buttons in another corner.
   */
  controls?: { nav?: NavigationControlOptions | false; navAt?: ControlPosition; geolocate?: GeolocateControlOptions; scale?: boolean }
  /** false: a picture, not a tool. */
  interactive?: boolean
  /** The Esri credit. Off unless asked for; 'compact' is the "i" button. */
  attribution?: false | 'compact'
  style?: StyleSpecification | string
  /** Keep the frame in the canvas so it can be read back as a PNG. */
  preserveDrawingBuffer?: boolean
  /** Anything else MapLibre takes at construction (gestures, bounds options…). */
  mapOptions?: Omit<Partial<MapOptions>, 'container'>
  /** Right after construction: handlers and anything that need not wait for the style. */
  onCreate?: (map: maplibregl.Map) => void
  /** On 'load', before `ready` turns true: sources and layers that live for the map's life. */
  onReady?: (map: maplibregl.Map) => void
  /**
   * When `ready` turns true. 'tiles' (the default) is MapLibre's 'load': the
   * style AND every base tile in view, which on a slow tile day is many
   * seconds. 'style' is as soon as layers can be added, for maps that draw
   * their own layer and need not wait for the photo under it.
   */
  readyWhen?: 'tiles' | 'style'
}

type Container = RefObject<HTMLElement | null> | HTMLElement | null

const isRef = (c: Container): c is RefObject<HTMLElement | null> => c != null && 'current' in c

/**
 * The satellite map every page draws on: made when its container is there,
 * removed on unmount, `ready` once the style has loaded.
 *
 * The options are read when the map is made; later changes to them do nothing
 * unless something in `deps` changes too, which rebuilds the map. A container
 * passed as an element (state, not a ref) rebuilds it when the element does.
 *
 * Keep the container a sized block (h-full, a set height). maplibre's own CSS
 * makes it position: relative, so an `absolute inset-0` container measures 0
 * high and the map never draws.
 */
/**
 * Can this browser draw a map at all? Asked once and remembered: making a
 * throwaway canvas per map is wasteful, and the answer cannot change without a
 * reload.
 */
let webglAnswer: boolean | null = null
function webglWorks(): boolean {
  if (webglAnswer != null) return webglAnswer
  try {
    const canvas = document.createElement('canvas')
    webglAnswer = Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'))
  } catch {
    webglAnswer = false
  }
  return webglAnswer
}

/** The message that stands in for a map this browser cannot draw. */
function noMapHere(el: HTMLElement): void {
  el.textContent = ''
  const note = document.createElement('div')
  note.className = 'flex h-full items-center justify-center p-4'
  const inner = document.createElement('p')
  inner.className = 'max-w-sm text-center text-sm text-gray-600'
  inner.textContent =
    'This browser cannot draw maps — its graphics acceleration is switched off. In Chrome it is under Settings → System. Everything else on this page still works.'
  note.appendChild(inner)
  el.appendChild(note)
}

export function useFarmMap(container: Container, options: FarmMapOptions = {}, deps: DependencyList = []) {
  const mapRef = useRef<maplibregl.Map | null>(null)
  const [map, setMap] = useState<maplibregl.Map | null>(null)
  const [ready, setReady] = useState(false)
  // Bumped to throw the map away and make a fresh one where it was looking.
  const [rebuild, setRebuild] = useState(0)
  const keepView = useRef<{ center: [number, number]; zoom: number; bearing: number; pitch: number } | null>(null)
  const opts = useRef(options)
  useEffect(() => {
    opts.current = options
  })
  const element = isRef(container) ? null : container

  useEffect(() => {
    const el = isRef(container) ? container.current : container
    if (!el || mapRef.current) return
    const o = opts.current
    const kept = keepView.current
    keepView.current = null
    // A browser with no hardware drawing makes this constructor throw, and the
    // throw reached the error boundary: the whole screen became "Something went
    // wrong on this screen" over raw WebGL JSON, and Try again threw the same
    // (found 16 Nov 2026 in a cloud browser with the GPU switched off). There
    // is no fallback that is still a map, so the message goes where the map
    // would have been and the rest of the page carries on working.
    if (!webglWorks()) {
      noMapHere(el)
      return
    }
    const m = new maplibregl.Map({
      container: el,
      style: o.style ?? SATELLITE_STYLE,
      center: kept?.center ?? o.center ?? farmMapCenter(),
      zoom: kept?.zoom ?? o.zoom ?? 12,
      attributionControl: o.attribution === 'compact' ? { compact: true } : false,
      ...(o.interactive === false ? { interactive: false } : {}),
      ...(o.preserveDrawingBuffer ? { canvasContextAttributes: { preserveDrawingBuffer: true } } : {}),
      ...o.mapOptions,
      // A rebuilt map opens where the old one was looking, not where the page
      // first framed it.
      ...(kept ? { bounds: undefined, bearing: kept.bearing, pitch: kept.pitch } : {}),
    })
    // A phone left in a pocket takes the graphics context away, and MapLibre
    // answers by dropping its style: every getSource / getLayer then throws
    // until the context comes back, which crashed the cattle map when it
    // refreshed its data on waking (12 Nov 2026). So the map is not `ready`
    // while the context is gone, and when it returns the map is made again from
    // nothing, the same road as a change in `deps`. MapLibre's own restore
    // brings the old sources back, which the pages' add-once effects would
    // then trip over.
    m.on('webglcontextlost', () => setReady(false))
    m.on('webglcontextrestored', () => {
      const c = m.getCenter()
      keepView.current = { center: [c.lng, c.lat], zoom: m.getZoom(), bearing: m.getBearing(), pitch: m.getPitch() }
      setRebuild((n) => n + 1)
    })
    const nav = o.controls?.nav ?? { showCompass: false }
    if (nav) m.addControl(new maplibregl.NavigationControl(nav), o.controls?.navAt ?? 'top-right')
    if (o.controls?.geolocate) m.addControl(new maplibregl.GeolocateControl(o.controls.geolocate), 'top-right')
    if (o.controls?.scale) m.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left')
    o.onCreate?.(m)
    m.once(o.readyWhen === 'style' ? 'style.load' : 'load', () => {
      if (o.bounds && !kept) m.fitBounds(o.bounds, { padding: o.fitPadding ?? 0, duration: 0 })
      o.onReady?.(m)
      setReady(true)
    })
    mapRef.current = m
    setMap(m)
    return () => {
      m.remove()
      mapRef.current = null
      setMap(null)
      setReady(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [element, rebuild, ...deps])

  return { map, mapRef, ready }
}

/**
 * One GeoJSON source kept in step with `data`: added (with its layers) the
 * first time the map is ready, `setData` after that. Layers are added in the
 * order the hooks are called, so call them bottom layer first.
 */
export function useGeoJsonSource(
  map: maplibregl.Map | null,
  ready: boolean,
  id: string,
  data: GeoJSON,
  addLayers?: (map: maplibregl.Map) => void,
) {
  const add = useRef(addLayers)
  useEffect(() => {
    add.current = addLayers
  })
  useEffect(() => {
    if (!map || !ready) return
    const src = map.getSource(id) as GeoJSONSource | undefined
    if (src) {
      src.setData(data)
      return
    }
    map.addSource(id, { type: 'geojson', data })
    add.current?.(map)
  }, [map, ready, id, data])
}
