import { admin, json, requireManager } from './_jd.mts'
import { hydrateSecrets } from '../shared/secrets.ts'
import { lastWeekStart } from '../shared/app-changes.ts'

// "Write it now" on the What's new page: marks the week as being written and
// wakes the background writer. Managers only.
// POST { weekStart? }  →  { weekStart }
export default async (req: Request) => {
  await hydrateSecrets()
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const sb = admin()
  if (!(await requireManager(req, sb))) return json({ error: 'Managers only' }, 403)
  const workerKey = process.env.JOB_WORKER_KEY
  const site = process.env.URL
  if (!workerKey || !site) return json({ error: `${!workerKey ? 'JOB_WORKER_KEY' : 'URL'} is not set` }, 501)
  const body = ((await req.json().catch(() => null)) ?? {}) as { weekStart?: string }
  const week = body.weekStart && /^\d{4}-\d{2}-\d{2}$/.test(body.weekStart) ? body.weekStart : lastWeekStart()
  const end = new Date(`${week}T12:00:00Z`)
  end.setUTCDate(end.getUTCDate() + 6)
  await sb.from('app_change_weeks').upsert({ week_start: week, week_end: end.toISOString().slice(0, 10), status: 'pending', error: null }, { onConflict: 'week_start' })
  const woke = await fetch(`${site}/.netlify/functions/app-changes-background`, {
    method: 'POST',
    headers: { 'x-worker-key': workerKey, 'content-type': 'application/json' },
    body: JSON.stringify({ weekStart: week }),
  }).catch((e: Error) => ({ ok: false, status: 0, statusText: e.message }))
  if (!woke.ok) return json({ error: `The writer did not start (${woke.status})` }, 502)
  return json({ weekStart: week }, 202)
}
