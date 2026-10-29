import { admin, json, requireManager } from './_jd.mts'
import { runTelusFuelSync } from '../shared/telus-fuel.ts'
import { hydrateSecrets } from '../shared/secrets.ts'

// Reads the TELUS fuel gauges into the fuel tanks (netlify/shared/telus-fuel.ts).
// A handful of calls, so not a background function.
//
// Woken every 15 minutes by telus-fuel-cron with the worker key, or by a
// manager's "Update now" on the Fuel page. Authorised by the worker key
// (refused outright when unset) or a manager's session, never by the absence
// of a credential.
export default async (req: Request) => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const workerKey = process.env.JOB_WORKER_KEY
  const sb = admin()
  const byKey = !!workerKey && req.headers.get('x-worker-key') === workerKey
  if (!byKey && !(await requireManager(req, sb))) return json({ error: 'Not authorised' }, 401)

  try {
    const result = await runTelusFuelSync(sb)
    console.log('[telus-fuel]', JSON.stringify(result))
    return json(result, result.ok ? 200 : 502)
  } catch (e) {
    const detail = (e as Error).message
    console.error('[telus-fuel]', detail)
    return json({ ok: false, detail }, 500)
  }
}
