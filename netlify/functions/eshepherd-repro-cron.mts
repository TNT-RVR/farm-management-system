import { hydrateSecrets } from '../shared/secrets.ts'
import { farmFeatureOn } from '../../src/lib/farm-context.ts'
// Every Monday morning: start the eShepherd pregnancy pull. A scheduled
// function gets about thirty seconds and the pull grows through the season,
// so this only wakes eshepherd-repro-sync-background.
export const config = { schedule: '0 13 * * 1' }

let workerKey = process.env.JOB_WORKER_KEY ?? process.env.FACT_WORKER_KEY ?? process.env.LABEL_WORKER_KEY
const site = process.env.URL

export default async () => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  // Switched off in Farm setup (or a fresh install that has not turned it on).
  if (!farmFeatureOn('pregnancy')) return new Response('Collar pregnancy tracking is switched off in Farm setup', { status: 200 })
  workerKey = process.env.JOB_WORKER_KEY ?? process.env.FACT_WORKER_KEY ?? process.env.LABEL_WORKER_KEY
  if (!workerKey || !site) return new Response('JOB_WORKER_KEY or URL not set', { status: 500 })
  const res = await fetch(`${site}/.netlify/functions/eshepherd-repro-sync-background`, { method: 'POST', headers: { 'x-worker-key': workerKey } })
  return new Response(`started (${res.status})`, { status: 200 })
}
