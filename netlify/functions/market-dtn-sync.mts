import { admin, json, requireManager } from './_jd.mts'
import { runDtnFertilizerSync } from '../shared/market-dtn.ts'
import { hydrateSecrets } from '../shared/secrets.ts'

// Manager-triggered read of DTN's weekly retail fertilizer prices.
//
// POST /api/market-dtn-sync            reads the newest article
// POST … {"take": 6}                   the newest six on the author page
// POST … {"urls": ["https://…"]}       specific past articles, for backfill
export default async (req: Request) => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const sb = admin()
  if (!(await requireManager(req, sb))) {
    return json({ error: 'Only active managers can sync market prices' }, 403)
  }
  let opts: { urls?: string[]; take?: number } = {}
  try {
    const body = (await req.json()) as { urls?: unknown; take?: unknown }
    if (Array.isArray(body.urls)) opts.urls = body.urls.filter((u): u is string => typeof u === 'string')
    if (typeof body.take === 'number') opts.take = Math.min(20, Math.max(1, body.take))
  } catch {
    opts = {}
  }
  const result = await runDtnFertilizerSync(sb, opts)
  return json(result, result.ok ? 200 : 502)
}
