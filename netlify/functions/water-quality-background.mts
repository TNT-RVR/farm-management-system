import { admin, json, requireManager } from './_jd.mts'
import { runWaterQualityPull } from '../shared/water-quality.ts'
import { hydrateSecrets } from '../shared/secrets.ts'
import { farmFeatureOn } from '../../src/lib/farm-context.ts'

// Pulls the Oldman and SMRID water chemistry into water_quality_samples.
//
// Background, so the first backfill (fifteen years across nine stations) has
// room, and so a slow provincial server cannot run it into the thirty-second
// wall a scheduled function hits. The schedule is in water-quality-cron.mts,
// which wakes this with the shared worker key; a manager can also run it from
// the River tab.
//
// Authorised either way, never by the absence of a credential: the worker key
// (refused outright when unset) or a manager's session.
let workerKey = process.env.JOB_WORKER_KEY

export default async (req: Request) => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  workerKey = process.env.JOB_WORKER_KEY
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  // The sampling stations are the original farm's river and canal; its card lives on River levels.
  if (!farmFeatureOn('river')) return json({ ok: true, detail: 'River levels is switched off in Farm setup' })
  const sb = admin()
  const byKey = !!workerKey && req.headers.get('x-worker-key') === workerKey
  if (!byKey && !(await requireManager(req, sb))) return json({ error: 'Not authorised' }, 401)
  // { "full": true } re-reads everything from 2016 (after a parsing fix).
  const body = (await req.json().catch(() => null)) as { full?: boolean } | null
  const result = await runWaterQualityPull(sb, { full: body?.full === true })
  console.log('[water-quality] ' + result.detail)
  return json(result, result.ok ? 200 : 502)
}
