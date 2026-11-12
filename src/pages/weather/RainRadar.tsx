import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react'
import { useFarmMap } from '@/lib/geo/use-farm-map'
import { InfoPopover } from '@/components/InfoPopover'
import { cn } from '@/lib/utils'
import { useWeatherSites } from '@/lib/weatherSites'
import {
  FORECAST_LAYER,
  GEOMET,
  RADAR_LAYER,
  buildFrames,
  frameRelative,
  legendUrl,
  liveIndex,
  parseTimeDimension,
  wmsTiles,
  type Frame,
  type RadarKind,
  type TimeDimension,
} from '@/lib/weather-radar'

/** Milliseconds a frame is held while the loop plays. */
const FRAME_MS = 600

/**
 * What times a GeoMet layer has right now.
 *
 * Asked for one layer, which keeps the capabilities document at about 20 KB,
 * and re-asked every five minutes so the loop's leading edge keeps up with the
 * radar's six-minute images.
 */
function useTimeDimension(layer: string) {
  return useQuery<TimeDimension | null>({
    queryKey: ['geomet-time', layer],
    queryFn: async () => {
      const r = await fetch(`${GEOMET}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetCapabilities&LAYER=${encodeURIComponent(layer)}`)
      if (!r.ok) throw new Error(`Environment Canada answered ${r.status}`)
      return parseTimeDimension(await r.text())
    },
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
  })
}

const sourceId = (f: Frame) => `wx-${f.kind}-${f.time}`

/** The clock time on a frame, in the reader's own timezone. */
function clock(time: string, sameDayAs: number): string {
  const d = new Date(time)
  const t = d.toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' }).toLowerCase().replace(/\s/g, ' ')
  const sameDay = d.toDateString() === new Date(sameDayAs).toDateString()
  return sameDay ? t : `${t} ${d.toLocaleDateString('en-CA', { weekday: 'short' })}`
}

/**
 * Rain radar: the last two hours of what actually fell, then the next
 * twenty-four of what the model expects, on one timeline.
 *
 * Every frame is its own raster source, hidden until it is the one on screen —
 * MapLibre does not fetch tiles for a layer whose visibility is 'none', so a
 * frame is paid for once, when it is first looked at, and is instant on every
 * later pass of the loop.
 */
export function RainRadar() {
  const box = useRef<HTMLDivElement>(null)
  const { sites } = useWeatherSites()
  const [kind, setKind] = useState<RadarKind>('rain')
  // -1 means "stay on the newest radar image", so a refresh that brings a new
  // one moves the view with it instead of leaving it a frame behind.
  const [picked, setPicked] = useState(-1)
  const [playing, setPlaying] = useState(false)
  // Against the clock, not against the newest frame: comparing the leading
  // edge with itself made it read "now" even on a morning the radar was an
  // hour behind, which is exactly the morning you would want to know.
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])

  const radar = useTimeDimension(RADAR_LAYER[kind].layer)
  const forecast = useTimeDimension(FORECAST_LAYER.layer)
  const frames = useMemo(() => buildFrames(radar.data, forecast.data), [radar.data, forecast.data])
  const live = liveIndex(frames)
  const index = picked < 0 || picked >= frames.length ? live : picked
  const frame = frames[index]
  const radarCount = frames.filter((f) => f.kind === 'radar').length

  const { map, mapRef, ready } = useFarmMap(box, {
    zoom: 7,
    controls: { nav: { showCompass: false }, scale: true },
    readyWhen: 'style',
  })

  // Pins for the forecast sites, so the rain can be read against our own ground.
  useEffect(() => {
    if (!map || !ready) return
    const pins = sites.map((s) => {
      const el = document.createElement('div')
      el.style.cssText = 'display:flex;flex-direction:column;align-items:center;pointer-events:none'
      const dot = document.createElement('div')
      dot.style.cssText = 'width:10px;height:10px;border-radius:9999px;background:#fff;border:2px solid #111;box-shadow:0 1px 3px rgba(0,0,0,.6)'
      const label = document.createElement('div')
      label.textContent = s.name
      label.style.cssText =
        'margin-top:2px;padding:0 4px;border-radius:4px;background:rgba(255,255,255,.88);font:600 11px system-ui,sans-serif;color:#111;white-space:nowrap'
      el.append(dot, label)
      return new maplibregl.Marker({ element: el }).setLngLat([s.lng, s.lat]).addTo(map)
    })
    return () => pins.forEach((p) => p.remove())
  }, [map, ready, sites])

  // One hidden raster layer per frame; frames that have dropped off the back
  // of the loop are taken away again.
  useEffect(() => {
    const m = mapRef.current
    if (!m || !ready) return
    const want = new Set(frames.map(sourceId))
    for (const f of frames) {
      const id = sourceId(f)
      if (m.getSource(id)) continue
      const { layer, style } = f.kind === 'radar' ? RADAR_LAYER[kind] : FORECAST_LAYER
      m.addSource(id, { type: 'raster', tiles: [wmsTiles(layer, style, f.time)], tileSize: 512 })
      m.addLayer({
        id,
        type: 'raster',
        source: id,
        layout: { visibility: 'none' },
        // No fade: a cross-fade between two frames shows rain in both places at once.
        paint: { 'raster-opacity': 0.85, 'raster-fade-duration': 0 },
      })
    }
    for (const s of m.getStyle().layers) {
      if (s.id.startsWith('wx-') && !want.has(s.id)) {
        m.removeLayer(s.id)
        m.removeSource(s.id)
      }
    }
  }, [mapRef, ready, frames, kind])

  // Only the frame being read is visible.
  const activeId = frame ? sourceId(frame) : null
  useEffect(() => {
    const m = mapRef.current
    if (!m || !ready) return
    for (const s of m.getStyle().layers) {
      if (!s.id.startsWith('wx-')) continue
      const want = s.id === activeId ? 'visible' : 'none'
      if (m.getLayoutProperty(s.id, 'visibility') !== want) m.setLayoutProperty(s.id, 'visibility', want)
    }
  }, [mapRef, ready, activeId, frames])

  // Whether this frame's tiles are in yet — an empty map and a loading map
  // look identical, and "no rain" is the wrong thing to read off the second.
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    const m = mapRef.current
    if (!m || !ready || !activeId) return
    const check = () => setLoading(m.getSource(activeId) ? !m.isSourceLoaded(activeId) : false)
    check()
    m.on('sourcedata', check)
    m.on('idle', check)
    return () => {
      m.off('sourcedata', check)
      m.off('idle', check)
    }
  }, [mapRef, ready, activeId])

  const step = useCallback(
    (by: number) => {
      setPlaying(false)
      setPicked((p) => {
        const from = p < 0 ? live : p
        return Math.min(frames.length - 1, Math.max(0, from + by))
      })
    },
    [frames.length, live],
  )

  useEffect(() => {
    if (!playing || frames.length < 2) return
    const t = setInterval(() => setPicked((p) => ((p < 0 ? live : p) + 1) % frames.length), FRAME_MS)
    return () => clearInterval(t)
  }, [playing, frames.length, live])

  const failed = radar.isError && !frames.length
  const current = RADAR_LAYER[kind]
  const shown = frame?.kind === 'forecast' ? FORECAST_LAYER : current

  return (
    <section>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <span
            className={cn(
              'rounded px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide',
              frame?.kind === 'forecast' ? 'bg-violet-100 text-violet-800' : 'bg-sky-100 text-sky-800',
            )}
          >
            {frame?.kind === 'forecast' ? 'Forecast' : 'Radar'}
          </span>
          <span className="text-xl font-bold tabular-nums text-gray-900">
            {frame ? clock(frame.time, nowMs) : '—'}
          </span>
          <span className="text-sm font-medium text-gray-500">{frame ? frameRelative(frame.time, nowMs) : ''}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-gray-300 p-0.5">
            {(['rain', 'snow'] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={cn(
                  'rounded px-2 py-0.5 text-sm font-medium capitalize',
                  k === kind ? 'bg-brand-700 text-white' : 'text-gray-600 hover:bg-gray-50',
                )}
              >
                {k}
              </button>
            ))}
          </div>
          <InfoPopover title="Where this comes from" width={380}>
            <p>
              Behind now: Environment Canada's 1 km radar, {current.unit}, a new image every 6 minutes. Ahead of now: their
              2.5 km HRDPS model, hourly. Both are rates — how hard it is falling at that moment, not a total.
            </p>
            <p className="mt-2 font-medium">{shown === FORECAST_LAYER ? 'Forecast scale' : `${kind} radar scale`}</p>
            <img
              src={legendUrl(shown.layer, shown.style)}
              alt={`${shown.unit} colour scale`}
              className="mt-1 h-auto w-[124px]"
              loading="lazy"
            />
          </InfoPopover>
        </div>
      </div>

      <div className="relative overflow-hidden rounded-lg border border-gray-200">
        <div ref={box} className="h-[55vh] min-h-[320px] w-full" />
        {loading && (
          <span className="pointer-events-none absolute left-2 top-2 rounded bg-black/60 px-2 py-0.5 text-xs font-medium text-white">
            loading this frame…
          </span>
        )}
        {failed && (
          <span className="absolute inset-x-4 top-4 rounded bg-white/95 px-3 py-2 text-sm text-red-700">
            Environment Canada's radar did not answer. {(radar.error as Error)?.message}
          </span>
        )}
      </div>

      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() => step(-1)}
          disabled={index <= 0}
          aria-label="A frame back"
          className="rounded-md border border-gray-300 p-1.5 text-gray-700 hover:bg-gray-50 disabled:opacity-40"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => setPlaying((p) => !p)}
          disabled={frames.length < 2}
          className="flex items-center gap-1 rounded-md bg-brand-700 px-2.5 py-1.5 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-40"
        >
          {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          {playing ? 'Pause' : 'Play'}
        </button>
        <button
          type="button"
          onClick={() => step(1)}
          disabled={index >= frames.length - 1}
          aria-label="A frame forward"
          className="rounded-md border border-gray-300 p-1.5 text-gray-700 hover:bg-gray-50 disabled:opacity-40"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        <input
          type="range"
          min={0}
          max={Math.max(0, frames.length - 1)}
          value={index}
          onChange={(e) => {
            setPlaying(false)
            setPicked(Number(e.target.value))
          }}
          disabled={frames.length < 2}
          aria-label="Time"
          className="h-5 min-w-0 flex-1 accent-brand-700"
        />
        <button
          type="button"
          onClick={() => {
            setPlaying(false)
            setPicked(-1)
          }}
          className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
        >
          Now
        </button>
      </div>

      {frames.length > 1 && (
        <div className="mt-1 flex gap-0.5 text-[10px] font-semibold uppercase tracking-wide">
          <span className="rounded-sm bg-sky-100 py-0.5 text-center text-sky-800" style={{ flexGrow: radarCount }}>
            Radar
          </span>
          <span
            className="rounded-sm bg-violet-100 py-0.5 text-center text-violet-800"
            style={{ flexGrow: frames.length - radarCount }}
          >
            Forecast
          </span>
        </div>
      )}
      <p className="mt-1.5 text-xs text-gray-500">Radar and forecast: Environment and Climate Change Canada.</p>
    </section>
  )
}

export default RainRadar
