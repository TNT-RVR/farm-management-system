import { hydrateSecrets } from '../shared/secrets.ts'
// Wakes season-outlook-background on the 1st and 15th: heat units, next
// summer's seasonal outlook, reservoir storage, snowpack and SMRID notices for
// the rotation advisor. A scheduled function gets about thirty seconds, which
// twenty years of weather per cell does not fit in, so this only starts it.
export const config = { schedule: '0 14 1,15 * *' }

let workerKey = process.env.JOB_WORKER_KEY ?? process.env.FACT_WORKER_KEY ?? process.env.LABEL_WORKER_KEY
const site = process.env.URL

export default async () => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  workerKey = process.env.JOB_WORKER_KEY ?? process.env.FACT_WORKER_KEY ?? process.env.LABEL_WORKER_KEY
  if (!workerKey || !site) return new Response('JOB_WORKER_KEY or URL not set', { status: 500 })
  const res = await fetch(`${site}/.netlify/functions/season-outlook-background`, { method: 'POST', headers: { 'x-worker-key': workerKey } })
  return new Response(`started (${res.status})`, { status: 200 })
}
