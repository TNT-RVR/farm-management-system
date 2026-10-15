import { hydrateSecrets } from '../shared/secrets.ts'
import { lastWeekStart } from '../shared/app-changes.ts'

// Monday, 4 am farm time: write last week's "what changed in the app" for
// the meeting. A scheduled function gets thirty seconds, so it only wakes the
// background writer.
export const config = { schedule: '0 10 * * 1' }

export default async () => {
  await hydrateSecrets()
  const workerKey = process.env.JOB_WORKER_KEY
  const site = process.env.URL
  if (!workerKey || !site) return new Response('JOB_WORKER_KEY or URL is not set', { status: 500 })
  const res = await fetch(`${site}/.netlify/functions/app-changes-background`, {
    method: 'POST',
    headers: { 'x-worker-key': workerKey, 'content-type': 'application/json' },
    body: JSON.stringify({ weekStart: lastWeekStart() }),
  })
  return new Response(`woke the writer: ${res.status}`, { status: 200 })
}
