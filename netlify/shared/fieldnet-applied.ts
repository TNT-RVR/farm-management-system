import type { SupabaseClient } from '@supabase/supabase-js'
import { fieldnetAccessToken, fieldnetGet, listFrom } from '../functions/_fieldnet.mts'
import type { AppliedFeature } from './fieldnet-sync-core.ts'
import { farmTz } from '../../src/lib/farm-context.ts'

// FieldNET applied water, rebuilt per LOCAL day and per degree of the circle.
//
// The first two attempts were both wrong in ways the AIMM comparison of 30 Sep
// 2026 made plain:
//  - The live sync diffed a season-to-date total against a watermark taken at
//    the first sync of each UTC day. Water between the last sync of one day and
//    the first of the next was never counted, a day the sync did not run was
//    lost, the "season" slid back 150 days so May dropped out by October, and
//    every day ran 6 pm to 6 pm here.
//  - A date-only window on /applied-irrigation is midnight to midnight UTC,
//    and a one-day window returns only the arc watered that day: #0 on 15 Jul
//    put 13 mm on 168 degrees, which is 6.1 mm on the field, not 13.
//
// FieldNET accepts full timestamps, so each local day is asked for exactly
// (midnight to midnight America/Edmonton). The wedges that come back are laid
// onto 360 one-degree bins, and the field figure is the bins summed over the
// pivot's arc divided by the arc. The bins are kept, so the sector map can show
// where the water went and a stopped pass is visible as the dry arc it left.
//
// Every run re-derives its days from scratch and replaces what was there, so
// a day missed while FieldNET or the sync was down is simply picked up by the
// next run that covers it.

const MIN_MM = 0.5
const CONCURRENCY = 5

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Local midnight of `iso` in the farm's zone, as a UTC instant. */
export function localMidnightUtc(iso: string, tz = farmTz()): string {
  // The offset at noon that day is the offset at midnight except on the two
  // DST nights, which fall outside any irrigation season.
  const noon = new Date(`${iso}T12:00:00Z`)
  const local = new Date(noon.toLocaleString('en-US', { timeZone: tz }))
  const offsetMin = Math.round((noon.getTime() - local.getTime()) / 60000)
  return new Date(Date.parse(`${iso}T00:00:00Z`) + offsetMin * 60000).toISOString().replace('.000Z', 'Z')
}

/** Compass bearing (degrees from north, clockwise) from `c` to `p`, both [lon, lat]. */
export function bearing(c: number[], p: number[]): number {
  const φ1 = (c[1] * Math.PI) / 180
  const φ2 = (p[1] * Math.PI) / 180
  const Δλ = ((p[0] - c[0]) * Math.PI) / 180
  const y = Math.sin(Δλ) * Math.cos(φ2)
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

const distM = (a: number[], b: number[]) => {
  const k = 111_320
  const dx = (b[0] - a[0]) * k * Math.cos((a[1] * Math.PI) / 180)
  const dy = (b[1] - a[1]) * k
  return Math.hypot(dx, dy)
}

function rings(geom: AppliedFeature['geometry']): number[][][] {
  if (!geom || !Array.isArray(geom.coordinates)) return []
  if (geom.type === 'Polygon') return [(geom.coordinates as number[][][])[0]]
  if (geom.type === 'MultiPolygon') return (geom.coordinates as number[][][][]).map((p) => p[0])
  return []
}

/**
 * The arc a wedge covers, as [start, width] in degrees clockwise from north.
 * Taken from the bearings of its outer vertices seen from the pivot: the
 * widest empty gap between them is the part of the circle the wedge is not.
 * Robust to where FieldNET starts the ring, which the old parser assumed was
 * the centre and so mis-placed every wedge.
 */
export function wedgeSpan(ring: number[][], centre: number[], radiusM: number): [number, number] | null {
  const bs = ring
    .filter((p) => distM(centre, p) > radiusM * 0.25)
    .map((p) => bearing(centre, p))
    .sort((a, b) => a - b)
  if (bs.length < 2) return null
  let gap = 360 - bs[bs.length - 1] + bs[0]
  let start = bs[0]
  for (let i = 1; i < bs.length; i++) {
    const g = bs[i] - bs[i - 1]
    if (g > gap) {
      gap = g
      start = bs[i]
    }
  }
  return [start, 360 - gap]
}

/** Lay a day's wedges onto 360 one-degree bins (mm). */
export function toBins(features: AppliedFeature[], centre: number[], radiusM: number): number[] {
  const bins = new Array<number>(360).fill(0)
  for (const f of features) {
    const depth = f.properties?.depth
    if (typeof depth !== 'number' || depth <= 0) continue
    for (const ring of rings(f.geometry)) {
      const span = wedgeSpan(ring, centre, radiusM)
      if (!span) continue
      const [start, width] = span
      const declared = f.properties?.['degree-count']
      // The vertices bound the wedge; degree-count confirms it. Trust the
      // vertices for where, and cap the width at what FieldNET declared.
      const w = typeof declared === 'number' && declared > 0 ? Math.min(width, declared + 1) : width
      for (let k = 0; k < Math.round(w); k++) bins[Math.floor(start + k + 0.5) % 360] += depth
    }
  }
  return bins.map((v) => Math.round(v * 100) / 100)
}

/** The pivot's arc from a season of bins: every degree that got water, as one contiguous run. */
export function arcFromSeason(season: number[]): { start: number; end: number; deg: number } {
  const wet = season.map((v) => v > 0.5)
  const n = wet.filter(Boolean).length
  if (n >= 345 || n === 0) return { start: 0, end: 360, deg: 360 }
  // The widest dry run is the part of the circle the pivot never visits.
  let best = 0
  let bestAt = 0
  for (let i = 0; i < 360; i++) {
    if (wet[i]) continue
    let len = 0
    while (len < 360 && !wet[(i + len) % 360]) len++
    if (len > best) {
      best = len
      bestAt = i
    }
  }
  const start = (bestAt + best) % 360
  return { start, end: (start + 360 - best) % 360 || 360, deg: 360 - best }
}

const inArc = (i: number, arc: { start: number; deg: number }) => (i - arc.start + 360) % 360 < arc.deg

type HistoryRow = {
  timestamp?: string
  status?: string | null
  direction?: string | null
  is_irrigating?: boolean | null
  is_moving?: boolean | null
  position?: number | null
  depth?: number | null
  /** Speed as a fraction of full (0.42 = 42%). */
  rate?: number | null
}

const NORMAL_STOPS = /^(stopped|stop|stop-in-slot|end-of-plan|parked|off|powered-off|manual-stop|idle|ready)$/i

/**
 * Passes from the controller history: a pass runs from water-on-and-moving to
 * the first row that is not. It is incomplete when it ended on a fault or
 * shutdown rather than a plain stop — that is the pass that left a dry arc.
 */
export function passesFrom(history: HistoryRow[], hoursPerRevAtFull?: number | null) {
  const rows = history.filter((h) => h.timestamp).sort((a, b) => (a.timestamp! < b.timestamp! ? -1 : 1))
  const out: {
    started_at: string
    ended_at: string | null
    start_deg: number | null
    end_deg: number | null
    swept_deg: number | null
    direction: string | null
    rate?: number | null
    depth_mm: number | null
    end_status: string | null
    completed: boolean | null
  }[] = []
  let cur: (typeof out)[number] | null = null
  for (const h of rows) {
    const wet = Boolean(h.is_irrigating) && h.is_moving !== false && !/delay/i.test(h.status ?? '')
    const pos = typeof h.position === 'number' ? h.position : null
    if (wet && !cur) {
      cur = {
        started_at: h.timestamp!,
        ended_at: null,
        start_deg: pos,
        end_deg: pos,
        swept_deg: 0,
        direction: h.direction ?? null,
        depth_mm: typeof h.depth === 'number' ? Math.round(h.depth * 1000 * 10) / 10 : null,
        end_status: null,
        completed: null,
      }
    } else if (wet && cur) {
      if (pos != null) cur.end_deg = pos
      if (typeof h.depth === 'number') cur.depth_mm = Math.round(h.depth * 1000 * 10) / 10
      if (typeof h.rate === 'number' && h.rate > 0) cur.rate = h.rate
    } else if (!wet && cur) {
      cur.ended_at = h.timestamp!
      if (pos != null) cur.end_deg = pos
      cur.end_status = h.status ?? null
      cur.completed = NORMAL_STOPS.test(h.status ?? '') || !/fault|shutdown|error|broken|low-|high-|lost|timeout/i.test(h.status ?? '')
      out.push(cur)
      cur = null
    }
  }
  if (cur) out.push(cur) // still running
  for (const p of out) {
    if (p.start_deg == null || p.end_deg == null) continue
    const fwd = (p.end_deg - p.start_deg + 360) % 360
    let swept = /reverse/i.test(p.direction ?? '') ? (360 - fwd) % 360 : fwd
    // The history only reports every few degrees, so a pass that went all the
    // way round ends near where it began and reads as a few degrees. The time
    // it ran at its speed says how many laps that was.
    if (hoursPerRevAtFull && p.rate && p.ended_at) {
      const hours = (Date.parse(p.ended_at) - Date.parse(p.started_at)) / 3.6e6
      const expected = (hours * 360 * p.rate) / hoursPerRevAtFull
      swept += 360 * Math.max(0, Math.round((expected - swept) / 360))
    }
    p.swept_deg = Math.round(swept * 10) / 10
    delete p.rate
  }
  return out
}

async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let i = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) await fn(items[i++])
    }),
  )
}

export type AppliedResult = {
  ok: boolean
  pivots: number
  days: number
  requests: number
  binRows: number
  events: number
  eventsRemoved: number
  passes: number
  offline: string[]
  errors: string[]
}

/** The Alberta calendar day an instant falls on. */
const localDayOf = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: farmTz() })

type PassForBins = { started_at: string; ended_at: string | null; start_deg: number | null; swept_deg: number | null; direction: string | null; depth_mm: number | null }

/**
 * Water from the passes alone, as 360 one-degree bins per local day — for a
 * panel whose applied-water map comes back empty for days its passes show it
 * ran (a panel whose flow is not set up reports passes but no water). Each
 * pass put its set depth on every degree it
 * swept; a degree is filed on the day the pivot crossed it, the pass's time
 * shared evenly over its degrees. A pass still running has no end and is left
 * for the next run.
 */
export function binsFromPasses(passes: PassForBins[], days: string[]): Map<string, number[]> {
  const out = new Map<string, number[]>(days.map((d) => [d, new Array<number>(360).fill(0)]))
  for (const p of passes) {
    const swept = Number(p.swept_deg ?? 0)
    const depth = Number(p.depth_mm ?? 0)
    if (!(swept > 0) || !(depth > 0) || p.start_deg == null || !p.ended_at) continue
    const t0 = Date.parse(p.started_at)
    const span = Date.parse(p.ended_at) - t0
    const sign = /reverse/i.test(p.direction ?? '') ? -1 : 1
    for (let k = 0; k < swept; k++) {
      const share = Math.min(1, swept - k)
      const day = localDayOf(new Date(t0 + (span * (k + share / 2)) / swept).toISOString())
      const bins = out.get(day)
      if (!bins) continue
      const deg = (((Math.floor(Number(p.start_deg) + sign * (k + 0.5)) % 360) + 360) % 360)
      bins[deg] += depth * share
    }
  }
  return out
}

/**
 * Rebuild applied water for linked pivots over local days `from`..`to`
 * inclusive. With `seasonArc` the arc is recomputed from the whole season's
 * bins in the database (a backfill); otherwise the stored arc is used.
 */
export async function rebuildApplied(
  sb: SupabaseClient,
  opts: { from: string; to: string; onlyFieldnetId?: string },
): Promise<AppliedResult> {
  const result: AppliedResult = { ok: true, pivots: 0, days: 0, requests: 0, binRows: 0, events: 0, eventsRemoved: 0, passes: 0, offline: [], errors: [] }
  let q = sb.from('fieldnet_systems').select('fieldnet_id, name, field_id, latitude, longitude, raw, arc_start_deg, arc_end_deg, depth_correction').not('field_id', 'is', null)
  if (opts.onlyFieldnetId) q = q.eq('fieldnet_id', opts.onlyFieldnetId)
  const { data: systems, error } = await q
  if (error) throw new Error(error.message)
  const token = await fieldnetAccessToken(sb)
  const days: string[] = []
  for (let d = opts.from; d <= opts.to; d = addDays(d, 1)) days.push(d)
  result.days = days.length
  const cropYear = Number(opts.to.slice(0, 4))

  for (const s of systems ?? []) {
    const raw = (s.raw ?? {}) as Record<string, unknown>
    const lat = Number(s.latitude ?? raw.latitude)
    const lon = Number(s.longitude ?? raw.longitude)
    const radius = Number(raw.system_length_wet ?? raw.system_length ?? 400)
    const name = (s.name as string) ?? (s.fieldnet_id as string)
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      result.errors.push(`${name}: no pivot centre`)
      continue
    }
    const centre = [lon, lat]
    // What a catch-can or flow check found the pivot really applies, against
    // its panel's depth chart. Scales the water; the bins stay as FieldNET said.
    const correction = Number(s.depth_correction ?? 1) || 1
    result.pivots++

    // A panel that has not reported in days is not a dry field: say so.
    const lastSeen = typeof raw.last_updated === 'string' ? raw.last_updated : null
    if (raw.communication_status === 'offline' && lastSeen && Date.now() - Date.parse(lastSeen) > 2 * 864e5) {
      result.offline.push(`${name} (since ${lastSeen.slice(0, 10)})`)
    }

    const dayBins = new Map<string, number[]>()
    const dayFeatures = new Map<string, AppliedFeature[]>()
    await pool(days, CONCURRENCY, async (day) => {
      const from = localMidnightUtc(day)
      const to = localMidnightUtc(addDays(day, 1))
      try {
        result.requests++
        const feats = listFrom(
          await fieldnetGet(token, `/irrigation-systems/${s.fieldnet_id}/applied-irrigation?from=${from}&to=${to}`),
        ) as AppliedFeature[]
        dayBins.set(day, toBins(feats, centre, radius))
        dayFeatures.set(day, feats)
      } catch (e) {
        if (result.errors.length < 12) result.errors.push(`${name} ${day}: ${(e as Error).message.slice(0, 90)}`)
      }
    })

    let seasonPasses: ReturnType<typeof passesFrom> = []
    // Passes, from the controller history, read in one piece: it records
    // changes only, so a season is a few hundred rows, and reading it in
    // chunks cut every pass that crossed a chunk boundary in two. The range
    // is re-derived whole, so the passes in it are replaced, not added to.
    try {
      result.requests++
      const hist = listFrom(
        await fieldnetGet(token, `/irrigation-controllers/${s.fieldnet_id}/history?from=${localMidnightUtc(opts.from)}&to=${localMidnightUtc(addDays(opts.to, 1))}`),
      ) as HistoryRow[]
      const revHours = Number(raw.run_time_100_percent) > 0 ? Number(raw.run_time_100_percent) / 3600 : null
      const passes = passesFrom(hist, revHours).map((p) => ({ ...p, fieldnet_id: s.fieldnet_id, field_id: s.field_id, updated_at: new Date().toISOString() }))
      await sb
        .from('fieldnet_passes')
        .delete()
        .eq('fieldnet_id', s.fieldnet_id)
        .gte('started_at', localMidnightUtc(opts.from))
        .lt('started_at', localMidnightUtc(addDays(opts.to, 1)))
      seasonPasses = passes
      if (passes.length) {
        const { error: e } = await sb.from('fieldnet_passes').upsert(passes, { onConflict: 'fieldnet_id,started_at' })
        if (e) result.errors.push(`${name} passes: ${e.message.slice(0, 90)}`)
        else result.passes += passes.length
      }
    } catch (e) {
      if (result.errors.length < 12) result.errors.push(`${name} history: ${(e as Error).message.slice(0, 90)}`)
    }

    // A panel whose flow is not set up reports the passes but no water. When
    // FieldNET's map is dry for every day asked and the passes say it ran,
    // the passes are the record (binsFromPasses).
    let fromPasses = false
    const mapWater = [...dayBins.values()].some((b) => b.some((v) => v > 0))
    if (!mapWater && seasonPasses.some((p) => Number(p.swept_deg) > 0 && Number(p.depth_mm) > 0)) {
      const answered = days.filter((d) => dayBins.has(d))
      for (const [day, bins] of binsFromPasses(seasonPasses, answered)) {
        dayBins.set(day, bins.map((v) => Math.round(v * 10) / 10))
        dayFeatures.set(day, [])
      }
      fromPasses = true
    }

    // The arc: from the whole season in the database plus these days.
    const { data: prior } = await sb
      .from('fieldnet_applied_bins')
      .select('date, bins')
      .eq('fieldnet_id', s.fieldnet_id)
      .gte('date', `${cropYear}-01-01`)
    const season = new Array<number>(360).fill(0)
    for (const r of prior ?? []) if (!dayBins.has(r.date as string)) (r.bins as number[]).forEach((v, i) => (season[i] += Number(v) || 0))
    for (const b of dayBins.values()) b.forEach((v, i) => (season[i] += v))
    const arc = arcFromSeason(season)

    const binRows: Record<string, unknown>[] = []
    const keepRefs = new Set<string>()
    const events: Record<string, unknown>[] = []
    for (const day of days) {
      const bins = dayBins.get(day)
      if (!bins) continue // the request failed; leave whatever is there
      const covered = bins.filter((v) => v > 0).length
      const sum = bins.reduce((a, v, i) => a + (inArc(i, arc) ? v : 0), 0)
      const mean = Math.round(((sum / arc.deg) * correction) * 10) / 10
      if (covered > 0)
        binRows.push({ fieldnet_id: s.fieldnet_id, field_id: s.field_id, date: day, bins, mean_mm: mean, covered_deg: covered, arc_deg: arc.deg, updated_at: new Date().toISOString() })
      if (mean < MIN_MM) continue

      // Zones take the day's water over their own share of the circle.
      let zoned = false
      try {
        const { data: zd, error: zErr } = await sb.rpc('fn_zone_day_depths', {
          p_field_id: s.field_id,
          p_crop_year: cropYear,
          p_sectors: { type: 'FeatureCollection', features: dayFeatures.get(day) ?? [] },
          p_lon: lon,
          p_lat: lat,
          p_radius_m: radius,
        })
        if (!zErr && Array.isArray(zd) && zd.length) {
          for (const z of zd as { zone_id: string; depth_mm: number }[]) {
            const mm = (Number(z.depth_mm) || 0) * correction
            if (mm < MIN_MM) continue
            const ref = `${s.fieldnet_id}:${z.zone_id}:${day}`
            keepRefs.add(ref)
            events.push({ field_id: s.field_id, zone_id: z.zone_id, date: day, gross_mm: Math.min(100, Math.round(mm * 10) / 10), source: 'fieldnet', fieldnet_ref: ref, coverage_deg: covered })
            zoned = true
          }
          // Zones that took none of a day's water lie off the circle (Whitfield
          // 2026: the only zone drawn is a corner of corn outside the pivot, the
          // potatoes under it have none). The water still fell; it goes on the
          // field rather than being dropped.
        }
      } catch {
        // fall through to the whole-field row
      }
      if (!zoned) {
        const ref = `${s.fieldnet_id}:${day}`
        keepRefs.add(ref)
        events.push({
          field_id: s.field_id,
          zone_id: null,
          date: day,
          gross_mm: Math.min(100, mean),
          source: 'fieldnet',
          fieldnet_ref: ref,
          coverage_deg: covered,
          note: fromPasses ? 'From the pivot passes: the panel reported no applied water' : null,
        })
      }
    }

    for (let i = 0; i < binRows.length; i += 200) {
      const { error: e } = await sb.from('fieldnet_applied_bins').upsert(binRows.slice(i, i + 200), { onConflict: 'fieldnet_id,date' })
      if (e) result.errors.push(`${name} bins: ${e.message.slice(0, 90)}`)
      else result.binRows += Math.min(200, binRows.length - i)
    }
    // Days that came back dry lose any bin row left from before.
    const dryDays = days.filter((d) => dayBins.has(d) && !binRows.some((r) => r.date === d))
    if (dryDays.length) await sb.from('fieldnet_applied_bins').delete().eq('fieldnet_id', s.fieldnet_id).in('date', dryDays)

    if (events.length) {
      const { error: e } = await sb.from('irrigation_events').upsert(events, { onConflict: 'fieldnet_ref' })
      if (e) result.errors.push(`${name} events: ${e.message.slice(0, 90)}`)
      else result.events += events.length
    }
    // Replace, don't accumulate: FieldNET rows in these days that this run did
    // not produce (a UTC-dated row from the old sync, a zone since redrawn) go.
    const answered = days.filter((d) => dayBins.has(d))
    if (answered.length) {
      const { data: old } = await sb
        .from('irrigation_events')
        .select('id, fieldnet_ref, date')
        .eq('field_id', s.field_id)
        .eq('source', 'fieldnet')
        .gte('date', answered[0])
        .lte('date', answered[answered.length - 1])
      // Only days FieldNET actually answered: a failed request keeps its row.
      const answeredSet = new Set(answered)
      const drop = (old ?? [])
        .filter((o) => !keepRefs.has(o.fieldnet_ref as string) && answeredSet.has(o.date as string))
        .map((o) => o.id as string)
      if (drop.length) {
        const { error: e } = await sb.from('irrigation_events').delete().in('id', drop)
        if (e) result.errors.push(`${name} cleanup: ${e.message.slice(0, 90)}`)
        else result.eventsRemoved += drop.length
      }
    }

    await sb
      .from('fieldnet_systems')
      .update({ arc_start_deg: arc.start, arc_end_deg: arc.end, radius_m: radius, panel_last_seen: lastSeen })
      .eq('fieldnet_id', s.fieldnet_id)
  }
  result.ok = result.errors.length === 0
  return result
}
