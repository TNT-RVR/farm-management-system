import type { Config } from '@netlify/functions'
import { hydrateSecrets } from '../shared/secrets.ts'

// Every 10 minutes: nudge anydo-sync-background, which does the work (a
// function with a schedule cannot also be reached over HTTP, and is cut off
// at ~30 s).
export default async () => {
  await hydrateSecrets()
  const workerKey = process.env.JOB_WORKER_KEY
  const site = process.env.URL
  if (!workerKey || !site) {
    console.log('[anydo-sync-cron] JOB_WORKER_KEY or URL missing; nothing started')
    return new Response('not configured', { status: 200 })
  }
  await fetch(`${site}/.netlify/functions/anydo-sync-background`, {
    method: 'POST',
    headers: { 'x-worker-key': workerKey, 'content-type': 'application/json' },
    body: '{}',
  }).catch((e) => console.log('[anydo-sync-cron]', (e as Error).message))
  return new Response('started')
}

export const config: Config = { schedule: '*/10 * * * *' }
