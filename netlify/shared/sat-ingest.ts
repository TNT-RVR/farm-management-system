import type { SupabaseClient } from '@supabase/supabase-js'

// Satellite ingestion, phase 1: Sentinel-2 NDVI for crop fields.
//
// The shape of the problem, and why the code looks like this:
//
// Satellites deliver irregular, cloud-interrupted looks — 12 to 22 usable ones
// per field per season in southern Alberta. Every observation is therefore
// precious AND suspect: precious because there are so few, suspect because a
// thin cloud can quietly halve an NDVI without looking like anything is wrong.
// So each reading is scored on the fraction of the polygon that was actually
// clear, and that fraction is stored beside the number rather than used to
// discard it silently.
//
// Cost discipline is structural, not a habit. The free tier is spent in
// processing units, so:
//   1. The catalog is asked FIRST — never request statistics for a date with no
//      scene over the field.
//   2. A scene-and-polygon pair is computed exactly once, enforced by a unique
//      index in the database rather than by remembering to check.
//   3. Every call is logged to sat_api_usage, so the allowance is a measured
//      number rather than a hope.

const TOKEN_URL =
  'https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token'
const CATALOG_URL = 'https://sh.dataspace.copernicus.eu/api/v1/catalog/1.0.0/search'
const STATS_URL = 'https://sh.dataspace.copernicus.eu/api/v1/statistics'

/**
 * The s2cloudless cloud-probability ceiling (spec §4.2).
 *
 * The spec calls this "the highest-leverage tunable in the whole pipeline" and
 * asks for it to be tuned against real fields during phase 2. It earned that
 * description on the first fortnight of real data: SCL passed four dates that
 * s2cloudless flagged, and on those dates NDVI read ~0.44 against ~0.88 on the
 * two dates both agreed were clear. Smoke, almost certainly — Sen2Cor does not
 * flag it and it depresses NDVI uniformly across a whole field, which is
 * indistinguishable from a crop in trouble unless something catches it here.
 *
 * Raising this number buys observations and pays for them in contamination.
 */
export const CLOUD_PROBABILITY_MAX = 0.4

/**
 * The evalscript run on Sentinel-2.
 *
 * dataMask is the load-bearing band. Sentinel Hub only counts a pixel toward
 * the statistics where the output mask is 1, so cloud, shadow, snow, saturated
 * and now high-cloud-probability pixels are excluded HERE, and the resulting
 * sample count tells us what fraction of the field was actually seen. Without
 * this the mean would silently include cloud tops, which read as a low NDVI and
 * look exactly like a crop in trouble.
 *
 * SCL classes excluded: 0 no-data, 1 saturated, 3 cloud shadow, 8 cloud medium,
 * 9 cloud high, 10 cirrus, 11 snow. Class 2 (dark area) and 7 (unclassified)
 * are kept — over bare soil in spring they are routinely misassigned and
 * dropping them would throw away most of April.
 */
const EVALSCRIPT = `//VERSION=3
function setup() {
  return {
    input: [{ bands: ["B03", "B04", "B05", "B08", "B11", "SCL", "CLP", "dataMask"] }],
    output: [
      { id: "ndvi", bands: 1, sampleType: "FLOAT32" },
      { id: "ndre", bands: 1, sampleType: "FLOAT32" },
      { id: "evi2", bands: 1, sampleType: "FLOAT32" },
      { id: "ndmi", bands: 1, sampleType: "FLOAT32" },
      { id: "clp", bands: 1, sampleType: "FLOAT32" },
      { id: "dataMask", bands: 1 }
    ]
  };
}
function evaluatePixel(s) {
  var bad = [0, 1, 3, 8, 9, 10, 11].indexOf(s.SCL) >= 0;
  // CLP is documented as 0-255 but arrives 0-1 under some band unit settings.
  // Normalising on the value itself is robust to both, and the ambiguous case
  // (exactly 1) resolves to "certainly cloud", which is the safe reading.
  var clp = s.CLP > 1 ? s.CLP / 255 : s.CLP;
  var hazy = clp > ${CLOUD_PROBABILITY_MAX};
  var valid = s.dataMask === 1 && !bad && !hazy ? 1 : 0;
  var ndvi = (s.B08 - s.B04) / (s.B08 + s.B04);
  var ndre = (s.B08 - s.B05) / (s.B08 + s.B05);
  var evi2 = 2.5 * (s.B08 - s.B04) / (s.B08 + 2.4 * s.B04 + 1.0);
  var ndmi = (s.B08 - s.B11) / (s.B08 + s.B11);
  return {
    ndvi: [ndvi], ndre: [ndre], evi2: [evi2], ndmi: [ndmi],
    clp: [clp], dataMask: [valid]
  };
}`

/** The growing season, inclusive. Outside it there is nothing under snow worth
 *  a daily look, so the cron drops to weekly rather than stopping — a February
 *  gap in the record is harder to explain later than a few wasted requests. */
export const SEASON_START = { month: 4, day: 15 }
export const SEASON_END = { month: 10, day: 31 }

export function inSeason(d: Date): boolean {
  const m = d.getUTCMonth() + 1
  const day = d.getUTCDate()
  if (m < SEASON_START.month || m > SEASON_END.month) return false
  if (m === SEASON_START.month && day < SEASON_START.day) return false
  if (m === SEASON_END.month && day > SEASON_END.day) return false
  return true
}

/**
 * Whether today's scheduled run should go ahead.
 *
 * Cron cannot express "15 April to 31 October" in one expression — a
 * day-of-month range applies to every listed month, so `15-30 4` really means
 * "April only", which is exactly the bug this replaces. So the schedule fires
 * daily year-round and the season lives here, where it can be tested.
 */
export function shouldRunToday(d: Date): boolean {
  if (inSeason(d)) return true
  // Off-season: Mondays only.
  return d.getUTCDay() === 1
}

export type IngestResult = {
  ok: boolean
  fields: number
  scenes: number
  observations: number
  detail: string
}

let cachedToken: { token: string; expiresAt: number } | null = null

/**
 * An access token, reused until it is nearly expired.
 *
 * CDSE tokens last an hour and the documentation asks that they be reused
 * rather than minted per request. Refreshed a minute early so a token cannot
 * expire mid-run.
 */
export async function getToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.token
  const id = process.env.CDSE_CLIENT_ID
  const secret = process.env.CDSE_CLIENT_SECRET
  if (!id || !secret) throw new Error('CDSE credentials are not set')

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: id,
      client_secret: secret,
    }),
  })
  if (!res.ok) {
    throw new Error(`CDSE token failed (${res.status}): ${(await res.text()).slice(0, 200)}`)
  }
  const body = (await res.json()) as { access_token: string; expires_in: number }
  cachedToken = {
    token: body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? 600) * 1000,
  }
  return cachedToken.token
}

type Bbox = [number, number, number, number]

/** The bounding box of a GeoJSON geometry, for the catalog query. */
export function bboxOf(geom: { coordinates: number[][][][] }): Bbox | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const poly of geom.coordinates ?? [])
    for (const ring of poly)
      for (const [x, y] of ring) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
  return Number.isFinite(minX) ? [minX, minY, maxX, maxY] : null
}

export type Scene = { id: string; sensedAt: string; cloudPct: number | null }

/**
 * Which scenes actually cover this field in the window.
 *
 * Asked before anything else, every time. A statistics request for a date with
 * no scene costs a processing unit and returns nothing, and the free tier is
 * small enough that the wasted ones matter.
 */
export async function searchScenes(
  token: string,
  bbox: Bbox,
  from: string,
  to: string,
  maxCloud = 80,
): Promise<Scene[]> {
  const res = await fetch(CATALOG_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      collections: ['sentinel-2-l2a'],
      bbox,
      datetime: `${from}T00:00:00Z/${to}T23:59:59Z`,
      limit: 100,
      // A tile can be 80% cloud and the field still clear; the per-field mask
      // decides. This only skips the hopeless ones.
      filter: { op: '<=', args: [{ property: 'eo:cloud_cover' }, maxCloud] },
      'filter-lang': 'cql2-json',
    }),
  })
  if (!res.ok) throw new Error(`CDSE catalog failed (${res.status})`)
  const body = (await res.json()) as {
    features?: { id: string; properties?: Record<string, unknown> }[]
  }
  return (body.features ?? []).map((f) => ({
    id: f.id,
    sensedAt: String(f.properties?.datetime ?? ''),
    cloudPct:
      typeof f.properties?.['eo:cloud_cover'] === 'number'
        ? (f.properties['eo:cloud_cover'] as number)
        : null,
  }))
}

export type Stat = {
  sensedOn: string
  validFraction: number
  sampleCount: number
  noDataCount: number
  ndviMean: number | null
  ndviStd: number | null
  ndviP10: number | null
  ndviP90: number | null
  ndreMean: number | null
  evi2Mean: number | null
  ndmiMean: number | null
  raw: unknown
}

/**
 * A number, or null — never NaN.
 *
 * Sentinel Hub returns the JSON *string* `"NaN"` for a band whose pixels were
 * all masked out, and Postgres happily accepts 'NaN' into a numeric column.
 * The first run stored six of them, and a single NaN poisons every average
 * taken over the column afterwards. A fully-clouded look has no mean; null is
 * the way to say that.
 */
export function numOrNull(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

/**
 * The smallest pixel count a real field can plausibly produce.
 *
 * The 46-acre field in the phase 1 set is ~1,900 pixels at 10 m; the smallest
 * thing we would ever point this at is still hundreds. A response below this
 * means the request was misconfigured, not that the field is small — which is
 * exactly what happened when the resolution was read as degrees and every
 * field came back as one pixel. Failing loudly here is the difference between
 * noticing that in the first run and shipping it.
 */
export const MIN_PLAUSIBLE_SAMPLES = 50

/**
 * How clear a look has to be before its mean means anything (spec §4.3).
 *
 * These were 0.80 and 0.30, on the reasoning that 12–22 observations a season
 * is too few to throw one away. The spec sets 0.90 and 0.60 and gives the
 * reason: a partial look is usable for the FIELD MEAN but not for comparing
 * zones, because the baseline it would be compared against is itself
 * incomplete. Below 0.60 the record is kept for audit — so that at season end
 * the free-versus-paid-imagery decision is made on evidence — but excluded
 * from analysis. A mean over 30 % of a field is a number about cloud.
 *
 * Keeping the rejected rows is what makes the stricter threshold affordable:
 * nothing is lost, it is just not allowed to drive a colour or an alert.
 */
export const FULL_QUALITY = 0.9
export const PARTIAL_QUALITY = 0.6

export function scoreQuality(validFraction: number): 'full' | 'partial' | 'rejected' {
  if (validFraction >= FULL_QUALITY) return 'full'
  if (validFraction >= PARTIAL_QUALITY) return 'partial'
  return 'rejected'
}

/**
 * Zonal statistics for one polygon over a date range.
 *
 * The geometry must arrive in a METRIC CRS — its UTM zone — and `srid` must say
 * which. Sentinel Hub reads `resx`/`resy` in the units of the CRS the bounds
 * are declared in, so passing a lon/lat polygon alongside `resx: 10` asks for
 * ten-degree pixels and returns a single one for the whole field. That is not a
 * hypothetical: it is what the first run did, and the resulting means, standard
 * deviations and percentiles were all the same one meaningless number.
 *
 * The valid fraction is derived from the sample counts Sentinel Hub returns:
 * `sampleCount` is every pixel considered, `noDataCount` is those the mask
 * excluded. Their ratio is the honest answer to "how much of this field did we
 * actually see", and it is stored rather than used to silently drop the reading.
 */
export async function fetchStats(
  token: string,
  geometry: unknown,
  srid: number,
  from: string,
  to: string,
): Promise<{ days: Stat[]; units: number | null }> {
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
            type: 'sentinel-2-l2a',
            dataFilter: { mosaickingOrder: 'leastCC' },
          },
        ],
      },
      aggregation: {
        timeRange: { from: `${from}T00:00:00Z`, to: `${to}T23:59:59Z` },
        aggregationInterval: { of: 'P1D' },
        // 10 m, Sentinel-2's native resolution for the red and NIR bands.
        resx: 10,
        resy: 10,
        evalscript: EVALSCRIPT,
      },
      calculations: { ndvi: { statistics: { default: { percentiles: { k: [10, 90] } } } } },
    }),
  })
  if (!res.ok) throw new Error(`CDSE statistics failed (${res.status}): ${(await res.text()).slice(0, 200)}`)

  type BandStats = {
    mean?: unknown
    stDev?: unknown
    sampleCount?: unknown
    noDataCount?: unknown
    // Percentiles come back NESTED under their own object, keyed by the
    // requested value as a string — not as flat `percentile_10.0` keys. Phase 1
    // read the flat form, so p10 and p90 were silently null on every row while
    // the numbers sat in raw_stats all along.
    percentiles?: Record<string, unknown>
  }
  const body = (await res.json()) as {
    data?: {
      interval?: { from?: string }
      outputs?: Record<string, { bands?: Record<string, { stats?: BandStats }> }>
    }[]
  }

  const out: Stat[] = []
  for (const d of body.data ?? []) {
    const day = (d.interval?.from ?? '').slice(0, 10)
    const band = (id: string) => d.outputs?.[id]?.bands?.B0?.stats
    const ndvi = band('ndvi')
    if (!day || !ndvi) continue
    const sample = numOrNull(ndvi.sampleCount) ?? 0
    const noData = numOrNull(ndvi.noDataCount) ?? 0
    const validFraction = sample > 0 ? (sample - noData) / sample : 0
    out.push({
      sensedOn: day,
      validFraction,
      sampleCount: sample,
      noDataCount: noData,
      ndviMean: numOrNull(ndvi.mean),
      ndviStd: numOrNull(ndvi.stDev),
      ndviP10: numOrNull(ndvi.percentiles?.['10.0']),
      ndviP90: numOrNull(ndvi.percentiles?.['90.0']),
      ndreMean: numOrNull(band('ndre')?.mean),
      evi2Mean: numOrNull(band('evi2')?.mean),
      ndmiMean: numOrNull(band('ndmi')?.mean),
      raw: d.outputs,
    })
  }
  return { days: out, units: unitsSpent(res) }
}

/** Note an API call, so the free allowance stays a measured number. */
export async function logApiCall(
  sb: SupabaseClient,
  endpoint: string,
  ok: boolean,
  detail?: string,
  units?: number | null,
): Promise<void> {
  await sb.from('sat_api_usage').insert({
    provider: 'cdse',
    endpoint,
    ok,
    detail: detail ?? null,
    processing_units: units ?? null,
  })
}

/**
 * What a request actually cost, off the response.
 *
 * Sentinel Hub returns the processing units it charged in a header. The column
 * to hold it has been there since the table was created and has been null on
 * every row, so the only way to know what this pipeline costs was to read
 * somebody's billing dashboard — which is no use for deciding whether a plan is
 * big enough BEFORE buying it.
 *
 * Null where the header is absent rather than zero: a request whose cost is
 * unknown must not be summed as free.
 */
export function unitsSpent(res: Response): number | null {
  const raw =
    res.headers.get('x-processingunits-spent') ?? res.headers.get('X-ProcessingUnits-Spent')
  if (!raw) return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

/**
 * Sentinel-2 over crop fields.
 *
 * `limitFields` existed because the spec says to prove this on three real
 * fields before pointing it at everything. That test has now passed — 5 usable
 * looks per field per fortnight, valid fractions that track the sky, and two
 * sensors agreeing on the same canopy — so it defaults to every
 * satellite-enabled field and the cap is only there for debugging.
 */
export async function runSatelliteIngest(
  sb: SupabaseClient,
  opts: { days?: number; limitFields?: number; reprocess?: boolean; deadline?: number; subjectType?: 'field' | 'pasture' | 'pasture_zone' | 'n_strip' } = {},
): Promise<IngestResult> {
  if (process.env.SAT_INGEST_ENABLED !== 'true') {
    return { ok: false, fields: 0, scenes: 0, observations: 0, detail: 'SAT_INGEST_ENABLED is not true' }
  }
  const days = opts.days ?? 14
  const to = new Date().toISOString().slice(0, 10)
  const from = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)

  // The analysis boundary, as GeoJSON, for the newest crop year we hold.
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
        : subjectType === 'n_strip'
          ? 'sat_n_strip_geometries'
          : 'sat_field_geometries'
  const { data: subjects, error } = await sb.rpc(geometrySource, {
    p_limit: opts.limitFields ?? null,
  })
  if (error) return { ok: false, fields: 0, scenes: 0, observations: 0, detail: error.message }
  if (!subjects?.length) {
    return { ok: false, fields: 0, scenes: 0, observations: 0, detail: 'no field geometries' }
  }

  let token: string
  try {
    token = await getToken()
    await logApiCall(sb, 'token', true)
  } catch (e) {
    await logApiCall(sb, 'token', false, (e as Error).message)
    return { ok: false, fields: 0, scenes: 0, observations: 0, detail: (e as Error).message }
  }

  // Distinct scenes, not scene-field pairs. The first run reported "18 scenes"
  // for six, because it counted once per field per scene.
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
      const geom = s.geojson as { coordinates: number[][][][] }
      const bbox = bboxOf(geom)
      if (!bbox) continue

      const scenes = await searchScenes(token, bbox, from, to)
      await logApiCall(sb, 'catalog', true, `${s.name}: ${scenes.length} scenes`)
      if (scenes.length === 0) continue

      // Spec §11.4: a scene-and-polygon pair is computed exactly once. The
      // unique index alone does not achieve that — it drops the duplicate ROW
      // after the statistics request has already been paid for. A daily run
      // over a 14-day window was therefore re-buying two weeks of processing
      // units every morning to write one new observation.
      //
      // `reprocess` is the deliberate override, for when the mask itself has
      // changed and the stored numbers are worth recomputing.
      if (!opts.reprocess) {
        const { data: known } = await sb
          .from('sat_observations')
          .select('scene_id, sat_scenes!inner(scene_id)')
          .eq('subject_id', s.field_id)
          .eq('subject_type', subjectType)
        const havePairs = new Set(
          ((known ?? []) as unknown as { sat_scenes: { scene_id: string } }[]).map(
            (k) => k.sat_scenes?.scene_id,
          ),
        )
        if (scenes.every((sc) => havePairs.has(sc.id))) {
          await logApiCall(sb, 'skip', true, `${s.name}: all ${scenes.length} scenes already computed`)
          for (const sc of scenes) scenesSeen.add(sc.id)
          continue
        }
      }

      // Statistics run on the projected polygon, so resx/resy mean metres.
      const { days: stats, units } = await fetchStats(token, s.geojson_utm, s.utm_srid, from, to)
      await logApiCall(sb, 'statistics', true, `${s.name}: ${stats.length} days`, units)

      // If the API sampled a handful of pixels, the request was wrong and the
      // numbers are meaningless. Write nothing for this field rather than fill
      // the table with plausible-looking noise.
      const biggest = Math.max(0, ...stats.map((x) => x.sampleCount))
      if (stats.length && biggest < MIN_PLAUSIBLE_SAMPLES) {
        const msg = `${s.name}: only ${biggest} pixels sampled (${s.acres ?? '?'} ac) — check CRS/resolution`
        problems.push(msg)
        await logApiCall(sb, 'statistics', false, msg)
        continue
      }

      for (const st of stats) {
        // The catalog scene for this day, so the observation is tied to a real
        // scene rather than to a date.
        const scene = scenes.find((x) => x.sensedAt.slice(0, 10) === st.sensedOn)
        if (!scene) continue
        scenesSeen.add(scene.id)

        const { data: sceneRow } = await sb
          .from('sat_scenes')
          .upsert(
            {
              provider: 'cdse',
              collection: 'sentinel-2-l2a',
              scene_id: scene.id,
              sensed_at: scene.sensedAt,
              tile_cloud_pct: scene.cloudPct,
            },
            { onConflict: 'provider,collection,scene_id' },
          )
          .select('id')
          .single()
        if (!sceneRow) continue

        const quality = scoreQuality(st.validFraction)
        const { error: obsErr } = await sb.from('sat_observations').upsert(
          {
            scene_id: sceneRow.id as string,
            subject_type: subjectType,
            subject_id: s.field_id,
            // The all-zero uuid is the whole-subject case. NULL cannot be an
            // on_conflict target, which is what broke the first run.
            zone_id: '00000000-0000-0000-0000-000000000000',
            sensed_on: st.sensedOn,
            // Provisional. Both raw counts are stored because the honest
            // denominator is not known from one observation: the masked count
            // includes every pixel outside the polygon as well as every pixel
            // under cloud, and only the field's clearest look separates them.
            // sat_rescore_observations() fixes these up below.
            valid_fraction: Number(st.validFraction.toFixed(4)),
            quality,
            sample_count: st.sampleCount,
            nodata_count: st.noDataCount,
            ndvi_mean: st.ndviMean,
            ndvi_stddev: st.ndviStd,
            ndvi_p10: st.ndviP10,
            ndvi_p90: st.ndviP90,
            ndre_mean: st.ndreMean,
            evi2_mean: st.evi2Mean,
            ndmi_mean: st.ndmiMean,
            raw_stats: st.raw as never,
          },
          // Update rather than ignore: when the mask improves, the stored
          // numbers for a scene we have already seen are wrong, not redundant.
          // Skipping the API call is how cost is controlled (above); throwing
          // away a better answer we have already paid for is not.
          { onConflict: 'scene_id,subject_id,zone_id', ignoreDuplicates: false },
        )
        if (obsErr) {
          // Never silent. Counting a failed write as "no observation" is how the
          // first run reported 18 scenes and 0 observations and read as a cloudy
          // fortnight — when in fact every insert was being rejected.
          problems.push(`write ${s.name} ${st.sensedOn}: ${obsErr.message.slice(0, 90)}`)
          await logApiCall(sb, 'write', false, obsErr.message.slice(0, 200))
        } else {
          observations++
        }
      }
    } catch (e) {
      problems.push(`${s.name}: ${(e as Error).message.slice(0, 120)}`)
      await logApiCall(sb, 'field', false, (e as Error).message.slice(0, 200))
    }
  }

  // Scoring and the daily rebuild deliberately do NOT happen here. Radar has
  // to land first — a quiet radar record across an optical gap changes the
  // confidence written into sat_daily — so the order lives in sat-run.ts,
  // where both sensors are in view.
  return {
    ok: problems.length < (subjects as unknown[]).length,
    fields: (subjects as unknown[]).length,
    scenes: scenesSeen.size,
    observations,
    detail:
      `${from}..${to}: ${observations} optical observations over ${(subjects as unknown[]).length} fields` +
      (ranOutOfTime ? ` (${ranOutOfTime} fields left for the next run — out of time)` : '') +
      (problems.length ? ` · ${problems.join('; ')}` : ''),
  }
}
