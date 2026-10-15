import { admin, json, requireManager } from './_jd.mts'
import { syncTimeOff } from '../shared/timeoff-feed.ts'
import { hydrateSecrets } from '../shared/secrets.ts'

// The same read, on demand for a manager — after approving a request and
// wanting it on the calendar now rather than tomorrow.
export default async (req: Request) => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const sb = admin()
  const who = await requireManager(req, sb)
  if (!who) return json({ error: 'Managers only' }, 403)
  try {
    return json(await syncTimeOff(sb))
  } catch (e) {
    return json({ error: (e as Error).message }, 500)
  }
}
