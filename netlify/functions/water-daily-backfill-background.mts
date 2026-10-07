import { admin, json, requireManager } from './_jd.mts'
import { syncWaterDaily } from '../shared/water-daily.ts'
import { hydrateSecrets } from '../shared/secrets.ts'

// One-off (manager): three years of daily history for the graphs. Alberta's
// 5-minute feeds are pulled in 60-day pieces so no one download is huge; a
// background function has fifteen minutes.
export default async (req: Request) => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const sb = admin()
  if (!(await requireManager(req, sb))) return json({ error: 'Only active managers' }, 403)
  await syncWaterDaily(sb, 3 * 365 + 30, 60)
  return json({ ok: true })
}
