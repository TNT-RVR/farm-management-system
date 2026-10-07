import type { SupabaseClient } from '@supabase/supabase-js'
import { fieldnetAccessToken, fieldnetGet, fieldnetList, listFrom } from '../functions/_fieldnet.mts'
import { farmTz } from '../../src/lib/farm-context.ts'

// Core FieldNET → app sync, shared by the on-demand function (fieldnet-sync.mts)
// and the scheduled refresh (fieldnet-sync-cron.mts). Pulls live systems +
// controllers into fieldnet_systems, links to fields by name, lands applied
// irrigation into irrigation_events, and fires a manager alert when a pivot
// transitions into a fault/shutdown state.

type Feature = {
  id?: string
  geometry?: unknown
  properties?: {
    name?: string
    type?: string
    direction?: string | null
    speed?: number | null
    is_water_on?: boolean | null
    communications_status?: string | null
    last_updated?: string | null
  }
}
type Controller = {
  id?: string
  name?: string
  subtype?: string
  operational_status?: string | null
  communication_status?: string | null
  direction?: string | null
  speed?: number | null
  is_water_on?: boolean | null
  latitude?: number | null
  longitude?: number | null
}

type SystemRow = {
  fieldnet_id: string
  name: string | null
  irrigator_type: string | null
  subtype: string | null
  direction: string | null
  speed_pct: number | null
  is_water_on: boolean | null
  operational_status: string | null
  comms_status: string | null
  latitude: number | null
  longitude: number | null
  geometry: unknown | null
  device_updated_at: string | null
  raw: Record<string, unknown>
  synced_at: string
}

// operational_status values worth waking a manager for. Deliberately excludes
// normal running/stopped states and benign delays/warnings to avoid noise.
const FAULT_STATES = new Set<string>([
  'alignment-fault',
  'low-pressure',
  'high-pressure',
  'low-voltage',
  'high-voltage',
  'low-flow',
  'high-flow',
  'high-wind-speed',
  'hardware-fault',
  'position-fault',
  'end-gun-error',
  'span-cable-broken',
  'span-cable-tampering',
  'two-second-timer-fault',
  'forward-reverse-shutdown',
  'pressurization-shutdown',
  'high-flow-shutdown',
  'aux-low-flow-shutdown',
  'aux-high-flow-shutdown',
  'low-auxiliary-pressure',
  'high-auxiliary-pressure',
  'missing-plan-shutdown',
  'cable-error',
  'geofence-error',
  'gps-reverse-rotation-shutdown',
  'engine-start-shutdown',
  'cart-safety-shutdown',
])

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
const pretty = (s: string) => s.replace(/-/g, ' ')

// The outer ring of a GeoJSON Polygon or MultiPolygon (applied-irrigation
// sectors come as either): Polygon → coordinates[0]; MultiPolygon → coordinates[0][0].
function outerRing(geom: { type?: string; coordinates?: unknown } | undefined): number[][] | null {
  if (!geom || !Array.isArray(geom.coordinates)) return null
  const c = geom.coordinates as unknown[]
  if (geom.type === 'Polygon') return (c[0] as number[][]) ?? null
  if (geom.type === 'MultiPolygon') {
    const poly = c[0] as unknown[]
    return Array.isArray(poly) ? ((poly[0] as number[][]) ?? null) : null
  }
  return null
}

// A pass that stops partway leaves an arc short while the field average still
// looks fine — averaging is exactly what hides it. These bound when that is
// worth waking someone for.
//
// 20 degrees because a circle is never watered perfectly evenly and a narrow
// wedge behind is ordinary; a twentieth of the circle is not a stoppage. The
// mean floor keeps it quiet in April, when everything is legitimately at zero
// and every arc is trivially "behind".
const BEHIND_ALERT_DEG = 20
const BEHIND_ALERT_MIN_MEAN_MM = 10

export type AppliedFeature = {
  properties?: Record<string, unknown>
  geometry?: { type?: string; coordinates?: unknown }
}
type Sector = { depth: number; a0: number; a1: number }

/**
 * Applied-irrigation features → angular sectors with their absolute applied
 * depth (mm), plus min/max/mean. Each feature is a wedge whose apex is the
 * pivot point; the mid-angle comes from the arc centroid (robust to ring
 * ordering) and the width from the reliable `degree-count` property.
 * `meanForBehind` is the reference used to count "behind" arc-degrees.
 */
function parseSectors(features: AppliedFeature[], meanForBehind: number) {
  const sectors: Sector[] = []
  let min = Infinity
  let max = 0
  let behindDeg = 0
  for (const f of features) {
    const ring = outerRing(f.geometry)
    const depth = f.properties?.depth
    const deg =
      typeof f.properties?.['degree-count'] === 'number' ? (f.properties['degree-count'] as number) : 0
    if (!ring || ring.length < 3 || typeof depth !== 'number' || deg <= 0) continue
    const pc = ring[0]
    const arc = ring
      .slice(1, ring.length - 1)
      .filter((p) => Math.abs(p[0] - pc[0]) > 1e-6 || Math.abs(p[1] - pc[1]) > 1e-6)
    if (!arc.length) continue
    let sx = 0
    let sy = 0
    for (const p of arc) {
      sx += p[0]
      sy += p[1]
    }
    const mid = bearingDeg(pc, [sx / arc.length, sy / arc.length])
    sectors.push({
      depth: Math.round(depth * 10) / 10,
      a0: Math.round(((mid - deg / 2 + 360) % 360) * 10) / 10,
      a1: Math.round(((mid + deg / 2) % 360) * 10) / 10,
    })
    min = Math.min(min, depth)
    max = Math.max(max, depth)
    if (depth < meanForBehind * 0.6) behindDeg += deg
  }
  const minOut = min === Infinity ? null : min
  return {
    sectors,
    min: minOut,
    max,
    behindDeg,
    summary: {
      sectors,
      mean: Math.round(meanForBehind * 10) / 10,
      min: minOut == null ? null : Math.round(minOut * 10) / 10,
      max: Math.round(max * 10) / 10,
    },
  }
}

// Compass bearing (deg from north) from point a to point b ([lon,lat]).
function bearingDeg(a: number[], b: number[]): number {
  const φ1 = (a[1] * Math.PI) / 180
  const φ2 = (b[1] * Math.PI) / 180
  const Δλ = ((b[0] - a[0]) * Math.PI) / 180
  const y = Math.sin(Δλ) * Math.cos(φ2)
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

// Extract a section-township-range key (e.g. "SE141114") from a legal land
// description OR a FieldNET pivot name that embeds one ("#6 JB - SE 10-71-13").
function legalKey(s: string | null | undefined): string | null {
  if (!s) return null
  const m = s.toUpperCase().match(/\b(NE|NW|SE|SW|N|S|E|W)?\s*[-.\s]?\s*(\d{1,2})-(\d{1,2})-(\d{1,2})\b/)
  return m ? `${m[1] ?? ''}${m[2]}${m[3]}${m[4]}` : null
}

// Area-weighted mean applied depth (mm) across the sector polygons FieldNET
// returns for /applied-irrigation — i.e. the field-average applied depth over
// the queried window. Each feature has {depth, degree-count}.
export function areaWeightedDepth(features: { properties?: Record<string, unknown> }[]): number {
  let w = 0
  let deg = 0
  for (const f of features) {
    const p = f.properties ?? {}
    const d = typeof p.depth === 'number' ? p.depth : 0
    const g = typeof p['degree-count'] === 'number' ? (p['degree-count'] as number) : 0
    w += d * g
    deg += g
  }
  return deg > 0 ? w / deg : 0
}

export type FieldnetSyncResult = {
  systems: number
  controllers: number
  linkedFields: number
  appliedWritten: number
  appliedSkipped: number
  alerts: number
  errors: string[]
}

export async function runFieldnetSync(sb: SupabaseClient): Promise<FieldnetSyncResult> {
  const result: FieldnetSyncResult = {
    systems: 0,
    controllers: 0,
    linkedFields: 0,
    appliedWritten: 0,
    appliedSkipped: 0,
    alerts: 0,
    errors: [],
  }

  try {
    const token = await fieldnetAccessToken(sb)
    const now = new Date().toISOString()

    // 1. Irrigation systems (GeoJSON FeatureCollection).
    const features = await fieldnetList<Feature>(
      token,
      '/irrigation-systems',
      (b) => listFrom(b) as Feature[],
      100,
    )
    const byId = new Map<string, SystemRow>()
    for (const f of features) {
      if (!f.id) continue
      const p = f.properties ?? {}
      byId.set(f.id, {
        fieldnet_id: f.id,
        name: p.name ?? null,
        irrigator_type: p.type ?? null,
        subtype: null,
        direction: p.direction ?? null,
        speed_pct: typeof p.speed === 'number' ? Math.round(p.speed * 100 * 10) / 10 : null,
        is_water_on: p.is_water_on ?? null,
        operational_status: null,
        comms_status: p.communications_status ?? null,
        latitude: null,
        longitude: null,
        geometry: f.geometry ?? null,
        device_updated_at: p.last_updated ?? null,
        raw: (p as Record<string, unknown>) ?? {},
        synced_at: now,
      })
    }
    result.systems = byId.size

    // 2. Irrigation controllers → merge status/subtype/location/telemetry.
    try {
      const controllers = await fieldnetList<Controller>(
        token,
        '/irrigation-controllers',
        (b) => listFrom(b) as Controller[],
        300,
      )
      for (const c of controllers) {
        if (!c.id) continue
        const row =
          byId.get(c.id) ??
          ({
            fieldnet_id: c.id,
            name: null,
            irrigator_type: null,
            subtype: null,
            direction: null,
            speed_pct: null,
            is_water_on: null,
            operational_status: null,
            comms_status: null,
            latitude: null,
            longitude: null,
            geometry: null,
            device_updated_at: null,
            raw: {},
            synced_at: now,
          } as SystemRow)
        row.name = row.name ?? c.name ?? null
        row.subtype = c.subtype ?? null
        row.operational_status = c.operational_status ?? row.operational_status
        row.comms_status = c.communication_status ?? row.comms_status
        row.direction = row.direction ?? c.direction ?? null
        row.is_water_on = row.is_water_on ?? (typeof c.is_water_on === 'boolean' ? c.is_water_on : null)
        row.speed_pct =
          row.speed_pct ?? (typeof c.speed === 'number' ? Math.round(c.speed * 100 * 10) / 10 : null)
        row.latitude = typeof c.latitude === 'number' ? c.latitude : row.latitude
        row.longitude = typeof c.longitude === 'number' ? c.longitude : row.longitude
        row.raw = { ...row.raw, ...(c as Record<string, unknown>) }
        byId.set(c.id, row)
      }
      result.controllers = controllers.length
    } catch (e) {
      result.errors.push(`controllers: ${(e as Error).message.slice(0, 120)}`)
    }

    // 3. Existing rows: keep manager field links, and remember prior op-status
    //    so we only alert on a NEW transition into a fault state.
    const { data: existing } = await sb
      .from('fieldnet_systems')
      .select('fieldnet_id, field_id, name, operational_status, applied_behind_deg')
    const existingLink = new Map((existing ?? []).map((r) => [r.fieldnet_id, r.field_id]))
    const priorStatus = new Map((existing ?? []).map((r) => [r.fieldnet_id, r.operational_status]))
    const priorBehind = new Map(
      (existing ?? []).map((r) => [r.fieldnet_id, (r.applied_behind_deg as number | null) ?? 0]),
    )
    // Match FieldNET pivots to fields by the legal land description embedded in
    // the pivot name (most reliable), then by exact name. Never clobber a link a
    // manager has already set by hand.
    const { data: fields } = await sb.from('fields').select('id, name, legal_land_description')
    const fieldByName = new Map<string, string>()
    const fieldByLegal = new Map<string, string>()
    for (const f of fields ?? []) {
      fieldByName.set(norm(f.name), f.id)
      const lk = legalKey(f.legal_land_description)
      if (lk && !fieldByLegal.has(lk)) fieldByLegal.set(lk, f.id)
    }

    const rows = [...byId.values()].map((r) => {
      const already = existingLink.get(r.fieldnet_id)
      const byLegal = r.name ? fieldByLegal.get(legalKey(r.name) ?? '') : undefined
      const byName = r.name ? fieldByName.get(norm(r.name)) : undefined
      const field_id = already ?? byLegal ?? byName ?? null
      if (!already && (byLegal || byName)) result.linkedFields++
      return { ...r, field_id }
    })

    if (rows.length) {
      const { error } = await sb.from('fieldnet_systems').upsert(rows, { onConflict: 'fieldnet_id' })
      if (error) throw new Error(`upsert systems: ${error.message}`)
    }

    // 4. Fault alerts — notify managers when a pivot enters a fault state it
    //    wasn't already in (transition-only, so a persistent fault alerts once).
    for (const r of rows) {
      const cur = r.operational_status
      const prev = priorStatus.get(r.fieldnet_id) ?? null
      if (cur && FAULT_STATES.has(cur) && cur !== prev) {
        const link = r.field_id ? `/fields/${r.field_id}` : '/irrigation-info'
        const { error } = await sb.rpc('fn_notify_managers', {
          p_kind: 'fieldnet_fault',
          p_title: `Pivot fault: ${r.name ?? 'FieldNET pivot'}`,
          p_body: `${r.name ?? 'A pivot'} is reporting "${pretty(cur)}".`,
          p_link: link,
          p_details: { pivot: r.name, fieldnet_id: r.fieldnet_id, field_id: r.field_id, status: cur, previous_status: prev, comms: r.comms_status, device_updated_at: r.device_updated_at },
        })
        if (!error) result.alerts++
      }
    }

    // 5. Applied irrigation: the season picture for the map and the uneven-
    //    watering alert. The day-by-day water that feeds the balance is no
    //    longer written here — it is rebuilt per local day and per degree by
    //    fieldnet-applied (hourly), because diffing this season total against
    //    a start-of-UTC-day watermark lost water between syncs, lost whole days
    //    when a sync failed, and filed evening passes on tomorrow.
    const now2 = new Date()
    const cropYear = Number(now2.toLocaleDateString('en-CA', { timeZone: farmTz() }).slice(0, 4))
    // From 1 January, not a sliding 150 days: by October a sliding window had
    // dropped May's water out of the "season" total.
    const seasonFrom = `${cropYear}-01-01`
    const tomorrow = new Date(Date.now() + 864e5).toISOString().slice(0, 10)
    for (const r of rows) {
      if (!r.field_id) continue
      try {
        const applied = listFrom(
          await fieldnetGet(
            token,
            `/irrigation-systems/${r.fieldnet_id}/applied-irrigation?from=${seasonFrom}&to=${tomorrow}`,
          ),
        ) as AppliedFeature[]
        const cum = areaWeightedDepth(applied) // season-to-date mean applied mm
        const season = parseSectors(applied, cum)

        // The same sectors for the shorter windows, so the map heatmap can show
        // absolute applied depth over the season, last 30 days, or last 7 days.
        const windows: Record<string, unknown> = { season: season.summary }
        for (const [key, days] of [
          ['month', 30],
          ['week', 7],
        ] as const) {
          try {
            const from = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10)
            const feats = listFrom(
              await fieldnetGet(
                token,
                `/irrigation-systems/${r.fieldnet_id}/applied-irrigation?from=${from}&to=${tomorrow}`,
              ),
            ) as AppliedFeature[]
            windows[key] = parseSectors(feats, areaWeightedDepth(feats)).summary
          } catch {
            windows[key] = { sectors: [], mean: 0, min: null, max: null }
          }
        }

        // A stopped pass is an equipment event before it is a data problem:
        // the useful response is that somebody walks out to the pivot, not that
        // the balance quietly averages the dry arc away. Fires on the crossing
        // only, like the fault alert, so a pivot left behind does not nag daily.
        const behindNow = Math.round(season.behindDeg)
        const behindPrev = priorBehind.get(r.fieldnet_id) ?? 0
        if (
          behindNow >= BEHIND_ALERT_DEG &&
          behindPrev < BEHIND_ALERT_DEG &&
          cum >= BEHIND_ALERT_MIN_MEAN_MM
        ) {
          const driest = season.min == null ? null : Math.round(season.min)
          const link = r.field_id ? `/fields/${r.field_id}` : '/irrigation-info'
          const { error: alertErr } = await sb.rpc('fn_notify_managers', {
            p_kind: 'fieldnet_behind',
            p_title: `Uneven watering: ${r.name ?? 'FieldNET pivot'}`,
            p_body:
              `${behindNow}° of the circle is behind the rest of the field` +
              (driest == null
                ? '.'
                : ` — driest ${driest} mm against a ${Math.round(cum)} mm average.`) +
              ' Check whether a pass stopped partway.',
            p_link: link,
          })
          if (!alertErr) result.alerts++
        }

        await sb
          .from('fieldnet_systems')
          .update({
            applied_sectors: season.sectors,
            // The sector POLYGONS, not just their bearings. A zone cut across
            // the ring by a straight line needs the AREA of each sector falling
            // inside it, which {depth, a0, a1} cannot answer — so the shape has
            // to survive the sync for fn_area_weighted_depth to intersect.
            applied_geom: { type: 'FeatureCollection', features: applied },
            applied_mean_mm: Math.round(cum * 10) / 10,
            applied_min_mm: season.min == null ? null : Math.round(season.min * 10) / 10,
            applied_behind_deg: Math.round(season.behindDeg),
            applied_windows: windows,
          })
          .eq('fieldnet_id', r.fieldnet_id)

      } catch (e) {
        result.errors.push(`applied ${r.name}: ${(e as Error).message.slice(0, 80)}`)
      }
    }

    await sb
      .from('integration_accounts')
      .update({
        last_sync_at: now,
        status: 'connected',
        last_error: result.errors.length ? result.errors.slice(0, 3).join('; ') : null,
        updated_at: now,
      })
      .eq('provider', 'fieldnet')
    await sb.rpc('record_integration_heartbeat', {
      p_key: 'fieldnet',
      p_detail: `${result.systems} systems, ${result.controllers} controllers`,
      p_data_at: now,
    })

    return result
  } catch (e) {
    await sb
      .from('integration_accounts')
      .update({
        status: 'error',
        last_error: (e as Error).message,
        updated_at: new Date().toISOString(),
      })
      .eq('provider', 'fieldnet')
    throw e
  }
}
