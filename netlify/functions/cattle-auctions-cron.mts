import { hydrateSecrets } from '../shared/secrets.ts'

// Wakes the auction-market pull every day. Does not do the pull: a scheduled
// function is killed after about thirty seconds, and a Medicine Hat report is
// a scan Claude needs up to a minute to read. The work is in
// cattle-auctions-background.
//
// Daily rather than weekly because the four markets publish on different
// days — Medicine Hat after its Wednesday sale, Lethbridge and Calgary
// Stockyards on Friday, Team over the weekend — and only reports not yet
// stored are read, so a quiet day costs a handful of page fetches.
export const config = { schedule: '20 16 * * *' } // 16:20 UTC, mid-morning at the ranch

let workerKey = process.env.JOB_WORKER_KEY
const site = process.env.URL

export default async () => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  workerKey = process.env.JOB_WORKER_KEY
  if (!workerKey || !site) {
    const detail = `auction-market pull not woken: ${!workerKey ? 'JOB_WORKER_KEY' : 'URL'} is not set`
    console.warn(detail)
    // No heartbeat on purpose: the watchdog should go stale and say so.
    return new Response(detail, { status: 200 })
  }
  const res = await fetch(`${site}/.netlify/functions/cattle-auctions-background`, {
    method: 'POST',
    headers: { 'x-worker-key': workerKey, 'content-type': 'application/json' },
    body: '{}',
  })
  const detail = `woke the auction-market pull: ${res.status}`
  console.log(detail)
  // Each market records its own heartbeat.
  return new Response(detail, { status: 200 })
}
