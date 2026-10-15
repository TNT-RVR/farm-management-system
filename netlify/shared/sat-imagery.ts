import type { SupabaseClient } from '@supabase/supabase-js'
import { bboxOf, getToken, logApiCall, numOrNull, unitsSpent } from './sat-ingest.ts'

// The most recent actual picture of each field.
//
// Every other output of this module is a number derived from an image nobody
// ever sees. A number you cannot check is one you end up either over-trusting
// or quietly ignoring, and this season is the argument: for two weeks the
// module reported healthy fields at NDVI 0.44 and the only way to know that was
// wrong was to reason about cloud probability bands. A picture would have shown
// it.
//
// §11.1 says "Statistical API only. Rasters only on alert." This is a
// deliberate departure, kept to the smallest shape that delivers the thing:
// ONE image per field, only for that field's newest full-quality scene, only
// fetched when that scene changes, cached in storage afterwards. A field
// photographed once a week costs one raster a week — not one per pass, and not
// one per person who opens the map.

const PROCESS_URL = 'https://sh.dataspace.copernicus.eu/api/v1/process'

/**
 * Output size, and the honest limit behind it.
 *
 * Sentinel-2's visible bands are 10 m. A 66-acre field is about 520 m across,
 * so there are only ~52 real pixels of information across it and NOTHING makes
 * that number larger — no output size, no resampling, no processing. Free
 * optical imagery cannot resolve an individual plant, a wheel track, or a
 * gopher mound, and any setting that appears to is inventing detail.
 *
 * What the size and the resampling below DO fix is the presentation: at 512
 * with nearest-neighbour the picture was a visible grid of hard squares, which
 * reads as a broken image rather than as a coarse one. 1024 with bicubic
 * upsampling renders the same information as a smooth photograph.
 */
export const IMAGE_SIZE = 1024

/**
 * True colour, tone-mapped, with the polygon carried in the alpha channel.
 *
 * Raw surface reflectance renders almost black: land reflects only a few per
 * cent in the visible bands, so a straight 0-1 mapping puts a wheat field at
 * pixel value 20. The previous fix was a flat multiply by 2.5, which brightens
 * the midtones and CLIPS everything above 0.4 reflectance to pure white — dry
 * stubble, gravel and roofs all became the same featureless patch.
 *
 * A ceiling plus a gamma curve instead. 0.25 is a comfortable upper bound for
 * vegetated ground in the visible bands, and the 1/2.2 exponent is the ordinary
 * sRGB-ish curve that displays expect, which is why the result looks like a
 * photograph rather than like data.
 *
 * All of this is DISPLAY only. Nothing measured passes through here — NDVI is
 * computed from raw reflectance in sat-ingest.ts and never from these numbers.
 *
 * dataMask goes to alpha so everything outside the boundary is transparent and
 * the basemap shows through. Without it the image is a rectangle over the
 * neighbours' ground, which invites reading their crop as yours.
 */
const TRUE_COLOUR_EVALSCRIPT = `//VERSION=3
function setup() {
  return {
    input: [{ bands: ["B02", "B03", "B04", "dataMask"] }],
    output: { bands: 4, sampleType: "AUTO" }
  };
}
var CEILING = 0.25;
function tone(v) {
  var x = v / CEILING;
  if (x < 0) x = 0;
  if (x > 1) x = 1;
  return Math.pow(x, 1 / 2.2);
}
function evaluatePixel(s) {
  return [tone(s.B04), tone(s.B03), tone(s.B02), s.dataMask];
}`

/**
 * NDVI as a per-pixel image, on the same ramp the legend uses.
 *
 * The point of this layer, and why one colour per field was not enough: a
 * field mean is a single number for eighty acres, and the whole reason to look
 * at a field from space is that it is NOT uniform. The sandy knoll, the
 * headland the sprayer missed, the corner the pivot never reaches — all of it
 * averages away into one shade of green.
 *
 * Rendered at Sentinel-2's native 10 m and drawn WITHOUT smoothing, unlike the
 * true-colour photograph. Smoothing a photograph is cosmetic; smoothing a data
 * layer invents intermediate values that were never measured, and the visible
 * pixel edges are an honest statement of how fine the measurement actually is.
 *
 * The cloud mask goes to alpha, so cloud and smoke are HOLES rather than
 * colour. A masked pixel painted any shade of the ramp is a reading nobody
 * took — this season, four dates in six would have been solid invented colour.
 */
/** A fallback scale for the case where nothing has been observed yet. */
export const DEFAULT_NDVI_SCALE = { lo: 0.15, hi: 0.95 }

/**
 * The same ramp, over the range NDRE actually occupies.
 *
 * Red edge does not run as high as red: this farm's fields read 0.10 to 0.68
 * where NDVI reads 0.2 to 0.9. Drawn on the NDVI scale a heavy canopy lands
 * mid-ramp and the whole point of the index — that it keeps separating growth
 * NDVI has flattened — is thrown away in the rendering.
 */
export const DEFAULT_NDRE_SCALE = { lo: 0.1, hi: 0.6 }

/**
 * How far the shared scale may drift before every raster has to be redrawn.
 *
 * Rasters rendered on different scales cannot be compared, which defeats the
 * whole reason for having one. When the farm's range moves past this, the
 * stored images are stale even though their scenes have not changed, and the
 * next run re-renders them.
 */
export const SCALE_DRIFT_TOLERANCE = 0.001

/**
 * The narrowest range a per-field stretch is allowed to cover.
 *
 * Stretching a field to its own p10-p90 is what reveals structure inside a
 * closed canopy. Taken literally it also stretches a field that really is
 * uniform — spread 0.004, say — across the whole ramp, turning sensor noise
 * into a vivid pattern that looks like a map of something. Below this the range
 * is widened around its midpoint instead, so a flat field still reads as flat.
 */
export const MIN_STRETCH_SPREAD = 0.06

/** The range to draw one field across, from its own percentiles. */
export function fieldScale(p10: number | null, p90: number | null, mean: number | null): NdviScale | null {
  const lo = p10 ?? null
  const hi = p90 ?? null
  if (lo == null || hi == null) {
    // No percentiles: fall back to a band around the mean rather than pretending
    // to know the spread.
    if (mean == null) return null
    return { lo: mean - MIN_STRETCH_SPREAD / 2, hi: mean + MIN_STRETCH_SPREAD / 2 }
  }
  const spread = hi - lo
  if (spread >= MIN_STRETCH_SPREAD) return { lo, hi }
  const mid = (lo + hi) / 2
  return { lo: mid - MIN_STRETCH_SPREAD / 2, hi: mid + MIN_STRETCH_SPREAD / 2 }
}

export type NdviScale = { lo: number; hi: number }

/** Whether an image drawn on `was` still matches the current scale. */
export function scaleMatches(
  was: { min: number | null; max: number | null },
  now: NdviScale,
): boolean {
  if (was.min == null || was.max == null) return false
  return (
    Math.abs(was.min - now.lo) <= SCALE_DRIFT_TOLERANCE &&
    Math.abs(was.max - now.hi) <= SCALE_DRIFT_TOLERANCE
  )
}

/**
 * `index` picks which band the near infrared is compared against: red for
 * NDVI, red edge for NDRE. Everything else — the ramp, the cloud mask, the
 * alpha holes — is identical, because the difference between the two maps
 * must be the measurement and not the rendering.
 */
const ndviRasterEvalscript = (lo: number, hi: number, index: 'ndvi' | 'ndre' = 'ndvi') => {
  // B05 is the red edge, B04 the red. Named once here rather than interpolated
  // twice inside the script, where a typo in one of the two would silently
  // produce an index computed against different bands top and bottom.
  const band = index === 'ndre' ? 'B05' : 'B04'
  return `//VERSION=3
function setup() {
  return {
    input: [{ bands: ["${band}", "B08", "SCL", "CLP", "dataMask"] }],
    output: { bands: 4, sampleType: "AUTO" }
  };
}
// The NDVI_RAMP colours from src/lib/pastures.ts, as 0-1 RGB — but positioned
// across THIS field's own range rather than at fixed NDVI values. A fixed ramp
// puts every pixel of a closed August canopy in the top bucket and renders the
// field as one flat colour, which is the field mean drawn at 10 m.
var COLOURS = [
  [161/255,  98/255,   7/255],
  [202/255, 138/255,   4/255],
  [163/255, 166/255,  53/255],
  [132/255, 204/255,  22/255],
  [ 77/255, 159/255,  14/255],
  [ 21/255, 128/255,  61/255],
  [ 20/255,  83/255,  45/255]
];
var LO = ${lo};
var HI = ${hi};
function shade(ndvi) {
  var t = (ndvi - LO) / (HI - LO);
  if (t < 0) t = 0;
  if (t > 1) t = 1;
  var i = Math.round(t * (COLOURS.length - 1));
  return COLOURS[i];
}
function evaluatePixel(s) {
  var bad = [0, 1, 3, 8, 9, 10, 11].indexOf(s.SCL) >= 0;
  var clp = s.CLP > 1 ? s.CLP / 255 : s.CLP;
  var valid = s.dataMask === 1 && !bad && clp <= ${0.4} ? 1 : 0;
  if (valid === 0) return [0, 0, 0, 0];
  var v = (s.B08 - s.${band}) / (s.B08 + s.${band});
  var c = shade(v);
  return [c[0], c[1], c[2], 1];
}`
}

/**
 * Output pixels for a bounding box, at Sentinel-2's real resolution.
 *
 * Asking for a fixed 1024 square would upsample a small field tenfold and
 * downsample a section-sized one, neither of which shows what was measured. A
 * typical 520 m field comes out at 52 x 52, which is exactly the number of real
 * Sentinel-2 pixels across it — drawn with nearest-neighbour, those are the
 * measurement itself rather than a rendering of it.
 *
 * The floor is deliberately low. An earlier 64-pixel minimum quietly upsampled
 * ordinary fields by a non-integer factor, which both invents detail and makes
 * the pixel grid visibly uneven. 16 only catches a degenerate box. The 2048
 * ceiling stops a section-sized paddock asking for an enormous image to
 * resolve detail the sensor never had.
 */
export function rasterSize(
  bbox: [number, number, number, number],
  metresPerPixel = 10,
): { width: number; height: number } {
  const midLat = ((bbox[1] + bbox[3]) / 2) * (Math.PI / 180)
  const mPerDegLat = 111_132
  const mPerDegLon = 111_320 * Math.cos(midLat)
  const widthM = (bbox[2] - bbox[0]) * mPerDegLon
  const heightM = (bbox[3] - bbox[1]) * mPerDegLat
  const clamp = (n: number) => Math.max(16, Math.min(2048, Math.round(n)))
  return { width: clamp(widthM / metresPerPixel), height: clamp(heightM / metresPerPixel) }
}

export type ImageryResult = { captured: number; skipped: number; detail: string }

/**
 * Capture the newest full-quality look for each field, once.
 *
 * "Once" is enforced by the unique index on (subject, scene, kind): a scene
 * already pictured is never re-requested, so running this daily costs nothing
 * on the days nothing new arrived — which, at a five-day revisit, is most days.
 */
export async function runImageryCapture(
  sb: SupabaseClient,
  opts: { limitFields?: number; deadline?: number; subjectType?: 'field' | 'pasture' } = {},
): Promise<ImageryResult> {
  // Fields and pastures differ only in which polygon table they come from; the
  // two functions return the same shape so one ingester serves both (§9.1 wants
  // whole-paddock statistics for pasture, which is exactly what this already
  // computes).
  const subjectType = opts.subjectType ?? 'field'
  const { data: subjects, error } = await sb.rpc(
    subjectType === 'pasture' ? 'sat_pasture_geometries' : 'sat_field_geometries',
    { p_limit: opts.limitFields ?? null },
  )
  if (error) return { captured: 0, skipped: 0, detail: error.message }
  if (!subjects?.length) return { captured: 0, skipped: 0, detail: 'no field geometries' }

  let token: string
  try {
    token = await getToken()
  } catch (e) {
    return { captured: 0, skipped: 0, detail: `token: ${(e as Error).message.slice(0, 120)}` }
  }

  // One scale for every raster in this run, so two fields can be compared by
  // colour. Read once: computing it per field would let it drift mid-run and
  // quietly put the last field on a different scale from the first.
  const { data: scaleRow } = await sb.from('sat_ndvi_scale').select('lo, hi').maybeSingle()
  const scale: NdviScale = scaleRow
    ? { lo: Number((scaleRow as { lo: number }).lo), hi: Number((scaleRow as { hi: number }).hi) }
    : DEFAULT_NDVI_SCALE

  let captured = 0
  let skipped = 0
  const problems: string[] = []

  type Subject = { field_id: string; name: string; geojson_display: unknown }

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
      // The newest clear Sentinel-2 look. Landsat is 30 m — fine for a number,
      // too coarse to be worth looking at — and radar is not a picture of
      // anything a person can read.
      const { data: obs } = await sb
        .from('sat_observations')
        .select('scene_id, sensed_on, ndvi_p10, ndvi_p90, ndvi_mean, sat_scenes!inner(collection)')
        .eq('subject_id', s.field_id)
        .eq('subject_type', subjectType)
        .eq('quality', 'full')
        .eq('sat_scenes.collection', 'sentinel-2-l2a')
        .order('sensed_on', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (!obs) continue
      const row = obs as unknown as {
        scene_id: string
        sensed_on: string
        ndvi_p10: number | string | null
        ndvi_p90: number | string | null
        ndvi_mean: number | string | null
      }

      const { data: existing } = await sb
        .from('sat_images')
        .select('kind, stretch_min, stretch_max')
        .eq('subject_id', s.field_id)
        .eq('scene_id', row.scene_id)
      const rows = (existing ?? []) as {
        kind: string
        stretch_min: number | null
        stretch_max: number | null
      }[]
      // An NDVI raster drawn on an older scale is stale even though its scene
      // has not changed — leaving it would put half the map on one scale and
      // half on another, which is the incomparability this is meant to remove.
      // Each NDVI kind is checked against the scale IT should be drawn on: the
      // shared one for 'ndvi', this field's own range for 'ndvi_field'. A
      // raster on a stale scale is stale even though its scene has not changed.
      const own = fieldScale(numOrNull(row.ndvi_p10), numOrNull(row.ndvi_p90), numOrNull(row.ndvi_mean))
      const have = new Set(
        rows
          .filter((e) => {
            const was = { min: numOrNull(e.stretch_min), max: numOrNull(e.stretch_max) }
            if (e.kind === 'ndvi') return scaleMatches(was, scale)
            if (e.kind === 'ndre') return scaleMatches(was, DEFAULT_NDRE_SCALE)
            if (e.kind === 'ndvi_field') return own != null && scaleMatches(was, own)
            return true
          })
          .map((e) => e.kind),
      )
      // Four images per scene: the photograph, NDVI on the farm's shared scale
      // (comparable between fields), NDVI stretched to this field's own range
      // (comparable only within itself), and NDRE.
      //
      // NDRE is a separate PICTURE, not a separate colour. Switching the index
      // used to change only the flat fill under the raster, which the raster
      // then covered — so the two maps were identical because they were the
      // same image. An index the eye cannot see is not an index.
      //
      // It renders on a fixed scale rather than a per-field one: NDRE exists to
      // be compared between fields late in the season, and stretching each
      // field to its own range would remove exactly that comparison.
      const wanted = (['truecolour', 'ndvi', 'ndvi_field', 'ndre'] as const)
        .filter((k) => !have.has(k))
        .filter((k) => k !== 'ndvi_field' || own != null)
      if (!wanted.length) {
        skipped++
        continue
      }

      // The DISPLAY boundary, not the analysis one. §4.4 buffers the analysis
      // polygon 15 m inward so edge pixels cannot bias a mean; cutting the
      // photograph to it too left a 50-foot blank margin inside every fence
      // line. The spec keeps both geometries for exactly this reason.
      const geom = s.geojson_display as { coordinates: number[][][][] }
      const bbox = bboxOf(geom)
      if (!bbox) continue

      for (const kind of wanted) {
      const isNdvi = kind !== 'truecolour'
      // NDVI renders at the sensor's real 10 m and is NOT smoothed: smoothing a
      // photograph is cosmetic, smoothing a data layer invents values nobody
      // measured. The photograph keeps its fixed size and bicubic.
      const size = isNdvi ? rasterSize(bbox) : { width: IMAGE_SIZE, height: IMAGE_SIZE }
      const bounds =
        kind === 'ndvi' ? scale : kind === 'ndre' ? DEFAULT_NDRE_SCALE : kind === 'ndvi_field' ? own : null

      const res = await fetch(PROCESS_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: {
            bounds: {
              geometry: geom,
              properties: { crs: 'http://www.opengis.net/def/crs/EPSG/0/4326' },
            },
            data: [
              {
                type: 'sentinel-2-l2a',
                dataFilter: {
                  // The exact day of the observation, so the picture and the
                  // number on the map are the same look at the same field.
                  timeRange: {
                    from: `${row.sensed_on}T00:00:00Z`,
                    to: `${row.sensed_on}T23:59:59Z`,
                  },
                  mosaickingOrder: 'leastCC',
                },
                // Bicubic for the photograph, where smoothing is cosmetic.
                // NEAREST for NDVI: a data layer must not show intermediate
                // values that were never measured.
                processing: isNdvi
                  ? { upsampling: 'NEAREST', downsampling: 'NEAREST' }
                  : { upsampling: 'BICUBIC', downsampling: 'BICUBIC' },
              },
            ],
          },
          output: {
            width: size.width,
            height: size.height,
            responses: [{ identifier: 'default', format: { type: 'image/png' } }],
          },
          evalscript: isNdvi
            ? ndviRasterEvalscript(bounds!.lo, bounds!.hi, kind === 'ndre' ? 'ndre' : 'ndvi')
            : TRUE_COLOUR_EVALSCRIPT,
        }),
      })
      if (!res.ok) {
        const msg = `${s.name} ${kind}: process ${res.status} ${(await res.text()).slice(0, 110)}`
        problems.push(msg)
        await logApiCall(sb, 'process', false, msg)
        continue
      }
      await logApiCall(sb, 'process', true, `${s.name} ${kind} ${row.sensed_on}`, unitsSpent(res))

      const bytes = new Uint8Array(await res.arrayBuffer())
      const path = `${subjectType}/${s.field_id}/${row.sensed_on}-${kind}.png`
      const { error: upErr } = await sb.storage
        .from('satellite-images')
        .upload(path, bytes, { contentType: 'image/png', upsert: true })
      if (upErr) {
        problems.push(`${s.name} ${kind}: upload ${upErr.message.slice(0, 80)}`)
        continue
      }

      const { error: rowErr } = await sb.from('sat_images').upsert(
        {
          subject_type: subjectType,
          subject_id: s.field_id,
          scene_id: row.scene_id,
          sensed_on: row.sensed_on,
          kind,
          storage_path: path,
          width: size.width,
          height: size.height,
          stretch_min: bounds ? Number(bounds.lo.toFixed(4)) : null,
          stretch_max: bounds ? Number(bounds.hi.toFixed(4)) : null,
          west: bbox[0],
          south: bbox[1],
          east: bbox[2],
          north: bbox[3],
        },
        { onConflict: 'subject_type,subject_id,scene_id,kind' },
      )
      if (rowErr) {
        problems.push(`${s.name} ${kind}: row ${rowErr.message.slice(0, 80)}`)
        continue
      }
      captured++
      }
    } catch (e) {
      problems.push(`${s.name}: ${(e as Error).message.slice(0, 100)}`)
    }
  }

  return {
    captured,
    skipped,
    detail:
      `imagery: ${captured} captured, ${skipped} already on file` +
      (ranOutOfTime ? ` (${ranOutOfTime} fields deferred)` : '') +
      (problems.length ? ` · ${problems.join('; ')}` : ''),
  }
}
