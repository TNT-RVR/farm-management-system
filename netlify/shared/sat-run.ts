import type { SupabaseClient } from '@supabase/supabase-js'
import { logApiCall, runSatelliteIngest, FULL_QUALITY, PARTIAL_QUALITY } from './sat-ingest.ts'
import { runRadarIngest } from './sat-radar.ts'
import { runLandsatIngest } from './sat-landsat.ts'
import { rebuildDaily } from './sat-daily.ts'
import { runAlertDetection } from './sat-alerts.ts'
import { runCattleAlerts } from './sat-cattle-alerts.ts'
import { runHarmonization } from './sat-harmonize.ts'
import { runImageryCapture } from './sat-imagery.ts'

// One satellite run, in the order the steps actually depend on each other.
//
// The order is not arbitrary and getting it wrong is silent:
//
//   1. Optical (Sentinel-2). NDVI and the vegetation indices.
//   2. Radar (Sentinel-1). Cloud-proof, and this season smoke-proof — the only
//      sensor still reporting through four of the fortnight's six dates.
//   2b. Landsat, on a different provider, so a CDSE outage does not stop it.
//   3. Rescore. The valid fraction of an observation depends on the clearest
//      look that field has EVER had, because that is what separates the pixels
//      masked by the polygon's shape from the pixels masked by weather. A
//      clearer look arriving today therefore regrades observations from weeks
//      ago, and the grade decides what the curve is fitted through.
//   3b. Harmonize. Landsat does not report the same NDVI as Sentinel-2 over the
//      same canopy, and the curve reads the harmonized value, not the raw one.
//   4. Rebuild the daily series. Reads the grades from step 3, the scale from
//      step 3b and the radar from step 2, so it has to be last.
//   5. Anomalies, against the finished series.
//
// Run 4 before 2 and every gap looks unwatched. Run 4 before 3 and the curve is
// fitted through observations whose grades are about to change. Run 4 before 3b
// and every Landsat point is null and silently absent.

export type FullRunResult = {
  ok: boolean
  fields: number
  scenes: number
  observations: number
  detail: string
}

export async function runFullIngest(
  sb: SupabaseClient,
  opts: {
    days?: number
    limitFields?: number
    reprocess?: boolean
    budgetMs?: number
    imageryBudgetMs?: number
  } = {},
): Promise<FullRunResult> {
  // A wall-clock budget shared across every sensor. Netlify kills a function
  // that overruns, mid-write and with nothing said, and an ingest over every
  // field can take minutes. Each stage stops cleanly at the deadline and the
  // per-scene skip means the next run resumes where this one stopped — so the
  // cost of running out of time is a delay, never a gap in the record.
  //
  // Twelve minutes leaves room inside a background function's fifteen for the
  // scoring, harmonization and rebuild that follow, which must not be cut off
  // halfway.
  const deadline = Date.now() + (opts.budgetMs ?? 12 * 60_000)
  const staged = { ...opts, deadline }

  const optical = await runSatelliteIngest(sb, staged)
  // A hard optical failure — credentials, geometry, the kill switch — is not a
  // reason to skip radar, which uses a different collection and may well work.
  // But there is nothing to say if it failed for want of any subjects at all.
  if (!optical.fields) return optical

  // N-rich reference strips, on the same Sentinel-2 passes as their fields,
  // so each strip's red-edge reading can be set against its own field's.
  // Only this season's strips, and only a handful — a few seconds at most.
  let strips: { observations: number; detail: string }
  try {
    const so = await runSatelliteIngest(sb, { ...staged, subjectType: 'n_strip' })
    strips = { observations: so.observations, detail: so.fields ? `N-rich strips ${so.observations} observations` : '' }
  } catch (e) {
    strips = { observations: 0, detail: `N-rich strips failed: ${(e as Error).message.slice(0, 100)}` }
  }

  let radar: { fields: number; scenes: number; observations: number; detail: string }
  try {
    radar = await runRadarIngest(sb, staged)
  } catch (e) {
    radar = { fields: 0, scenes: 0, observations: 0, detail: `radar failed: ${(e as Error).message.slice(0, 120)}` }
    await logApiCall(sb, 'radar', false, (e as Error).message.slice(0, 200))
  }

  // Landsat is on a different provider entirely (Planetary Computer), so a
  // CDSE outage does not stop it and vice versa.
  let landsat: { fields: number; scenes: number; observations: number; detail: string }
  try {
    landsat = await runLandsatIngest(sb, staged)
  } catch (e) {
    landsat = { fields: 0, scenes: 0, observations: 0, detail: `landsat failed: ${(e as Error).message.slice(0, 120)}` }
    await logApiCall(sb, 'landsat', false, (e as Error).message.slice(0, 200))
  }

  // Pastures, through the same pipeline (spec §9.1). Whole-paddock statistics
  // are exactly what the field ingester already computes, and §9.1 explicitly
  // does NOT want within-paddock zones — "Cattle graze selectively across a
  // whole pasture", so the paddock total is the useful number.
  //
  // Landsat matters more here than on the crop side: §9.1 says its 30 m pixel
  // is fine for a paddock and to "use the full Landsat stack for pasture, which
  // meaningfully raises observation count".
  let pasture: { observations: number; detail: string }
  try {
    const pastureOpts = { ...staged, subjectType: 'pasture' as const }
    const po = await runSatelliteIngest(sb, pastureOpts)
    const pl = await runLandsatIngest(sb, pastureOpts)

    // Distance-from-water bands (spec §9.4). Rebuilt first, because a water
    // source added since the last run changes which ground is in which band —
    // and statistics against a stale band would answer a question about a
    // shape that no longer exists.
    const { data: zonesBuilt } = await sb.rpc('rebuild_pasture_zones')
    const zoneOpts = { ...staged, subjectType: 'pasture_zone' as const }
    const zo = zonesBuilt ? await runSatelliteIngest(sb, zoneOpts) : { observations: 0 }

    pasture = {
      observations: po.observations + pl.observations + zo.observations,
      detail:
        `pasture ${po.observations + pl.observations} observations` +
        (zonesBuilt
          ? `, ${zo.observations} across ${zonesBuilt} water-distance bands`
          : ', no water sources recorded so no underutilisation bands'),
    }
  } catch (e) {
    pasture = { observations: 0, detail: `pasture failed: ${(e as Error).message.slice(0, 100)}` }
    await logApiCall(sb, 'pasture', false, (e as Error).message.slice(0, 200))
  }

  let daily = { subjects: 0, days: 0 }
  let pastureDaily = { subjects: 0, days: 0 }
  let harmony = { pairs: 0, updated: false, rowsTouched: 0, detail: 'harmonization not run' }
  let dailyProblem = ''
  try {
    const { data: changed, error: scoreErr } = await sb.rpc('sat_rescore_observations', {
      p_full: FULL_QUALITY,
      p_partial: PARTIAL_QUALITY,
    })
    if (scoreErr) throw new Error(scoreErr.message)
    if (changed) await logApiCall(sb, 'rescore', true, `${changed} observations regraded`)
    // Place every sensor on the Sentinel-2 scale before the curve is fitted.
    // Landsat arrives unharmonized, and the curve reads ndvi_harmonized — skip
    // this and its points are null and silently drop out of the series.
    harmony = await runHarmonization(sb)
    daily = await rebuildDaily(sb, 'field')
    pastureDaily = await rebuildDaily(sb, 'pasture')
  } catch (e) {
    dailyProblem = ` · daily rebuild: ${(e as Error).message.slice(0, 120)}`
    await logApiCall(sb, 'daily', false, (e as Error).message.slice(0, 200))
  }

  // A picture of the newest clear look, so the numbers can be checked against
  // something a person can actually see. After grading, because it captures the
  // newest FULL-quality scene and grades move.
  //
  // Imagery gets its OWN slice of the clock rather than whatever the sensors
  // left. It runs last, so under a shared deadline it was the step that got
  // starved: the first full run captured 8 fields of 23 and the rest silently
  // waited a day. Two images per field now (photograph and NDVI raster), so it
  // needs the room reserved rather than donated.
  let imagery: { captured: number; skipped: number; detail: string }
  try {
    const imageryDeadline = Math.max(deadline, Date.now() + (opts.imageryBudgetMs ?? 5 * 60_000))
    const fieldImages = await runImageryCapture(sb, { ...staged, deadline: imageryDeadline })
    // Pastures get the same treatment. A paddock is exactly where a field mean
    // hides the most: cattle graze selectively, so the whole point is to see
    // which PART of it is bare (§9.1, §9.4).
    const pastureImages = await runImageryCapture(sb, {
      ...staged,
      deadline: imageryDeadline,
      subjectType: 'pasture',
    })
    imagery = {
      captured: fieldImages.captured + pastureImages.captured,
      skipped: fieldImages.skipped + pastureImages.skipped,
      detail: `${fieldImages.detail}; pasture ${pastureImages.captured} captured`,
    }
  } catch (e) {
    imagery = { captured: 0, skipped: 0, detail: `imagery failed: ${(e as Error).message.slice(0, 120)}` }
    await logApiCall(sb, 'imagery', false, (e as Error).message.slice(0, 200))
  }

  // Anomalies last: they read the graded observations, and a candidate raised
  // against a grade that was about to change is a walk across a field for
  // nothing.
  let alerts: { detected: number; confirmed: number; lapsed: number; detail: string }
  try {
    alerts = await runAlertDetection(sb)
  } catch (e) {
    alerts = { detected: 0, confirmed: 0, lapsed: 0, detail: `alerts failed: ${(e as Error).message.slice(0, 120)}` }
    await logApiCall(sb, 'alerts', false, (e as Error).message.slice(0, 200))
  }

  // Cattle alerts, after the pasture series is rebuilt and graded.
  let cattle: { raised: number; cleared: number; detail: string }
  try {
    cattle = await runCattleAlerts(sb)
  } catch (e) {
    cattle = { raised: 0, cleared: 0, detail: `cattle alerts failed: ${(e as Error).message.slice(0, 100)}` }
    await logApiCall(sb, 'cattle-alerts', false, (e as Error).message.slice(0, 200))
  }

  return {
    ok: optical.ok && !dailyProblem,
    fields: optical.fields,
    scenes: optical.scenes + radar.scenes + landsat.scenes,
    observations:
      optical.observations + radar.observations + landsat.observations + pasture.observations + strips.observations,
    detail:
      `${optical.detail} · ${radar.detail} · ${landsat.detail} · ${pasture.detail}` +
      (strips.detail ? ` · ${strips.detail}` : '') +
      ` · ${daily.days} field days, ${pastureDaily.days} pasture days` +
      ` · ${harmony.detail} · ${imagery.detail} · ${alerts.detail} · ${cattle.detail}` +
      dailyProblem,
  }
}

export type PastureRunResult = { ok: boolean; observations: number; detail: string }

/**
 * The pasture half of the run, on its own budget.
 *
 * Same steps as the pasture stage above and the rebuild that follows it —
 * optical, Landsat, the water-distance bands, regrade, harmonise, the daily
 * series, a picture, the cattle alerts — but not queued behind twenty-three
 * fields. Reports to the health board as `sat_pasture`, stamped with the
 * newest clear pasture look, so three days without one is noticed.
 */
export async function runPastureIngest(
  sb: SupabaseClient,
  opts: { days?: number; budgetMs?: number; imageryBudgetMs?: number } = {},
): Promise<PastureRunResult> {
  const deadline = Date.now() + (opts.budgetMs ?? 16_000)
  const staged = { days: opts.days, deadline, subjectType: 'pasture' as const }

  const optical = await runSatelliteIngest(sb, staged)
  if (!optical.ok && optical.detail.includes('SAT_INGEST_ENABLED')) {
    return { ok: false, observations: 0, detail: optical.detail }
  }

  let landsat: { observations: number; detail: string }
  try {
    landsat = await runLandsatIngest(sb, staged)
  } catch (e) {
    landsat = { observations: 0, detail: `landsat failed: ${(e as Error).message.slice(0, 100)}` }
    await logApiCall(sb, 'landsat', false, (e as Error).message.slice(0, 200))
  }

  let bands = 0
  let zone = { observations: 0 }
  try {
    const { data: zonesBuilt } = await sb.rpc('rebuild_pasture_zones')
    bands = Number(zonesBuilt ?? 0)
    // The bands get a slice of their own. Queued behind the paddocks and
    // Landsat under one deadline, they got none: every run on 28 Sep read
    // "0 across 22 water bands". Scenes already read are skipped, so a few
    // seconds a run catches the bands up within a day.
    if (bands) zone = await runSatelliteIngest(sb, { ...staged, deadline: Math.max(deadline, Date.now() + 6_000), subjectType: 'pasture_zone' })
  } catch (e) {
    await logApiCall(sb, 'pasture_zone', false, (e as Error).message.slice(0, 200))
  }

  let daily = { subjects: 0, days: 0 }
  let problem = ''
  try {
    const { error: scoreErr } = await sb.rpc('sat_rescore_observations', {
      p_full: FULL_QUALITY,
      p_partial: PARTIAL_QUALITY,
    })
    if (scoreErr) throw new Error(scoreErr.message)
    await runHarmonization(sb)
    daily = await rebuildDaily(sb, 'pasture')
  } catch (e) {
    problem = ` · daily rebuild: ${(e as Error).message.slice(0, 120)}`
    await logApiCall(sb, 'daily', false, (e as Error).message.slice(0, 200))
  }

  let pictures = 0
  try {
    const img = await runImageryCapture(sb, {
      deadline: Math.max(deadline, Date.now() + (opts.imageryBudgetMs ?? 6_000)),
      subjectType: 'pasture',
    })
    pictures = img.captured
  } catch (e) {
    await logApiCall(sb, 'imagery', false, (e as Error).message.slice(0, 200))
  }

  let cattle: string
  try {
    cattle = (await runCattleAlerts(sb)).detail
  } catch (e) {
    cattle = `cattle alerts failed: ${(e as Error).message.slice(0, 100)}`
  }

  const observations = optical.observations + landsat.observations + zone.observations
  const detail =
    `pasture ${optical.observations + landsat.observations} observations, ${zone.observations} across ${bands} water bands` +
    ` · ${daily.days} pasture days · ${pictures} pictures · ${cattle}${problem}`

  // The newest clear look is the fact that matters; the run time is only when
  // we last asked.
  const { data: newest } = await sb
    .from('sat_observations')
    .select('sensed_on')
    .eq('subject_type', 'pasture')
    .neq('quality', 'rejected')
    .order('sensed_on', { ascending: false })
    .limit(1)
    .maybeSingle()
  await sb.rpc('record_integration_heartbeat', {
    p_key: 'sat_pasture',
    // A failure goes first: the detail is cut at 200 characters, and a
    // timeout at the end of it was cut off while the board read ok.
    p_detail: `${problem ? `PROBLEM${problem} · ` : ''}${newest?.sensed_on ? `Newest look ${newest.sensed_on} · ` : ''}${detail}`.slice(0, 200),
    p_data_at: newest?.sensed_on ?? null,
  })
  await logApiCall(sb, 'pasture-run', !problem, detail.slice(0, 300))

  return { ok: !problem, observations, detail }
}
