import type { SupabaseClient } from '@supabase/supabase-js'
import { bboxOf, logApiCall, MIN_PLAUSIBLE_SAMPLES, numOrNull } from './sat-ingest.ts'
import { ZONE_ALL } from './sat-daily.ts'

// Landsat 8/9 Collection 2 Level 2, via Microsoft Planetary Computer (spec §3.2).
//
// A different shape of service from Sentinel Hub: MPC is a STAC catalog with a
// TiTiler statistics endpoint bolted on, so the polygon goes in the request
// body as a GeoJSON Feature and the clipping happens server-side. No OAuth, no
// processing-unit budget, and MPC signs its own blobs — the only cost is
// politeness.
//
// Value, per the spec: 4 to 7 extra usable dates a season, landing on days
// Sentinel-2 misses. 30 m, so whole-field means and pasture always; within-field
// zones only above ~130 acres, where a 30 m pixel still means something.
//
// Three things this file exists to get right, each of which silently produces
// plausible wrong numbers instead of an error:

/**
 * Landsat Collection 2 surface reflectance is a SCALED INTEGER.
 *
 *   reflectance = DN × 0.0000275 − 0.2
 *
 * NDVI is invariant under a common scale factor but NOT under that offset, so
 * computing it from raw DN is simply a different number: this field on 29 July
 * reads 0.4230 from DN and 0.8204 scaled. The wrong one is not obviously wrong
 * — it sits in the range a struggling crop occupies, which is the worst place
 * for an error to land.
 *
 * The endpoint has an `unscale` parameter. It was tested and made no
 * difference to the result, so the arithmetic is done here where it can be
 * seen rather than trusted to a flag that silently no-ops.
 */
export const L2_SCALE = 0.0000275
export const L2_OFFSET = -0.2

const STAC_URL = 'https://planetarycomputer.microsoft.com/api/stac/v1/search'
const STATS_URL = 'https://planetarycomputer.microsoft.com/api/data/v1/item/statistics'

/**
 * NDVI on the true reflectance scale, expanded so the offset survives.
 *
 *   (sN − sR) / (sN + sR)  where sX = X·k + c
 *   = k(N − R) / (k(N + R) + 2c)
 */
export const NDVI_EXPRESSION =
  `${L2_SCALE}*(nir08-red)/(${L2_SCALE}*(nir08+red)${2 * L2_OFFSET})`

/**
 * The clear-sky test, written in the only syntax the endpoint accepts.
 *
 * The proper test is on QA_PIXEL's bits 1 to 4 — dilated cloud, cirrus, cloud,
 * cloud shadow — but the expression parser rejects bitwise operators, and
 * rejects adding two comparisons together. `where()` and a plain comparison
 * both work, so the test is a threshold instead: Collection 2 encodes clear
 * land as 21824 and clear water as 21952, and every cloud, shadow and snow
 * combination lands at 22080 or above. 22000 sits in the gap.
 */
export const CLEAR_EXPRESSION = 'where(qa_pixel<22000,1,0)'

export type LandsatItem = {
  id: string
  sensedOn: string
  datetime: string
  cloudPct: number | null
  platform: string
}

/** Landsat scenes over this field, best-quality tier only. */
export async function searchLandsatItems(
  bbox: [number, number, number, number],
  from: string,
  to: string,
): Promise<LandsatItem[]> {
  const res = await fetch(STAC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      collections: ['landsat-c2-l2'],
      bbox,
      datetime: `${from}T00:00:00Z/${to}T23:59:59Z`,
      limit: 50,
      query: {
        platform: { in: ['landsat-8', 'landsat-9'] },
        // Tier 2 is not geometrically registered well enough to lay a field
        // boundary over. A polygon that lands half a pixel off does not fail,
        // it just quietly averages the neighbour's crop in.
        'landsat:collection_category': { eq: 'T1' },
      },
    }),
  })
  if (!res.ok) throw new Error(`MPC STAC failed (${res.status}): ${(await res.text()).slice(0, 160)}`)
  const body = (await res.json()) as {
    features?: { id: string; properties?: Record<string, unknown> }[]
  }
  return (body.features ?? []).map((f) => {
    const dt = String(f.properties?.datetime ?? '')
    return {
      id: f.id,
      datetime: dt,
      sensedOn: dt.slice(0, 10),
      cloudPct: numOrNull(f.properties?.['eo:cloud_cover']),
      platform: String(f.properties?.platform ?? ''),
    }
  })
}

type TiTilerStats = {
  mean?: unknown
  std?: unknown
  valid_pixels?: unknown
  masked_pixels?: unknown
  percentile_10?: unknown
  percentile_90?: unknown
}

async function itemStatistics(
  item: string,
  assets: string[],
  expression: string,
  feature: unknown,
  percentiles = false,
): Promise<TiTilerStats | null> {
  const url = new URL(STATS_URL)
  url.searchParams.append('collection', 'landsat-c2-l2')
  url.searchParams.append('item', item)
  for (const a of assets) url.searchParams.append('assets', a)
  url.searchParams.append('asset_as_band', 'true')
  url.searchParams.append('expression', expression)
  if (percentiles) {
    url.searchParams.append('p', '10')
    url.searchParams.append('p', '90')
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(feature),
  })
  if (!res.ok) throw new Error(`MPC statistics failed (${res.status}): ${(await res.text()).slice(0, 160)}`)
  const body = (await res.json()) as { properties?: { statistics?: Record<string, TiTilerStats> } }
  const first = Object.values(body.properties?.statistics ?? {})[0]
  return first ?? null
}

export type LandsatStat = {
  ndvi: number | null
  clearFraction: number
  inPolygonPixels: number
}

/**
 * NDVI over the clear pixels of one field in one scene.
 *
 * The endpoint cannot be asked for "the mean over clear pixels": its
 * expression parser has no way to write a NaN, so cloudy pixels cannot be
 * turned into no-data. What it CAN do is arithmetic, and the mean of a product
 * is enough:
 *
 *   mean(clear)          = the fraction of the field that was clear
 *   mean(ndvi × clear)   = the sum of clear NDVI, over ALL pixels
 *   their ratio          = the mean NDVI over clear pixels alone
 *
 * Two requests instead of one. On a service with no processing-unit budget
 * that is the cheaper mistake to make.
 */
export async function fetchLandsatStat(item: string, feature: unknown): Promise<LandsatStat | null> {
  const clear = await itemStatistics(item, ['qa_pixel'], CLEAR_EXPRESSION, feature)
  if (!clear) return null
  const clearFraction = numOrNull(clear.mean) ?? 0
  // valid_pixels is the count INSIDE the polygon — TiTiler masks the rest of
  // the read window itself, which is why Landsat needs none of the geometric
  // floor discovery that Sentinel Hub's bounding-box counts force.
  const inPolygonPixels = numOrNull(clear.valid_pixels) ?? 0

  if (clearFraction <= 0) return { ndvi: null, clearFraction: 0, inPolygonPixels }

  const product = await itemStatistics(
    item,
    ['nir08', 'red', 'qa_pixel'],
    `(${NDVI_EXPRESSION})*${CLEAR_EXPRESSION}`,
    feature,
  )
  const productMean = numOrNull(product?.mean)
  return {
    ndvi: productMean == null ? null : productMean / clearFraction,
    clearFraction,
    inPolygonPixels,
  }
}

export type LandsatResult = { fields: number; scenes: number; observations: number; detail: string }

export async function runLandsatIngest(
  sb: SupabaseClient,
  opts: { days?: number; limitFields?: number; reprocess?: boolean; deadline?: number; subjectType?: 'field' | 'pasture' | 'pasture_zone' } = {},
): Promise<LandsatResult> {
  const days = opts.days ?? 14
  const to = new Date().toISOString().slice(0, 10)
  const from = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)

  // Fields and pastures differ only in which polygon table they come from; the
  // two functions return the same shape so one ingester serves both (§9.1 wants
  // whole-paddock statistics for pasture, which is exactly what this already
  // computes).
  const subjectType = opts.subjectType ?? 'field'
  const geometrySource =
    subjectType === 'pasture'
      ? 'sat_pasture_geometries'
      : subjectType === 'pasture_zone'
        ? 'sat_pasture_zone_geometries'
        : 'sat_field_geometries'
  const { data: subjects, error } = await sb.rpc(geometrySource, {
    p_limit: opts.limitFields ?? null,
  })
  if (error) return { fields: 0, scenes: 0, observations: 0, detail: error.message }
  if (!subjects?.length) return { fields: 0, scenes: 0, observations: 0, detail: 'no field geometries' }

  const scenesSeen = new Set<string>()
  let observations = 0
  const problems: string[] = []

  type Subject = { field_id: string; name: string; geojson: unknown; acres: number | null }

  let ranOutOfTime = 0
  for (const s of subjects as Subject[]) {
    // Stop cleanly rather than be killed mid-field. Netlify caps a function's
    // wall clock, and an ingest over every field can exceed it; the per-scene
    // skip means the next run resumes exactly where this one stopped, so a
    // partial pass costs a delay and never a gap.
    if (opts.deadline && Date.now() > opts.deadline) {
      ranOutOfTime++
      continue
    }
    try {
      const bbox = bboxOf(s.geojson as { coordinates: number[][][][] })
      if (!bbox) continue
      // MPC takes the polygon in lon/lat, so this is the one ingester that
      // wants the 4326 geometry rather than the projected one.
      const feature = { type: 'Feature', properties: {}, geometry: s.geojson }

      const items = await searchLandsatItems(bbox, from, to)
      await logApiCall(sb, 'stac-landsat', true, `${s.name}: ${items.length} items`)
      if (!items.length) continue

      let known = new Set<string>()
      if (!opts.reprocess) {
        const { data: have } = await sb
          .from('sat_observations')
          .select('sat_scenes!inner(scene_id)')
          .eq('subject_id', s.field_id)
          .eq('subject_type', subjectType)
        known = new Set(
          ((have ?? []) as unknown as { sat_scenes: { scene_id: string } }[]).map(
            (k) => k.sat_scenes?.scene_id,
          ),
        )
      }

      for (const item of items) {
        if (known.has(item.id)) {
          scenesSeen.add(item.id)
          continue
        }
        const stat = await fetchLandsatStat(item.id, feature)
        await logApiCall(sb, 'statistics-landsat', true, `${s.name} ${item.sensedOn}`)
        if (!stat) continue

        if (stat.inPolygonPixels < MIN_PLAUSIBLE_SAMPLES) {
          problems.push(
            `${s.name} ${item.sensedOn}: only ${stat.inPolygonPixels} pixels (${s.acres ?? '?'} ac)`,
          )
          continue
        }
        scenesSeen.add(item.id)

        const { data: sceneRow } = await sb
          .from('sat_scenes')
          .upsert(
            {
              provider: 'mpc',
              collection: 'landsat-c2-l2',
              scene_id: item.id,
              sensed_at: item.datetime,
              tile_cloud_pct: item.cloudPct,
            },
            { onConflict: 'provider,collection,scene_id' },
          )
          .select('id')
          .single()
        if (!sceneRow) continue

        const { error: obsErr } = await sb.from('sat_observations').upsert(
          {
            scene_id: sceneRow.id as string,
            subject_type: subjectType,
            subject_id: s.field_id,
            zone_id: ZONE_ALL,
            sensed_on: item.sensedOn,
            valid_fraction: Number(stat.clearFraction.toFixed(4)),
            quality:
              stat.clearFraction >= 0.9 ? 'full' : stat.clearFraction >= 0.6 ? 'partial' : 'rejected',
            // TiTiler already clipped to the polygon, so these counts need no
            // floor subtracted. sat_rescore_observations keeps its floor per
            // collection, and for this one it comes out at zero.
            sample_count: stat.inPolygonPixels,
            nodata_count: Math.round(stat.inPolygonPixels * (1 - stat.clearFraction)),
            resolution_m: 30,
            ndvi_mean: stat.ndvi,
            // The whole point of §4.5. Landsat sits on its own NDVI scale until
            // 15 same-day pairs exist to regress against Sentinel-2, and an
            // unharmonized value in the curve is a step artifact that reads as
            // a real event. Stored, scored, counted — but kept out of sat_daily.
            harmonized: false,
          },
          { onConflict: 'scene_id,subject_id,zone_id', ignoreDuplicates: false },
        )
        if (obsErr) {
          problems.push(`write ${s.name} ${item.sensedOn}: ${obsErr.message.slice(0, 80)}`)
          await logApiCall(sb, 'write-landsat', false, obsErr.message.slice(0, 200))
        } else {
          observations++
        }
      }
    } catch (e) {
      problems.push(`${s.name}: ${(e as Error).message.slice(0, 120)}`)
      await logApiCall(sb, 'field-landsat', false, (e as Error).message.slice(0, 200))
    }
  }

  return {
    fields: (subjects as unknown[]).length,
    scenes: scenesSeen.size,
    observations,
    detail:
      `landsat ${observations} observations over ${scenesSeen.size} scenes` +
      (ranOutOfTime ? ` (${ranOutOfTime} fields deferred)` : '') +
      (problems.length ? ` · ${problems.join('; ')}` : ''),
  }
}
