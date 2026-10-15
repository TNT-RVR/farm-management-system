import { admin, json, requireManager } from './_jd.mts'
import { runChemicalsSync } from '../shared/chemicals-sync-core.ts'
import { hydrateSecrets } from '../shared/secrets.ts'

// Manager-triggered "sync now" for the pesticide lookup. Shares its core with
// chemicals-sync-cron.mts, which runs nightly — scheduled functions can't be
// called over HTTP, so this is the on-demand path.
export default async (req: Request) => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const sb = admin()
  if (!(await requireManager(req, sb))) {
    return json({ error: 'Only active managers can sync the chemical registry' }, 403)
  }
  const result = await runChemicalsSync(sb)
  return json(result, result.ok ? 200 : 502)
}
