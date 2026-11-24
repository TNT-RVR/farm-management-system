import { hydrateSecrets } from '../shared/secrets.ts'

// Nightly, a few minutes behind the PDF reader so the two are not downloading
// from the same bucket at once. A photo taken on any screen during the day is
// findable by what is written in it by morning. The reader does the work and
// starts another run if it runs out of time; this only wakes it.
export const config = { schedule: '40 9 * * *' }

export default async () => {
  await hydrateSecrets()
  const workerKey = process.env.JOB_WORKER_KEY
  const site = process.env.URL
  if (!workerKey || !site) return new Response('Not configured', { status: 500 })
  await fetch(`${site}/.netlify/functions/documents-read-photos-background`, {
    method: 'POST',
    headers: { 'x-worker-key': workerKey },
  }).catch(() => {})
  return new Response(JSON.stringify({ ok: true, woke: 'documents-read-photos-background' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}
