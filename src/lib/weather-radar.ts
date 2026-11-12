/**
 * The rain radar loop: where the rain has been, and where the model puts it
 * next, on one timeline you can drag.
 *
 * Both halves come from Environment and Climate Change Canada's GeoMet WMS,
 * free and without a key:
 *
 * - **Behind now** — `RADAR_1KM_RRAI`, the 1 km North American radar
 *   composite, precipitation rate in mm/h. New image every 6 minutes, three
 *   hours kept.
 * - **Ahead of now** — `HRDPS.CONTINENTAL_RT`, the 2.5 km high-resolution
 *   model's precipitation rate, hourly out to 48 hours.
 *
 * They are deliberately the same quantity in the same units, so dragging
 * across "now" does not change what a colour means. RainViewer, the other
 * obvious source, dropped its forecast frames on 1 January 2026 and now serves
 * the past two hours only.
 */

export const GEOMET = 'https://geo.weather.gc.ca/geomet'

/** Rain or snow: the radar measures them on different scales, so it has two layers. */
export type RadarKind = 'rain' | 'snow'

export const RADAR_LAYER: Record<RadarKind, { layer: string; style: string; unit: string }> = {
  rain: { layer: 'RADAR_1KM_RRAI', style: 'Radar-Rain_14colors', unit: 'mm/h' },
  snow: { layer: 'RADAR_1KM_RSNO', style: 'Radar-Snow_14colors', unit: 'cm/h' },
}

/**
 * The forecast half. One layer whichever the radar is showing: the model's
 * rate covers whatever is falling, and swapping it with the radar would have
 * made the snow view forecast only the snow.
 */
export const FORECAST_LAYER = { layer: 'HRDPS.CONTINENTAL_RT', style: 'PRECIPPRTMMH', unit: 'mm/h' }

/** How much of each half the loop covers. */
export const RADAR_STEP_MULTIPLE = 2 // 12 minutes, off a 6-minute radar
export const RADAR_FRAMES = 13 // two hours and a bit of history
export const FORECAST_HOURS = 24

/**
 * A MapLibre raster-source URL for one frame.
 *
 * `{bbox-epsg-3857}` is MapLibre's own placeholder — it fills in each tile's
 * bounds — so BBOX is appended raw rather than through URLSearchParams, which
 * would escape the braces.
 */
export function wmsTiles(layer: string, style: string, time: string, size = 512): string {
  const q = new URLSearchParams({
    SERVICE: 'WMS',
    VERSION: '1.3.0',
    REQUEST: 'GetMap',
    LAYERS: layer,
    STYLES: style,
    FORMAT: 'image/png',
    TRANSPARENT: 'true',
    CRS: 'EPSG:3857',
    WIDTH: String(size),
    HEIGHT: String(size),
    TIME: time,
  })
  return `${GEOMET}?${q.toString()}&BBOX={bbox-epsg-3857}`
}

/** ECCC's own colour scale for a layer, as a PNG. Theirs, so it always matches the pixels. */
export function legendUrl(layer: string, style: string): string {
  const q = new URLSearchParams({
    service: 'WMS',
    version: '1.3.0',
    request: 'GetLegendGraphic',
    sld_version: '1.1.0',
    layer,
    style,
    format: 'image/png',
  })
  return `${GEOMET}?${q.toString()}`
}

export type TimeDimension = { start: string; end: string; stepMin: number }

/** "PT6M" → 6, "PT1H" → 60, "PT1H30M" → 90. */
export function isoDurationMinutes(d: string): number {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/.exec(d.trim())
  if (!m) return 0
  return Number(m[1] ?? 0) * 1440 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0)
}

/**
 * The times a GeoMet layer has, read off its GetCapabilities.
 *
 * The capabilities document is asked for one layer at a time
 * (`&LAYER=<name>`), which keeps it at 20 KB instead of the whole service's
 * many megabytes. The dimension comes back either as `start/end/PT6M` or as a
 * comma-separated list of instants; both are handled, and where several
 * intervals are listed the last one is the live one.
 */
export function parseTimeDimension(xml: string): TimeDimension | null {
  const m = /<Dimension name="time"[^>]*>([^<]+)</.exec(xml)
  if (!m) return null
  const parts = m[1]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (!parts.length) return null

  const intervals = parts.filter((p) => p.includes('/'))
  if (intervals.length) {
    const [start, end, step] = intervals[intervals.length - 1].split('/')
    const stepMin = isoDurationMinutes(step ?? '')
    if (!start || !end || !stepMin) return null
    return { start, end, stepMin }
  }

  // A plain list of instants: the gap between the first two is the step.
  if (parts.length < 2) return { start: parts[0], end: parts[0], stepMin: 0 }
  const stepMin = Math.round((Date.parse(parts[1]) - Date.parse(parts[0])) / 60000)
  return { start: parts[0], end: parts[parts.length - 1], stepMin }
}

const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z')

/**
 * The last `count` radar images, newest last, taking every `multiple`th one.
 *
 * Every 6-minute image is more than the eye reads, and each one is a round of
 * tile requests, so the loop steps 12 minutes. It never runs off the front of
 * what the service kept.
 */
export function radarFrameTimes(dim: TimeDimension, count = RADAR_FRAMES, multiple = RADAR_STEP_MULTIPLE): string[] {
  if (!dim.stepMin) return [dim.end]
  const stepMs = dim.stepMin * multiple * 60000
  const endMs = Date.parse(dim.end)
  const startMs = Date.parse(dim.start)
  const out: string[] = []
  for (let i = count - 1; i >= 0; i--) {
    const t = endMs - i * stepMs
    if (t >= startMs) out.push(iso(t))
  }
  return out
}

/**
 * The model's frames from just after `after` out to `hours` past it.
 *
 * Anything the model offers for a time the radar has already measured is
 * dropped: where both exist, what fell beats what was predicted.
 */
export function forecastFrameTimes(dim: TimeDimension, after: string, hours = FORECAST_HOURS): string[] {
  if (!dim.stepMin) return []
  const afterMs = Date.parse(after)
  const limit = afterMs + hours * 3600000
  const stepMs = dim.stepMin * 60000
  const out: string[] = []
  for (let t = Date.parse(dim.start); t <= Date.parse(dim.end) && t <= limit; t += stepMs) {
    if (t > afterMs) out.push(iso(t))
  }
  return out
}

export type Frame = { time: string; kind: 'radar' | 'forecast' }

/** One timeline: measured, then predicted. */
export function buildFrames(radar: TimeDimension | null | undefined, forecast: TimeDimension | null | undefined): Frame[] {
  const past = radar ? radarFrameTimes(radar) : []
  const edge = past[past.length - 1]
  const ahead = forecast && edge ? forecastFrameTimes(forecast, edge) : []
  return [
    ...past.map((time): Frame => ({ time, kind: 'radar' })),
    ...ahead.map((time): Frame => ({ time, kind: 'forecast' })),
  ]
}

/** Where "now" sits: the newest measured frame, which is what the tab opens on. */
export function liveIndex(frames: Frame[]): number {
  const i = frames.map((f) => f.kind).lastIndexOf('radar')
  return i < 0 ? 0 : i
}

/**
 * "now", "24 min ago", "in 3 h" — the hint beside the clock time.
 *
 * Six minutes is the radar's own step, so anything inside it is now.
 */
export function frameRelative(time: string, nowMs: number): string {
  const min = Math.round((Date.parse(time) - nowMs) / 60000)
  if (Math.abs(min) < 6) return 'now'
  const n = Math.abs(min)
  const said = n < 60 ? `${n} min` : `${Math.round(n / 60)} h`
  return min < 0 ? `${said} ago` : `in ${said}`
}
