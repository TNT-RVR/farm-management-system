import type { SupabaseClient } from '@supabase/supabase-js'
import { bboxOf, getToken, logApiCall, MIN_PLAUSIBLE_SAMPLES, numOrNull } from './sat-ingest.ts'
import { ZONE_ALL } from './sat-daily.ts'

// Sentinel-1 SAR (spec §3.3) — the answer to the wet-stretch blind spot, and
// this season, to the smoke.
//
// Radar sees through cloud, haze and smoke, and does not care whether the sun
// is up. In a fortnight where s2cloudless rejected five of six optical looks,
// it is the only sensor still reporting.
//
// What it is NOT for, and the spec is blunt about this: radar is noisy, and no
// NDVI-equivalent vegetation value may be derived from it. Nothing here writes
// to ndvi_mean or reaches the NDVI ramp. It answers exactly two questions:
//
//   1. Did this field change dramatically while the optical record was blind?
//      A quiet radar record across a gap is evidence the interpolated curve is
//      not hiding an event, and raises confidence in it — never to 'high',
//      because "nothing dramatic happened" is not a measurement of the canopy.
//   2. Surface soil moisture trend, for the irrigation water balance. That is
//      phase 4 and is not wired up here.
//
// Two things that would quietly corrupt the series if ignored:
//
// ORBIT DIRECTION. Ascending and descending passes view the field at different
// incidence angles, and the backscatter difference between them is larger than
// most real events. A mixed series has steps in it that no ground event
// produced — the same failure the spec warns about for unharmonized optical
// sensors. So each direction is requested and stored separately, and the
// change view compares like with like.
//
// AVERAGING IN THE WRONG DOMAIN. Backscatter is a power ratio. The mean of a
// field must be taken in LINEAR power and converted to decibels afterwards;
// averaging decibels directly gives the log of a geometric mean, which is
// systematically low and gets worse as the field gets more variable. So the
// evalscript emits linear power and the conversion happens here, once.

const STATS_URL = 'https://sh.dataspace.copernicus.eu/api/v1/statistics'
const CATALOG_URL = 'https://sh.dataspace.copernicus.eu/api/v1/catalog/1.0.0/search'

/**
 * 20 m, not 10 m.
 *
 * Sentinel-1 IW GRD has a true resolution near 20 m and is merely *sampled* at
 * 10 m. Asking for 10 m would quadruple the processing units spent to
 * resolve detail the sensor never captured.
 */
export const RADAR_RESOLUTION_M = 20

const EVALSCRIPT = `//VERSION=3
function setup() {
  return {
    input: [{ bands: ["VV", "VH", "dataMask"] }],
    output: [
      { id: "vv", bands: 1, sampleType: "FLOAT32" },
      { id: "vh", bands: 1, sampleType: "FLOAT32" },
      { id: "dataMask", bands: 1 }
    ]
  };
}
function evaluatePixel(s) {
  // Linear power out. The decibel conversion happens after the spatial mean,
  // never before it.
  return { vv: [s.VV], vh: [s.VH], dataMask: [s.dataMask] };
}`

export type OrbitDirection = 'ASCENDING' | 'DESCENDING'

/** Linear power to decibels. Null where the mean is not a positive power. */
export function toDecibels(linear: number | null): number | null {
  if (linear == null || !Number.isFinite(linear) || linear <= 0) return null
  return Math.round(10 * Math.log10(linear) * 1000) / 1000
}

export type RadarScene = { id: string; sensedAt: string; orbit: OrbitDirection }

/** Which radar scenes cover this field, and from which pass. */
export async function searchRadarScenes(
  token: string,
  bbox: [number, number, number, number],
  from: string,
  to: string,
): Promise<RadarScene[]> {
  const res = await fetch(CATALOG_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      collections: ['sentinel-1-grd'],
      bbox,
      datetime: `${from}T00:00:00Z/${to}T23:59:59Z`,
      limit: 100,
    }),
  })
  if (!res.ok) throw new Error(`CDSE radar catalog failed (${res.status})`)
  const body = (await res.json()) as {
    features?: { id: string; properties?: Record<string, unknown> }[]
  }
  return (body.features ?? []).flatMap((f) => {
    const state = String(f.properties?.['sat:orbit_state'] ?? '').toUpperCase()
    // An unlabelled pass cannot be placed in either series without risking a
    // step artifact, so it is dropped rather than guessed at.
    if (state !== 'ASCENDING' && state !== 'DESCENDING') return []
    return [{ id: f.id, sensedAt: String(f.properties?.datetime ?? ''), orbit: state }]
  })
}

export type RadarStat = {
  sensedOn: string
  vvDb: number | null
  vhDb: number | null
  sampleCount: number
  noDataCount: number
  raw: unknown
}

/**
 * Backscatter statistics for one polygon, from one orbit direction.
 *
 * GAMMA0 with terrain correction rather than raw sigma0: the fields sit on the
 * river break south of Taber and slope enough that uncorrected backscatter
 * carries the hillside in it. Orthorectification against the Copernicus DEM is
 * what makes one date comparable to the next.
 */
export async function fetchRadarStats(
  token: string,
  geometry: unknown,
  srid: number,
  orbit: OrbitDirection,
  from: string,
  to: string,
): Promise<RadarStat[]> {
  const res = await fetch(STATS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input: {
        bounds: {
          geometry,
          properties: { crs: `http://www.opengis.net/def/crs/EPSG/0/${srid}` },
        },
        data: [
          {
            type: 'sentinel-1-grd',
            dataFilter: {
              acquisitionMode: 'IW',
              polarization: 'DV',
              orbitDirection: orbit,
            },
            processing: {
              backCoeff: 'GAMMA0_TERRAIN',
              orthorectify: true,
              demInstance: 'COPERNICUS',
            },
          },
        ],
      },
      aggregation: {
        timeRange: { from: `${from}T00:00:00Z`, to: `${to}T23:59:59Z` },
        aggregationInterval: { of: 'P1D' },
        resx: RADAR_RESOLUTION_M,
        resy: RADAR_RESOLUTION_M,
        evalscript: EVALSCRIPT,
      },
    }),
  })
  if (!res.ok) {
    throw new Error(`CDSE radar statistics failed (${res.status}): ${(await res.text()).slice(0, 200)}`)
  }

  type BandStats = { mean?: unknown; sampleCount?: unknown; noDataCount?: unknown }
  const body = (await res.json()) as {
    data?: {
      interval?: { from?: string }
      outputs?: Record<string, { bands?: Record<string, { stats?: BandStats }> }>
    }[]
  }

  const out: RadarStat[] = []
  for (const d of body.data ?? []) {
    const day = (d.interval?.from ?? '').slice(0, 10)
    const band = (id: string) => d.outputs?.[id]?.bands?.B0?.stats
    const vv = band('vv')
    if (!day || !vv) continue
    out.push({
      sensedOn: day,
      vvDb: toDecibels(numOrNull(vv.mean)),
      vhDb: toDecibels(numOrNull(band('vh')?.mean)),
      sampleCount: numOrNull(vv.sampleCount) ?? 0,
      noDataCount: numOrNull(vv.noDataCount) ?? 0,
      raw: d.outputs,
    })
  }
  return out
}

export type RadarResult = { fields: number; scenes: number; observations: number; detail: string }

/**
 * Phase 2 radar run.
 *
 * Shares the token, the geometry function and the cost discipline of the
 * optical ingest, and writes into the same sat_observations table — the schema
 * was built sensor-agnostic (spec §3.4 asks for exactly that) and s1_vv_mean /
 * s1_vh_mean were already there waiting.
 */
export async function runRadarIngest(
  sb: SupabaseClient,
  opts: { days?: number; limitFields?: number; reprocess?: boolean; deadline?: number; subjectType?: 'field' | 'pasture' } = {},
): Promise<RadarResult> {
  const days = opts.days ?? 14
  const to = new Date().toISOString().slice(0, 10)
  const from = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)

  // Fields and pastures differ only in which polygon table they come from; the
  // two functions return the same shape so one ingester serves both (§9.1 wants
  // whole-paddock statistics for pasture, which is exactly what this already
  // computes).
  const subjectType = opts.subjectType ?? 'field'
  const { data: subjects, error } = await sb.rpc(
    subjectType === 'pasture' ? 'sat_pasture_geometries' : 'sat_field_geometries',
    { p_limit: opts.limitFields ?? null },
  )
  if (error) return { fields: 0, scenes: 0, observations: 0, detail: error.message }
  if (!subjects?.length) return { fields: 0, scenes: 0, observations: 0, detail: 'no field geometries' }

  const token = await getToken()
  const scenesSeen = new Set<string>()
  let observations = 0
  const problems: string[] = []

  type Subject = {
    field_id: string
    name: string
    geojson: unknown
    geojson_utm: unknown
    utm_srid: number
    acres: number | null
  }

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

      const scenes = await searchRadarScenes(token, bbox, from, to)
      await logApiCall(sb, 'catalog-s1', true, `${s.name}: ${scenes.length} radar scenes`)
      if (!scenes.length) continue

      // One request per orbit direction present. Asking for both at once lets
      // Sentinel Hub mosaic across incidence angles, which is the one thing
      // this must not do.
      const directions = [...new Set(scenes.map((x) => x.orbit))]
      for (const orbit of directions) {
        const inDirection = scenes.filter((x) => x.orbit === orbit)

        if (!opts.reprocess) {
          const { data: known } = await sb
            .from('sat_observations')
            .select('sat_scenes!inner(scene_id)')
            .eq('subject_id', s.field_id)
            .eq('subject_type', subjectType)
          const have = new Set(
            ((known ?? []) as unknown as { sat_scenes: { scene_id: string } }[]).map(
              (k) => k.sat_scenes?.scene_id,
            ),
          )
          if (inDirection.every((sc) => have.has(sc.id))) {
            for (const sc of inDirection) scenesSeen.add(sc.id)
            continue
          }
        }

        const stats = await fetchRadarStats(token, s.geojson_utm, s.utm_srid, orbit, from, to)
        await logApiCall(sb, 'statistics-s1', true, `${s.name} ${orbit}: ${stats.length} days`)

        const biggest = Math.max(0, ...stats.map((x) => x.sampleCount))
        if (stats.length && biggest < MIN_PLAUSIBLE_SAMPLES) {
          const msg = `${s.name} ${orbit}: only ${biggest} pixels — check CRS/resolution`
          problems.push(msg)
          await logApiCall(sb, 'statistics-s1', false, msg)
          continue
        }

        for (const st of stats) {
          const scene = inDirection.find((x) => x.sensedAt.slice(0, 10) === st.sensedOn)
          if (!scene) continue
          scenesSeen.add(scene.id)

          const { data: sceneRow } = await sb
            .from('sat_scenes')
            .upsert(
              {
                provider: 'cdse',
                collection: 'sentinel-1-grd',
                scene_id: scene.id,
                sensed_at: scene.sensedAt,
                orbit_direction: orbit,
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
              sensed_on: st.sensedOn,
              // Radar has no cloud to see through, so the only thing masked is
              // the polygon's own shape. sat_rescore_observations turns these
              // counts into a valid fraction against a floor kept separately
              // per collection.
              valid_fraction: 1,
              quality: 'full',
              sample_count: st.sampleCount,
              nodata_count: st.noDataCount,
              resolution_m: RADAR_RESOLUTION_M,
              s1_vv_mean: st.vvDb,
              s1_vh_mean: st.vhDb,
              // ndvi_mean stays null. Radar is not a vegetation index (§3.3).
              raw_stats: st.raw as never,
            },
            { onConflict: 'scene_id,subject_id,zone_id', ignoreDuplicates: false },
          )
          if (obsErr) {
            problems.push(`write ${s.name} ${st.sensedOn}: ${obsErr.message.slice(0, 80)}`)
            await logApiCall(sb, 'write-s1', false, obsErr.message.slice(0, 200))
          } else {
            observations++
          }
        }
      }
    } catch (e) {
      problems.push(`${s.name}: ${(e as Error).message.slice(0, 120)}`)
      await logApiCall(sb, 'field-s1', false, (e as Error).message.slice(0, 200))
    }
  }

  return {
    fields: (subjects as unknown[]).length,
    scenes: scenesSeen.size,
    observations,
    detail: `radar ${observations} observations over ${scenesSeen.size} scenes` +
      (ranOutOfTime ? ` (${ranOutOfTime} fields deferred)` : '') +
      (problems.length ? ` · ${problems.join('; ')}` : ''),
  }
}
