import { hydrateSecrets } from '../shared/secrets.ts'
// Hourly: rebuild the last two local days of FieldNET applied water, so
// today's passes show within the hour and anything missed while FieldNET or a
// sync was down is filled the next time round. A scheduled function gets
// about thirty seconds, so this only wakes the background worker.
export const config = { schedule: '10 * * * *' }

let workerKey = process.env.JOB_WORKER_KEY ?? process.env.FACT_WORKER_KEY ?? process.env.LABEL_WORKER_KEY
const site = process.env.URL

export default async () => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  workerKey = process.env.JOB_WORKER_KEY ?? process.env.FACT_WORKER_KEY ?? process.env.LABEL_WORKER_KEY
  if (!workerKey || !site) return new Response('JOB_WORKER_KEY or URL not set', { status: 500 })
  const res = await fetch(`${site}/.netlify/functions/fieldnet-applied-background`, { method: 'POST', headers: { 'x-worker-key': workerKey } })
  return new Response(`started (${res.status})`, { status: 200 })
}
