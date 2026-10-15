import { admin, json, requireManager } from './_jd.mts'
import { runSmridStaffCheck } from '../shared/smrid-staff-core.ts'
import { hydrateSecrets } from '../shared/secrets.ts'

// Manager-triggered "check now" for the SMRID coordinator directory. Shares the
// core with smrid-staff-cron.mts, which runs it on 1 April — scheduled functions
// can't be called over HTTP, so this is the on-demand path.
export default async (req: Request) => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const sb = admin()
  if (!(await requireManager(req, sb))) {
    return json({ error: 'Only active managers can run this check' }, 403)
  }
  const result = await runSmridStaffCheck(sb)
  return json(result, result.ok ? 200 : 502)
}
