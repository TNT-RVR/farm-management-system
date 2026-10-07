import { admin, json, requireManager } from './_jd.mts'
import { runFertilizerMarketSync } from '../shared/market-fertilizer.ts'
import { hydrateSecrets } from '../shared/secrets.ts'

// Manager-triggered pull of the Alberta fertilizer price index.
export default async (req: Request) => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const sb = admin()
  if (!(await requireManager(req, sb))) {
    return json({ error: 'Only active managers can sync market prices' }, 403)
  }
  const result = await runFertilizerMarketSync(sb)
  return json(result, result.ok ? 200 : 502)
}
