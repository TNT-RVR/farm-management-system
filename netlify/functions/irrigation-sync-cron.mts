import { hydrateSecrets } from '../shared/secrets.ts'
// The morning AIMM run: measured rain at each field, FieldNET water by local
// day, then the balance — all in aimm-daily-background, since together they
// run past the ~30 seconds a scheduled function is given. 14:30 UTC is 8:30 am
// MDT, after Environment Canada has published the 6 am radar totals.
//
// The balance itself still lives in irrigation-sync.mts, reachable over HTTP
// for the Sync button; this file only carries the schedule (a function with a
// schedule cannot also be called over HTTP).
export const config = { schedule: '30 14 * * *' }

let workerKey = process.env.JOB_WORKER_KEY ?? process.env.FACT_WORKER_KEY ?? process.env.LABEL_WORKER_KEY
const site = process.env.URL

export default async () => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  workerKey = process.env.JOB_WORKER_KEY ?? process.env.FACT_WORKER_KEY ?? process.env.LABEL_WORKER_KEY
  if (!workerKey || !site) return new Response('JOB_WORKER_KEY or URL not set', { status: 500 })
  const res = await fetch(`${site}/.netlify/functions/aimm-daily-background`, { method: 'POST', headers: { 'x-worker-key': workerKey } })
  console.log('aimm daily started:', res.status)
  return new Response(`started (${res.status})`, { status: 200 })
}
