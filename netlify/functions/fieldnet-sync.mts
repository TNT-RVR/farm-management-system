import { admin, json, requireManager } from './_fieldnet.mts'
import { runFieldnetSync } from '../shared/fieldnet-sync-core'
import { hydrateSecrets } from '../shared/secrets.ts'

// On-demand "Sync now" (manager-only). The heavy lifting + fault alerts live in
// the shared core, also driven every 10 min by fieldnet-sync-cron.mts.
export default async (req: Request) => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const sb = admin()
  const userId = await requireManager(req, sb)
  if (!userId) return json({ error: 'Only active managers can sync' }, 403)
  try {
    const r = await runFieldnetSync(sb)
    return json({ ok: true, ...r })
  } catch (e) {
    return json({ error: (e as Error).message }, 400)
  }
}
