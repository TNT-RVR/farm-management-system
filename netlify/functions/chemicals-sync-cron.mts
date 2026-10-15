import type { Config } from '@netlify/functions'
import { admin } from './_jd.mts'
import { runChemicalsSync } from '../shared/chemicals-sync-core.ts'
import { hydrateSecrets } from '../shared/secrets.ts'

// Refreshes the pesticide lookup monthly. Health Canada rebuilds the extract
// every 24 h, but registrations turn over slowly and a month-old view of which
// products are registered is fine for planning; a manager can Sync now before
// buying if it matters.
//
// Scheduled functions can't be invoked over HTTP; a 403 confirms the schedule
// registered. Use chemicals-sync.mts to run it on demand.
export default async () => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  const sb = admin()
  const result = await runChemicalsSync(sb)
  console.log('Chemicals sync:', JSON.stringify(result))
  return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } })
}

// 1st of the month, 10:20 UTC (04:20 MDT). Offset from the SMRID check at 14:00
// so the two monthly jobs don't run on top of each other.
export const config: Config = { schedule: '20 10 1 * *' }
