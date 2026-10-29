import { hydrateSecrets } from '../shared/secrets.ts'
import { farmTimeIs, farmTimeLabel, type FarmTime } from '../../src/lib/farm-clock.ts'
// Wakes the grazing watch every morning at 6:30 on the farm's clock — before anybody
// moves cattle. Does not do the work: a new label is a Claude call, and a
// scheduled function is killed after about thirty seconds. The John Deere
// operations sync wakes it too, so a new spray is told within the hour; this
// is for the clashes, which come from the cattle side and from the calendar.
export const config = { schedule: '30 * * * *' }
const WHEN: FarmTime = { hours: [6] }

let workerKey = process.env.JOB_WORKER_KEY
const site = process.env.URL

export default async () => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  // Every hour; acts only at its time on the farm's clock (Farm setup's time zone).
  if (!farmTimeIs(WHEN)) return new Response(`Not yet: runs ${farmTimeLabel(WHEN)}`)
  workerKey = process.env.JOB_WORKER_KEY
  if (!workerKey || !site) {
    const detail = `grazing watch not woken: ${!workerKey ? 'JOB_WORKER_KEY' : 'URL'} is not set`
    console.warn(detail)
    // No heartbeat on purpose: the watchdog should go stale and say so.
    return new Response(detail, { status: 200 })
  }
  const res = await fetch(`${site}/.netlify/functions/grazing-watch-background`, {
    method: 'POST',
    headers: { 'x-worker-key': workerKey },
  })
  const detail = `woke the grazing watch: ${res.status}`
  console.log(detail)
  // The worker records its own heartbeat.
  return new Response(detail, { status: 200 })
}
