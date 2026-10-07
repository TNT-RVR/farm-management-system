import type { Config } from '@netlify/functions'
import { hydrateSecrets } from '../shared/secrets.ts'

// Nightly nudge for the QuickBooks sync. The work happens in
// quickbooks-sync-background: a function with a schedule cannot also be
// reached over HTTP, and is cut off at ~30 s.
export default async () => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  const workerKey = process.env.JOB_WORKER_KEY
  const site = process.env.URL
  if (!workerKey || !site) {
    console.log('[quickbooks-sync-cron] JOB_WORKER_KEY or URL missing; nothing started')
    return new Response('not configured', { status: 200 })
  }
  await fetch(`${site}/.netlify/functions/quickbooks-sync-background`, {
    method: 'POST',
    headers: { 'x-worker-key': workerKey, 'content-type': 'application/json' },
    body: '{}',
  }).catch((e) => console.log('[quickbooks-sync-cron]', (e as Error).message))
  return new Response('started')
}

// 09:10 UTC — the middle of the night in Alberta, after the day's bookkeeping.
export const config: Config = { schedule: '10 9 * * *' }
