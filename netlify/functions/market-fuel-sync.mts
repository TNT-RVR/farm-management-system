import { admin, json, requireManager } from './_jd.mts'
import { runFuelMarketSync } from '../shared/market-fuel.ts'
import { hydrateSecrets } from '../shared/secrets.ts'

// Manager-triggered read of NRCan's pump prices: the Fuel page's "Refresh",
// and the first load after deploying rather than waiting for the cron.
//
// POST /api/market-fuel-sync
export default async (req: Request) => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const sb = admin()
  if (!(await requireManager(req, sb))) {
    return json({ error: 'Only active managers can sync market prices' }, 403)
  }
  const result = await runFuelMarketSync(sb)
  return json(result, result.ok ? 200 : 502)
}
