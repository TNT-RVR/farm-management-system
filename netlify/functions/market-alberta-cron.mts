import type { Config } from '@netlify/functions'
import { admin } from './_jd.mts'
import { runAlbertaCropSync, runAlbertaLivestockSync } from '../shared/market-alberta.ts'
import { runMarketAlerts } from '../shared/market-alerts.ts'
import { hydrateSecrets } from '../shared/secrets.ts'

// The review is published Friday. Checked twice a week so a late issue is not a
// week stale, and the upsert makes the second run free when nothing changed.
export default async () => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  const sb = admin()
  // Both reviews, independently: a layout change in one must not cost the other.
  const [cattle, crop] = await Promise.all([
    runAlbertaLivestockSync(sb).catch((e) => ({ ok: false, detail: (e as Error).message })),
    runAlbertaCropSync(sb).catch((e) => ({ ok: false, detail: (e as Error).message })),
  ])
  // Alerts run AFTER the prices land, so a watch is judged against the issue
  // that just arrived rather than last week's.
  const alerts = await runMarketAlerts(sb).catch((e) => ({ detail: (e as Error).message }))
  const result = { cattle, crop, alerts }
  console.log('Alberta market review sync:', JSON.stringify(result))
  return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } })
}

export const config: Config = { schedule: '0 14 * * 1,6' }
