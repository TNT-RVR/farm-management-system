import type { Config } from '@netlify/functions'
import { admin } from './_jd.mts'
import { runJdOperationsSync } from '../shared/jd-operations-core.ts'
import { hydrateSecrets } from '../shared/secrets.ts'

// Nightly pull of completed field work. Deere's notifications endpoint returns
// 403 for this app, so there's no event to sync on — polling is the only option.
export default async () => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  const sb = admin()
  const result = await runJdOperationsSync(sb)
  console.log('JD operations sync:', JSON.stringify(result))
  // Then the sprayer's clock: a background function, because Deere builds
  // each per-point export for minutes and a scheduled function has thirty
  // seconds. It returns 202 at once and reads what it can inside its own budget.
  const workerKey = process.env.JOB_WORKER_KEY ?? process.env.FACT_WORKER_KEY ?? process.env.LABEL_WORKER_KEY
  const site = process.env.URL
  if (workerKey && site) {
    try {
      const woke = await fetch(`${site}/.netlify/functions/jd-op-sessions-background`, {
        method: 'POST',
        headers: { 'x-worker-key': workerKey },
      })
      console.log('JD op sessions woke:', woke.status)
    } catch (e) {
      console.warn('JD op sessions wake failed:', (e as Error).message)
    }
    // And the Profit/Loss Map's grids: any pass not yet on the map. Returns
    // at once when there is nothing new, so an idle hour costs one query.
    try {
      const woke = await fetch(`${site}/.netlify/functions/pl-grids-background`, {
        method: 'POST',
        headers: { 'x-worker-key': workerKey },
      })
      console.log('P/L grids woke:', woke.status)
    } catch (e) {
      console.warn('P/L grids wake failed:', (e as Error).message)
    }
  }
  // A new spray on ground livestock eat from is told within the hour, not at
  // the next morning's run. The watch's own key, as the daily cron uses.
  const jobKey = process.env.JOB_WORKER_KEY
  if (jobKey && site && result.operations > 0) {
    try {
      const woke = await fetch(`${site}/.netlify/functions/grazing-watch-background`, {
        method: 'POST',
        headers: { 'x-worker-key': jobKey },
      })
      console.log('Grazing watch woke:', woke.status)
    } catch (e) {
      console.warn('Grazing watch wake failed:', (e as Error).message)
    }
  }
  return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } })
}

// Every 30 minutes. Daily was too slow to feel live: a pass finished at noon
// did not show until the next morning. The sync is idempotent (upsert on Deere's
// operation id), so running it often costs a few requests and changes nothing
// when there is no new work.
// Backed off 18 Sep 2026: the Netlify plan ran out of credits and the site
// served 503 to the whole farm. These three were the bulk of the scheduled
// invocations, and none of them needs to be this eager.
export const config: Config = { schedule: '10 * * * *' }
