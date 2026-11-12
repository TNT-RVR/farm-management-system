import { admin, json, requireManager } from './_jd.mts'
import { runSatelliteIngest, FULL_QUALITY, PARTIAL_QUALITY } from '../shared/sat-ingest.ts'
import { runHarmonization } from '../shared/sat-harmonize.ts'
import { windowsOver } from '../shared/sat-backfill.ts'
import { hydrateSecrets } from '../shared/secrets.ts'

/**
 * A past season for the zones inside a paddock, rather than the paddock.
 *
 * The nightly runs look back a fortnight, which keeps up and cannot catch up.
 * `sat-backfill-background` is the catch-up, and its job row is typed for a
 * whole field or a whole paddock; a zone is neither. Zones also need none of
 * what makes that job a job — no pictures to draw, no cursor across several
 * runs — because there are a handful of them and the observations are the
 * whole point.
 *
 * So this is the same `runSatelliteIngest` the nightly run uses, over a fixed
 * range, walked in thirty-day windows. The windows matter: the CDSE catalog
 * answers at most 100 features a page, and one request for a whole season
 * comes back holding the first few weeks with the rest looking like clear sky.
 *
 * Why it exists at all: a paddock that is mostly irrigated cropland reads as
 * crop, so its grass has its own polygon (`pasture_zones.kind =
 * 'native_grass'`). A new polygon has no history, and a rating built on peak
 * growing-season greenness cannot wait for next August.
 *
 *   POST /.netlify/functions/sat-zone-backfill-background
 *        ?kind=native_grass&from=2026-05-01&to=2026-09-15
 */
export default async (req: Request) => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const sb = admin()
  const url = new URL(req.url)
  const workerKey = process.env.JOB_WORKER_KEY
  const byWorker = Boolean(workerKey) && req.headers.get('x-worker-key') === workerKey
  if (!byWorker && !(await requireManager(req, sb))) {
    return json({ error: 'Only active managers can backfill the pasture zones' }, 403)
  }

  const kind = url.searchParams.get('kind') ?? 'native_grass'
  const from = url.searchParams.get('from')
  const to = url.searchParams.get('to')
  if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return json({ error: 'from and to are required, as YYYY-MM-DD' }, 400)
  }
  if (from >= to) return json({ error: 'from must be before to' }, 400)

  const { data: zones, error: zoneErr } = await sb
    .from('pasture_zones')
    .select('id')
    .eq('kind', kind)
  if (zoneErr) return json({ error: zoneErr.message }, 502)
  const onlyIds = (zones ?? []).map((z) => z.id as string)
  if (!onlyIds.length) return json({ error: `no ${kind} zones to backfill` }, 400)

  // Netlify gives a background function fifteen minutes. The windows are
  // walked until the budget is spent and the rest is left for the next call —
  // a scene-and-polygon pair already computed is skipped, so repeating the
  // same range costs a catalog lookup and nothing else.
  const deadline = Date.now() + 13 * 60_000
  const windows = windowsOver(from, to)
  let observations = 0
  let done = 0
  const problems: string[] = []

  for (const w of windows) {
    if (Date.now() > deadline) break
    try {
      const r = await runSatelliteIngest(sb, {
        subjectType: 'pasture_zone',
        onlyIds,
        from: w.from,
        to: w.to,
        deadline,
      })
      observations += r.observations
      if (!r.ok && r.detail) problems.push(`${w.from}: ${r.detail.slice(0, 80)}`)
      done++
    } catch (e) {
      problems.push(`${w.from}: ${(e as Error).message.slice(0, 80)}`)
    }
  }

  // Grade, then place every sensor on one scale. No daily series: a zone
  // observation carries the zone as its subject, not the paddock, so
  // rebuildDaily('pasture') would not see it — and nothing needs a value for
  // today from a zone. The rating reads the graded, harmonised observations
  // over a past season directly.
  let finishing = ''
  if (observations > 0) {
    try {
      const { data: regraded } = await sb.rpc('sat_rescore_observations', {
        p_full: FULL_QUALITY,
        p_partial: PARTIAL_QUALITY,
      })
      const harmony = await runHarmonization(sb)
      finishing = `${regraded ?? 0} regraded, ${harmony.detail}`
    } catch (e) {
      finishing = `finishing failed: ${(e as Error).message.slice(0, 120)}`
    }
  }

  const result = {
    ok: problems.length === 0,
    kind,
    zones: onlyIds.length,
    windows: windows.length,
    windowsDone: done,
    observations,
    finishing,
    problems: problems.slice(0, 6),
  }
  console.log('Zone backfill:', JSON.stringify(result))
  return json(result, 200)
}
