import { admin, json, requireManager } from './_jd.mts'
import { runJdOperationsSync } from '../shared/jd-operations-core.ts'
import { hydrateSecrets } from '../shared/secrets.ts'

// Manager-triggered pull of completed field work. Shares its core with
// jd-operations-cron.mts; scheduled functions can't be called over HTTP.
export default async (req: Request) => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const sb = admin()
  if (!(await requireManager(req, sb))) {
    return json({ error: 'Only active managers can sync field operations' }, 403)
  }
  const result = await runJdOperationsSync(sb)
  return json(result, result.ok ? 200 : 502)
}
