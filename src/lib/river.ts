import type { RiverPoint } from './irrigation'

// The River tab is split by ranch — they sit on different water. Declared here
// rather than in the lazy-loaded IrrigationRiver chunk so the page can render
// the sub-tab bar without pulling the chart bundle in eagerly.
export const RIVER_RANCHES = ['Home Ranch', 'East Ranch'] as const
export type RiverRanch = (typeof RIVER_RANCHES)[number]

/** The sub-tabs on the River view: the two ranches, then the gauge map. */
export const RIVER_TABS = [...RIVER_RANCHES, 'Map'] as const
export type RiverTab = (typeof RIVER_TABS)[number]

export type StationDef = {
  key: 'dam' | 'leth' | 'mouth'
  station: string
  label: string
  short: string
  color: string
}

// The Oldman River, upstream → downstream. Flow is released at the Oldman Dam
// (measured at Brocket), diverted for irrigation before Lethbridge, then rejoined
// by tributaries before it meets the Bow at the mouth.
export const OLDMAN_STATIONS: StationDef[] = [
  { key: 'dam', station: '05AA024', label: 'Below Oldman Dam (Brocket)', short: 'Below dam', color: '#7c3aed' },
  { key: 'leth', station: '05AD007', label: 'Near Lethbridge', short: 'Lethbridge', color: '#0284c7' },
  { key: 'mouth', station: '05AG006', label: 'Near the mouth (before Bow)', short: 'Near mouth', color: '#059669' },
]

const HOUR = 3_600_000
export const toMs = (t: string) => new Date(t.length <= 10 ? t + 'T12:00:00Z' : t).getTime()

// The dam-controlled inflow above Lethbridge = Oldman (below dam) + its dammed
// tributaries (Belly, St. Mary, Waterton). Summed for the "dam release" signal.
export const INFLOW_STATIONS: { station: string; short: string }[] = [
  { station: '05AA024', short: 'Oldman (below dam)' },
  { station: '05AD041', short: 'Belly R.' },
  { station: '05AE006', short: 'St. Mary R.' },
  { station: '05AD028', short: 'Waterton R.' },
]

/**
 * Every gauge that appears on the map — the union of what both ranches read,
 * de-duplicated, since 05AG006 feeds Home Ranch's home reading and Bow
 * Island's inflow alike.
 *
 * Positions are NOT listed here: Environment Canada's realtime collection is
 * GeoJSON, so each reading arrives with its own coordinates. A hand-kept table
 * of latitudes would only drift.
 */
export const MAP_STATIONS: { station: string; short: string; color: string; note?: string }[] = [
  { station: '05AA024', short: 'Oldman below the dam', color: '#7c3aed', note: 'Where a release shows up first' },
  { station: '05AD028', short: 'Waterton R.', color: '#a855f7' },
  { station: '05AE006', short: 'St. Mary R.', color: '#a855f7' },
  { station: '05AD041', short: 'Belly R.', color: '#a855f7' },
  { station: '05AD007', short: 'Oldman near Lethbridge', color: '#0284c7', note: 'Below the irrigation diversions' },
  { station: '05AG006', short: 'Oldman near the mouth', color: '#059669', note: 'Home Ranch pumps from this reach' },
  { station: '05BN012', short: 'Bow R. near the mouth', color: '#0284c7' },
  { station: '05AJ001', short: 'S. Sask. at Medicine Hat', color: '#059669', note: 'East Ranch pumps from this reach' },
]

/**
 * Sum several discharge series into one. Bucketed to the hour and forward-filled,
 * but only at time-buckets that actually have a reading (NOT every hour in the
 * range) — filling every hour over a decades-long "all time" span would build a
 * multi-hundred-thousand element array and crash the tab.
 */
export function combineHourly(seriesList: RiverPoint[][]): RiverPoint[] {
  const maps = seriesList
    .map((pts) => {
      const m = new Map<number, number>()
      for (const p of pts) if (p.discharge != null) m.set(Math.floor(toMs(p.t) / HOUR), p.discharge)
      return m
    })
    .filter((m) => m.size > 0)
  if (!maps.length) return []
  // The sorted union of buckets that appear in ANY stream — bounded by the data.
  const keys = new Set<number>()
  for (const m of maps) for (const h of m.keys()) keys.add(h)
  const sorted = [...keys].sort((a, b) => a - b)
  // Seed each stream's forward-fill with its earliest value so early buckets sum.
  const last = maps.map((m) => {
    let minH = Infinity
    let v = 0
    for (const [h, val] of m)
      if (h < minH) {
        minH = h
        v = val
      }
    return v
  })
  const out: RiverPoint[] = []
  for (const h of sorted) {
    let sum = 0
    maps.forEach((m, i) => {
      if (m.has(h)) last[i] = m.get(h)!
      sum += last[i]
    })
    out.push({ t: new Date(h * HOUR).toISOString(), discharge: Math.round(sum * 10) / 10, level: null })
  }
  return out
}

/** Environment Canada Water Office real-time page for a station (the source we pull). */
export const stationPageUrl = (station: string) =>
  `https://wateroffice.ec.gc.ca/report/real_time_e.html?stn=${station}`

export type MergedRow = { ms: number } & Partial<Record<StationDef['key'], number | null>>

/** Union multiple stations' discharge series onto one time axis for charting. */
export function mergeDischarge(byKey: Partial<Record<string, RiverPoint[]>>, max = 1500): MergedRow[] {
  const map = new Map<number, MergedRow>()
  for (const [key, pts] of Object.entries(byKey)) {
    for (const p of pts ?? []) {
      if (p.discharge == null) continue
      const ms = toMs(p.t)
      const row = map.get(ms) ?? { ms }
      ;(row as Record<string, number | null>)[key] = p.discharge
      map.set(ms, row)
    }
  }
  const rows = [...map.values()].sort((a, b) => a.ms - b.ms)
  if (rows.length <= max) return rows
  const step = rows.length / max
  return Array.from({ length: max }, (_, i) => rows[Math.floor(i * step)])
}

function hourly(pts: RiverPoint[]): Map<number, number> {
  const m = new Map<number, number>()
  for (const p of pts) if (p.discharge != null) m.set(Math.floor(toMs(p.t) / HOUR), p.discharge)
  return m
}

/**
 * Travel time between two stations, estimated by cross-correlating their
 * hour-to-hour flow CHANGES (differencing removes the steady diversion offset)
 * and finding the lag that best lines the upstream changes up with downstream.
 * Returns null when there isn't enough overlap or the signal is too flat.
 */
export function estimateLagHours(
  up: RiverPoint[],
  down: RiverPoint[],
  maxLagH = 48,
): { lagH: number | null; corr: number } {
  const A = hourly(up)
  const B = hourly(down)
  if (A.size < 48 || B.size < 48) return { lagH: null, corr: 0 }
  const lo = Math.max(Math.min(...A.keys()), Math.min(...B.keys()))
  const hi = Math.min(Math.max(...A.keys()), Math.max(...B.keys()))
  // Cross-correlation only makes sense on fine-grained realtime data. Bail on a
  // too-short OR a very long span (e.g. decades of daily-mean on "all time") —
  // the hourly fill over that range would build a huge array and lock up.
  if (hi - lo < 72 || hi - lo > 24 * 120) return { lagH: null, corr: 0 }
  const fill = (m: Map<number, number>) => {
    const arr: number[] = []
    let last = m.get(lo) ?? [...m.values()][0] ?? 0
    for (let h = lo; h <= hi; h++) {
      if (m.has(h)) last = m.get(h)!
      arr.push(last)
    }
    return arr
  }
  const diff = (a: number[]) => a.slice(1).map((v, i) => v - a[i])
  const da = diff(fill(A))
  const db = diff(fill(B))
  let best: { lagH: number; corr: number } | null = null
  for (let lag = 0; lag <= maxLagH; lag++) {
    const n = Math.min(da.length - lag, db.length - lag)
    if (n < 24) continue
    const xs = da.slice(0, n)
    const ys = db.slice(lag, lag + n)
    const mx = xs.reduce((s, v) => s + v, 0) / n
    const my = ys.reduce((s, v) => s + v, 0) / n
    let num = 0
    let dx = 0
    let dy = 0
    for (let i = 0; i < n; i++) {
      num += (xs[i] - mx) * (ys[i] - my)
      dx += (xs[i] - mx) ** 2
      dy += (ys[i] - my) ** 2
    }
    if (dx === 0 || dy === 0) continue
    const corr = num / Math.sqrt(dx * dy)
    if (!best || corr > best.corr) best = { lagH: lag, corr }
  }
  return best ?? { lagH: null, corr: 0 }
}

/** Recent flow trend at a station (compares latest against `windowH` hours back). */
export function recentTrend(pts: RiverPoint[], windowH = 6) {
  const valid = (pts ?? []).filter((p) => p.discharge != null)
  if (valid.length < 2) return null
  const latest = valid[valid.length - 1]
  const latestMs = toMs(latest.t)
  // The point closest to windowH hours before the latest.
  let prev = valid[0]
  for (const p of valid) {
    if (toMs(p.t) <= latestMs - windowH * HOUR) prev = p
    else break
  }
  const q = latest.discharge!
  const q0 = prev.discharge!
  const deltaAbs = q - q0
  const deltaPct = q0 > 0 ? (deltaAbs / q0) * 100 : 0
  return {
    latestQ: q,
    latestMs,
    deltaAbs,
    deltaPct,
    rising: deltaPct >= 10 && deltaAbs > 1,
    falling: deltaPct <= -10,
    hoursBack: Math.round((latestMs - toMs(prev.t)) / HOUR),
  }
}
