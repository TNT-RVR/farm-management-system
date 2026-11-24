// One Water Survey of Canada gauge, read for the dam-release watcher.
//
// In freeze-up the Survey withdraws its provisional flow figures (ice makes
// them unreliable) and keeps publishing only water levels, often wiping flow
// back several days at once. A gauge that answers with readings but no flow is
// therefore "reachable, flow paused for ice", not an outage.

export type GaugeFeature = { properties: Record<string, unknown> }

export type GaugeReading = {
  /** Readings returned at all (level or flow). */
  readings: number
  /** Latest flow and the lowest flow in the rise window, or null when no flow is published. */
  flow: { latestQ: number; latestT: number; windowMinQ: number } | null
}

const HOUR = 3_600_000

export function readGauge(features: GaugeFeature[] | undefined, riseWindowH: number): GaugeReading {
  const all = features ?? []
  const pts = all
    .map((f) => ({ t: f.properties.DATETIME as string, q: f.properties.DISCHARGE as number | null }))
    .filter((p): p is { t: string; q: number } => !!p.t && typeof p.q === 'number')
    .sort((a, b) => a.t.localeCompare(b.t))
  if (pts.length < 2) return { readings: all.length, flow: null }
  const latest = pts[pts.length - 1]
  const latestT = new Date(latest.t).getTime()
  const cutoff = latestT - riseWindowH * HOUR
  const windowMinQ = Math.min(...pts.filter((p) => new Date(p.t).getTime() >= cutoff).map((p) => p.q))
  return { readings: all.length, flow: { latestQ: latest.q, latestT, windowMinQ } }
}
