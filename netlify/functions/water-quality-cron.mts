import { hydrateSecrets } from '../shared/secrets.ts'
// Wakes the water-quality pull once a month. Does not do the pull: a scheduled
// function is killed after about thirty seconds, and the provincial servers are
// not always quick. The provincial data lags months, so monthly loses nothing.
export const config = { schedule: '0 13 3 * *' } // 3rd of the month, 13:00 UTC

let workerKey = process.env.JOB_WORKER_KEY
const site = process.env.URL

export default async () => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  workerKey = process.env.JOB_WORKER_KEY
  if (!workerKey || !site) {
    const detail = `water-quality pull not woken: ${!workerKey ? 'JOB_WORKER_KEY' : 'URL'} is not set`
    console.warn(detail)
    // No heartbeat on purpose: the watchdog should go stale and say so.
    return new Response(detail, { status: 200 })
  }
  const res = await fetch(`${site}/.netlify/functions/water-quality-background`, {
    method: 'POST',
    headers: { 'x-worker-key': workerKey },
  })
  const detail = `woke the water-quality pull: ${res.status}`
  console.log(detail)
  // The worker records its own heartbeat.
  return new Response(detail, { status: 200 })
}
