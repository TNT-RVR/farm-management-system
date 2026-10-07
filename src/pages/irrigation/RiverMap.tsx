import { useEffect, useMemo, useRef, useState } from 'react'
import { SETUP_LINKS, SetupLink } from '@/components/SetupLink'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useQuery } from '@tanstack/react-query'
import { SATELLITE_STYLE } from '@/lib/geo/map-style'
import { MAP_STATIONS, stationPageUrl } from '@/lib/river'
import { useCameras, snapshotUrl, playbackProblem, type Camera } from '@/lib/cameras'
import { cn } from '@/lib/utils'
import { HelpNote } from '@/components/HelpNote'

export type StationReading = {
  station: string
  name: string
  lat: number
  lng: number
  level: number | null
  discharge: number | null
  at: string | null
}

/** Every gauge the two ranches watch, with position and latest reading. */
function useStationReadings() {
  const stations = MAP_STATIONS.map((s) => s.station).join(',')
  return useQuery({
    queryKey: ['river-stations', stations],
    queryFn: async () => {
      const res = await fetch(`/api/river-stations?stations=${encodeURIComponent(stations)}`)
      if (!res.ok) throw new Error(`Station lookup failed (${res.status})`)
      const body = (await res.json()) as { stations?: StationReading[] }
      return body.stations ?? []
    },
    refetchInterval: 5 * 60_000,
    staleTime: 5 * 60_000,
  })
}

function fmt(n: number | null, digits: number): string {
  return n == null ? '—' : n.toFixed(digits)
}

function ago(iso: string | null): string {
  if (!iso) return 'no reading'
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  if (!Number.isFinite(mins) || mins < 0) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 48) return `${hrs} h ago`
  return `${Math.round(hrs / 24)} d ago`
}

/**
 * The pin itself, drawn as an HTML marker.
 *
 * The satellite style ships no glyph server, so a symbol layer could not render
 * text — the reading has to be real DOM. That suits it anyway: the number is
 * the point of the pin, not a label you hover to discover.
 */
function pinElement(r: StationReading, colour: string, selected: boolean): HTMLElement {
  const el = document.createElement('button')
  el.type = 'button'
  el.className = 'river-pin'
  el.style.cssText = [
    'display:flex',
    'align-items:center',
    'gap:6px',
    'padding:3px 8px 3px 4px',
    'border-radius:9999px',
    'font:600 12px/1.1 system-ui,sans-serif',
    'color:#fff',
    'cursor:pointer',
    'white-space:nowrap',
    `background:${colour}`,
    `border:2px solid ${selected ? '#fff' : 'rgba(255,255,255,0.55)'}`,
    `box-shadow:0 1px 6px rgba(0,0,0,${selected ? '0.6' : '0.4'})`,
    selected ? 'transform:scale(1.08)' : '',
  ].join(';')

  const dot = document.createElement('span')
  dot.style.cssText =
    'width:9px;height:9px;border-radius:9999px;background:#fff;flex:none;opacity:0.9'
  el.appendChild(dot)

  const text = document.createElement('span')
  // Discharge is what a release actually looks like; level is the fallback for
  // gauges that only report a stage.
  text.textContent =
    r.discharge != null
      ? `${fmt(r.discharge, r.discharge < 10 ? 1 : 0)} m³/s`
      : r.level != null
        ? `${fmt(r.level, 2)} m`
        : 'no data'
  el.appendChild(text)
  return el
}

export function RiverMap() {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markersRef = useRef<maplibregl.Marker[]>([])
  const [ready, setReady] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)

  const { data: readings, isLoading, error } = useStationReadings()
  const { data: cameras } = useCameras()

  const meta = useMemo(() => new Map(MAP_STATIONS.map((s) => [s.station, s])), [])
  const byStation = useMemo(
    () => new Map((readings ?? []).map((r) => [r.station, r])),
    [readings],
  )

  // Init once. The centre covers the Oldman–Bow reach both ranches draw from.
  useEffect(() => {
    if (!containerRef.current) return
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: SATELLITE_STYLE,
      center: [-112.2, 49.85],
      zoom: 7.2,
      attributionControl: false,
    })
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left')
    mapRef.current = map
    map.on('load', () => setReady(true))
    return () => {
      map.remove()
      mapRef.current = null
      markersRef.current = []
    }
  }, [])

  // Redraw the pins whenever the readings or the selection change.
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map || !readings?.length) return

    markersRef.current.forEach((m) => m.remove())
    markersRef.current = readings.map((r) => {
      const m = meta.get(r.station)
      const el = pinElement(r, m?.color ?? '#0284c7', selected === r.station)
      el.addEventListener('click', (e) => {
        e.stopPropagation()
        setSelected((cur) => (cur === r.station ? null : r.station))
      })
      return new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat([r.lng, r.lat])
        .addTo(map)
    })

    return () => {
      markersRef.current.forEach((mk) => mk.remove())
      markersRef.current = []
    }
  }, [ready, readings, selected, meta])

  // Frame all the gauges on first load, once we know where they are.
  const framed = useRef(false)
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map || framed.current || !readings?.length) return
    const b = new maplibregl.LngLatBounds()
    readings.forEach((r) => b.extend([r.lng, r.lat]))
    map.fitBounds(b, { padding: 70, duration: 0, maxZoom: 10 })
    framed.current = true
  }, [ready, readings])

  const chosen = selected ? byStation.get(selected) : null
  const chosenMeta = selected ? meta.get(selected) : null
  const chosenCamera = (cameras ?? []).find((c) => c.river_station === selected)

  return (
    <div className="space-y-3 p-4 md:p-6">
      <div>
        <h3 className="text-sm font-semibold text-gray-900">Gauge map</h3>
        <HelpNote className="mt-0.5 text-xs" summary="Tap a pin for the detail." title="Gauge map">
          <p>
            Every station the river charts read from, where it sits and what it reads right now.
            Tap a pin for the detail. Readings come from Environment Canada and update hourly.
          </p>
        </HelpNote>
      </div>

      {error != null && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
          Could not load the gauges: {(error as Error).message}
        </p>
      )}

      <div className="relative overflow-hidden rounded-lg border border-gray-200">
        <div ref={containerRef} className="h-[420px] w-full md:h-[560px]" />

        {isLoading && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center bg-black/20">
            <span className="rounded-md bg-white px-3 py-1.5 text-xs font-medium text-gray-700">
              Loading gauges…
            </span>
          </div>
        )}

        {chosen && (
          <div className="absolute bottom-3 left-3 right-3 max-w-sm rounded-lg border border-gray-200 bg-white/95 p-3 shadow-lg backdrop-blur md:right-auto">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-gray-900">
                  {chosenMeta?.short ?? chosen.name}
                </p>
                <p className="text-[11px] uppercase tracking-wide text-gray-500">
                  {chosen.station} · {chosen.name}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="-mr-1 -mt-1 rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
              <div>
                <dt className="text-[11px] uppercase tracking-wide text-gray-500">Discharge</dt>
                <dd className="font-semibold text-gray-900">
                  {fmt(chosen.discharge, chosen.discharge != null && chosen.discharge < 10 ? 2 : 1)}{' '}
                  <span className="text-xs font-normal text-gray-500">m³/s</span>
                </dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-wide text-gray-500">Level</dt>
                <dd className="font-semibold text-gray-900">
                  {fmt(chosen.level, 2)} <span className="text-xs font-normal text-gray-500">m</span>
                </dd>
              </div>
            </dl>

            <p className="mt-1.5 text-[11px] text-gray-500">
              Read {ago(chosen.at)}
              {chosenMeta?.note ? ` · ${chosenMeta.note}` : ''}
            </p>

            <GaugeCamera camera={chosenCamera} />

            <a
              href={stationPageUrl(chosen.station)}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-block text-xs font-medium text-brand-700 hover:underline"
            >
              Open this gauge on Environment Canada →
            </a>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] text-gray-600">
        {MAP_STATIONS.map((s) => (
          <button
            key={s.station}
            type="button"
            onClick={() => setSelected((cur) => (cur === s.station ? null : s.station))}
            className={cn(
              'flex items-center gap-1.5 rounded px-1 py-0.5 hover:bg-gray-100',
              selected === s.station && 'bg-gray-100 font-medium text-gray-900',
            )}
          >
            <span
              className="h-2.5 w-2.5 flex-none rounded-full"
              style={{ background: s.color }}
              aria-hidden
            />
            {s.short}
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * A camera trained on this gauge, if one is set up.
 *
 * Alberta's own gauge cameras — the pictures in the AB Rivers app — sit behind
 * a token on their map service and are not publicly fetchable, so this shows a
 * camera of ours pointed at the river instead. A camera is attached to a gauge
 * on the Cameras page.
 */
function GaugeCamera({ camera }: { camera: Camera | undefined }) {
  // A single clock, so the picture refreshes without reading time during render.
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(id)
  }, [])

  if (!camera) {
    return (
      <p className="mt-2 rounded bg-gray-50 px-2 py-1.5 text-[11px] text-gray-500">
        No camera on this gauge. Attach one on the Cameras page to see the river here.{' '}
        <SetupLink managerOnly to={SETUP_LINKS.cameras()}>Cameras</SetupLink>
      </p>
    )
  }

  const problem = playbackProblem(camera)
  const url = camera.stream_url ?? ''
  if (problem || !url) {
    return (
      <p className="mt-2 rounded bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800">
        {camera.name}: {problem ?? 'no address set'}
      </p>
    )
  }

  const every = Math.max(1, camera.refresh_seconds)
  const src =
    camera.kind === 'snapshot' ? snapshotUrl(url, Math.floor(tick / every)) : url

  return (
    <figure className="mt-2">
      {camera.kind === 'embed' ? (
        <iframe src={url} title={camera.name} className="h-36 w-full rounded border border-gray-200" />
      ) : camera.kind === 'hls' ? (
        <video
          src={url}
          muted
          autoPlay
          playsInline
          controls
          className="h-36 w-full rounded border border-gray-200 object-cover"
        />
      ) : (
        <img
          src={src}
          alt={camera.name}
          className="h-36 w-full rounded border border-gray-200 object-cover"
        />
      )}
      <figcaption className="mt-1 text-[11px] text-gray-500">{camera.name}</figcaption>
    </figure>
  )
}
