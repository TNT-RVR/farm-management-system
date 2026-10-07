import { admin, json, requireManager } from './_jd.mts'
import { runStatcanSync } from '../shared/market-statcan.ts'
import { hydrateSecrets } from '../shared/secrets.ts'

// Manager-triggered pull of the Alberta farm-gate price history.
export default async (req: Request) => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const sb = admin()
  if (!(await requireManager(req, sb))) {
    return json({ error: 'Only active managers can sync market prices' }, 403)
  }
  const result = await runStatcanSync(sb)
  return json(result, result.ok ? 200 : 502)
}
