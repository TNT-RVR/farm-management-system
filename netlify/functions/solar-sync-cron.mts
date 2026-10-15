import { hydrateSecrets } from '../shared/secrets.ts'
import { farmFeatureOn } from '../../src/lib/farm-context.ts'

// Wakes the SolisCloud solar pull every hour. Does not do the pull: a
// function with a `schedule` export cannot be reached over HTTP and is killed
// after about thirty seconds, and the first run reads a whole year of days
// for every plant at two calls a second. The work is in solar-sync-background,
// which the Solar page's "Update now" also calls.
//
// Hourly because SolisCloud refreshes every five minutes and a run is about a
// dozen calls; the page's "now" figure is never more than an hour old.
export const config = { schedule: '7 * * * *' }

export default async () => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  if (!farmFeatureOn('solar')) return new Response('Solar is switched off in Farm setup', { status: 200 })
  const workerKey = process.env.JOB_WORKER_KEY
  const site = process.env.URL
  if (!workerKey || !site) {
    const detail = `solar pull not woken: ${!workerKey ? 'JOB_WORKER_KEY' : 'URL'} is not set`
    console.warn(detail)
    // No heartbeat on purpose: the watchdog should go stale and say so.
    return new Response(detail, { status: 200 })
  }
  const res = await fetch(`${site}/.netlify/functions/solar-sync-background`, {
    method: 'POST',
    headers: { 'x-worker-key': workerKey, 'content-type': 'application/json' },
    body: '{}',
  })
  const detail = `woke the solar pull: ${res.status}`
  console.log(detail)
  return new Response(detail, { status: 200 })
}
