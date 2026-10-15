import { admin, json, requireManager } from './_jd.mts'
import { runSolarSync } from '../shared/solis.ts'
import { hydrateSecrets } from '../shared/secrets.ts'

// The SolisCloud solar pull (netlify/shared/solis.ts): the plant list, the
// power right now, and every day's kWh. Background, because a plant's first
// run reads the year so far month by month at two calls a second.
//
// Woken hourly by solar-sync-cron with the worker key, or by a manager's
// "Update now" on the Solar page. Netlify answers a background function 202
// at once; the result is in the function log and on the Integrations page.
//
// POST body, optional:
//   { "year": 2025 }   read a whole past year as well
//
// Authorised by the worker key (refused outright when unset) or a manager's
// session — never by the absence of a credential.
type Body = { year?: unknown }

export default async (req: Request) => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const workerKey = process.env.JOB_WORKER_KEY
  const sb = admin()
  const byKey = !!workerKey && req.headers.get('x-worker-key') === workerKey
  if (!byKey && !(await requireManager(req, sb))) return json({ error: 'Not authorised' }, 401)

  const body = ((await req.json().catch(() => null)) ?? {}) as Body
  const thisYear = new Date().getUTCFullYear()
  const year = typeof body.year === 'number' && Number.isInteger(body.year) && body.year >= 2010 && body.year <= thisYear ? body.year : undefined

  const result = await runSolarSync(sb, { deadline: Date.now() + 13 * 60_000, year })

  // Ran out of time with months still to read: carry on in a fresh run. Only
  // when this run got somewhere, so a dead API cannot loop.
  if (result.ok && result.remaining && result.days > 0 && workerKey && process.env.URL) {
    await fetch(`${process.env.URL}/.netlify/functions/solar-sync-background`, {
      method: 'POST',
      headers: { 'x-worker-key': workerKey, 'content-type': 'application/json' },
      body: JSON.stringify(year ? { year } : {}),
    }).catch((e) => console.error('[solar] could not start the next run:', (e as Error).message))
  }

  console.log('[solar]', JSON.stringify(result))
  return json(result, result.ok ? 200 : 502)
}
