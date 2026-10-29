import { hydrateSecrets } from '../shared/secrets.ts'

// Wakes the TELUS fuel-gauge read every 15 minutes. Does not do the read: a
// function with a `schedule` export cannot be reached over HTTP, and the
// Fuel page's "Update now" needs to, so the work is in telus-fuel-sync.
//
// Every 15 minutes because the gauges report about hourly each, at their
// own times; a fresh reading is on the Fuel page within a quarter hour.
export const config = { schedule: '*/15 * * * *' }

export default async () => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  if (!process.env.TELUS_FI_EMAIL || !process.env.TELUS_FI_PASSWORD) return new Response('Telus gauges not set up', { status: 200 })
  const workerKey = process.env.JOB_WORKER_KEY
  const site = process.env.URL
  if (!workerKey || !site) {
    const detail = `fuel gauge read not woken: ${!workerKey ? 'JOB_WORKER_KEY' : 'URL'} is not set`
    console.warn(detail)
    // No heartbeat on purpose: the watchdog should go stale and say so.
    return new Response(detail, { status: 200 })
  }
  const res = await fetch(`${site}/.netlify/functions/telus-fuel-sync`, {
    method: 'POST',
    headers: { 'x-worker-key': workerKey, 'content-type': 'application/json' },
    body: '{}',
  })
  const detail = `woke the fuel gauge read: ${res.status}`
  console.log(detail)
  return new Response(detail, { status: 200 })
}
