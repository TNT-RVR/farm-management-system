import { admin, json, requireManager } from './_jd.mts'
import { runPastureMapSync } from '../shared/pasture-map-sync.ts'
import { hydrateSecrets } from '../shared/secrets.ts'

// "Update from the My Map" on Cattle → Settings. One map download and one
// database call, well inside an ordinary function's time; the daily run lives
// in pasture-map-sync-cron.mts, because a function with a schedule cannot be
// reached over HTTP.
let workerKey = process.env.JOB_WORKER_KEY

export default async (req: Request) => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  workerKey = process.env.JOB_WORKER_KEY
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const sb = admin()
  const byKey = !!workerKey && req.headers.get('x-worker-key') === workerKey
  if (!byKey && !(await requireManager(req, sb))) return json({ error: 'Managers only' }, 403)
  const result = await runPastureMapSync(sb)
  return json(result, result.ok ? 200 : 502)
}
